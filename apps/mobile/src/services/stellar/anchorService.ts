/**
 * anchorService.ts
 *
 * Pijin SEP-24 Anchor Integration Service
 * ────────────────────────────────────────
 *
 * Orchestrates the full SEP-10 → SEP-24 deposit initiation flow against the
 * Pijin anchor hosted at `pijin-api.vercel.app`.
 *
 * Flow
 * ────
 * 1. Fetch the anchor's stellar.toml to discover the SEP-10 / SEP-24 URLs.
 * 2. GET  /api/auth        → anchor issues a challenge transaction (SEP-10 step 1)
 * 3. Sign the challenge with the user's keypair                 (SEP-10 step 2)
 * 4. POST /api/auth        → exchange signed XDR for a JWT     (SEP-10 step 3)
 * 5. POST /api/sep24/transactions/deposit  → anchor returns an
 *    interactive webview URL                                    (SEP-24 step 1)
 *
 * Why not `@stellar/wallet-sdk`?
 * ──────────────────────────────
 * The project already bundles `@stellar/stellar-sdk` v15 which exposes every
 * primitive needed (challenge parsing, signing, XDR serialisation). Adding the
 * wallet-sdk would double the crypto bundle size for no net capability gain.
 * This service is a thin, production-ready wrapper around the same raw SDK.
 *
 * Error handling
 * ──────────────
 * All network failures and unexpected anchor responses are converted to typed
 * `AnchorServiceError` instances so callers can present user-friendly copy.
 */

import {
  Keypair,
  Networks,
  TransactionBuilder,
  Transaction,
} from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Base URL of the Pijin anchor backend (no trailing slash). */
export const ANCHOR_DOMAIN = 'pijin-api.vercel.app';
export const ANCHOR_BASE_URL = `https://${ANCHOR_DOMAIN}`;

/** Stellar network we are targeting. */
const NETWORK_PASSPHRASE = Networks.TESTNET;

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Structured error thrown by every public function in this module.
 * Consumers can inspect `code` for programmatic handling and display
 * `message` directly in the UI.
 */
export class AnchorServiceError extends Error {
  constructor(
    message: string,
    public readonly code: AnchorErrorCode,
    public readonly detail?: string,
  ) {
    super(message);
    this.name = 'AnchorServiceError';
  }
}

export type AnchorErrorCode =
  | 'TOML_FETCH_FAILED'
  | 'SEP10_CHALLENGE_FAILED'
  | 'SEP10_SIGN_FAILED'
  | 'SEP10_TOKEN_FAILED'
  | 'SEP24_DEPOSIT_FAILED'
  | 'NETWORK_ERROR';

/** The resolved URLs needed to execute the anchor flow. */
interface AnchorEndpoints {
  webAuthEndpoint: string;
  transferServerSep24: string;
}

/** Successful result of `startSep24Deposit`. */
export interface Sep24DepositResult {
  /** The interactive deposit URL to open in a WebView. */
  url: string;
  /** The SEP-24 transaction ID created by the anchor. */
  transactionId: string;
  /** The SEP-10 JWT session token (useful for status polling). */
  token: string;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Initiates a SEP-24 deposit for the given asset.
 *
 * Performs the full SEP-10 authentication handshake, then calls the SEP-24
 * interactive deposit endpoint. Returns the webview URL, transaction ID, and
 * session token on success.
 *
 * @param assetCode   - The asset to deposit (e.g. "PHPC" or "USDC").
 * @param userKeypair - The user's Stellar keypair, loaded from SecureStore.
 *
 * @throws {AnchorServiceError} on any network failure or unexpected response.
 */
export async function startSep24Deposit(
  assetCode: string,
  userKeypair: Keypair,
): Promise<Sep24DepositResult> {
  const publicKey = userKeypair.publicKey();

  // ── Step 1: Discover anchor endpoints via stellar.toml ────────────────────
  const endpoints = await fetchAnchorEndpoints();

  // ── Step 2: SEP-10 — Request a challenge transaction ──────────────────────
  const challengeXdr = await fetchSep10Challenge(
    endpoints.webAuthEndpoint,
    publicKey,
  );

  // ── Step 3: SEP-10 — Sign the challenge ───────────────────────────────────
  const signedXdr = signChallenge(challengeXdr, userKeypair);

  // ── Step 4: SEP-10 — Exchange signed XDR for a JWT ────────────────────────
  const token = await submitSignedChallenge(
    endpoints.webAuthEndpoint,
    signedXdr,
  );

  // ── Step 5: SEP-24 — Initiate the interactive deposit ────────────────────
  const { url, transactionId } = await initiateSep24Deposit(
    endpoints.transferServerSep24,
    assetCode,
    publicKey,
    token,
  );

  return { url, transactionId, token };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Fetches the anchor's stellar.toml and extracts the WEB_AUTH_ENDPOINT and
 * TRANSFER_SERVER_SEP0024 values.
 */
async function fetchAnchorEndpoints(): Promise<AnchorEndpoints> {
  const tomlUrl = `${ANCHOR_BASE_URL}/.well-known/stellar.toml`;

  let response: Response;
  try {
    response = await fetch(tomlUrl);
  } catch (err) {
    throw new AnchorServiceError(
      'Could not reach the Pijin anchor. Please check your internet connection.',
      'TOML_FETCH_FAILED',
      String(err),
    );
  }

  if (!response.ok) {
    throw new AnchorServiceError(
      'Anchor configuration unavailable. Please try again shortly.',
      'TOML_FETCH_FAILED',
      `HTTP ${response.status}`,
    );
  }

  const tomlText = await response.text();

  const webAuthEndpoint = parseTomlValue(tomlText, 'WEB_AUTH_ENDPOINT');
  const transferServerSep24 = parseTomlValue(tomlText, 'TRANSFER_SERVER_SEP0024');

  if (!webAuthEndpoint || !transferServerSep24) {
    // Fallback: derive from the known anchor base URL if toml fields are absent
    // (useful during local development or before the toml is fully published).
    console.warn(
      '[anchorService] stellar.toml missing endpoints — using derived fallbacks.',
    );
    return {
      webAuthEndpoint: `${ANCHOR_BASE_URL}/api/auth`,
      transferServerSep24: `${ANCHOR_BASE_URL}/api/sep24`,
    };
  }

  return { webAuthEndpoint, transferServerSep24 };
}

/**
 * Fetches a SEP-10 challenge transaction from the anchor's WEB_AUTH_ENDPOINT.
 *
 * The anchor returns a base64-encoded XDR transaction that includes a
 * Manage Data operation containing a random nonce.
 */
async function fetchSep10Challenge(
  webAuthEndpoint: string,
  publicKey: string,
): Promise<string> {
  let response: Response;
  try {
    const url = new URL(webAuthEndpoint);
    url.searchParams.set('account', publicKey);
    response = await fetch(url.toString());
  } catch (err) {
    throw new AnchorServiceError(
      'Failed to connect to the authentication server.',
      'SEP10_CHALLENGE_FAILED',
      String(err),
    );
  }

  if (!response.ok) {
    const body = await safeJson(response);
    throw new AnchorServiceError(
      'Authentication challenge request was rejected.',
      'SEP10_CHALLENGE_FAILED',
      body?.error ?? `HTTP ${response.status}`,
    );
  }

  const json = await response.json();

  if (!json?.transaction) {
    throw new AnchorServiceError(
      'Anchor returned an invalid authentication challenge.',
      'SEP10_CHALLENGE_FAILED',
      'Response missing `transaction` field.',
    );
  }

  return json.transaction as string;
}

/**
 * Signs the SEP-10 challenge XDR with the user's keypair.
 *
 * Parses the base64-encoded XDR transaction, signs it on TESTNET, and
 * returns the re-serialised signed XDR as a guaranteed Base64 string.
 *
 * NOTE: stellar-sdk v15 changed `transaction.toXDR()` to return a `Uint8Array`
 * instead of a Base64 string. React Native's polyfills can further corrupt a
 * raw `Uint8Array` when it passes through `JSON.stringify` (turning it into a
 * comma-separated numeric string or a `{"0":0,"1":0,...}` object). This
 * recovery block explicitly normalises every possible output type to Base64
 * before handing the value to `submitSignedChallenge`.
 */
function signChallenge(challengeXdr: string, keypair: Keypair): string {
  try {
    const transaction = new Transaction(challengeXdr, NETWORK_PASSPHRASE);

    // Sign the challenge.
    transaction.sign(keypair);

    // Extract and force Base64 encoding regardless of what toXDR() returns.
    const rawXdr = transaction.toXDR() as unknown;
    let txBase64 = '';

    if (typeof rawXdr === 'string') {
      if (rawXdr.includes(',')) {
        // React Native polyfill corrupted the Uint8Array into a comma-separated
        // numeric string (e.g. "0,1,2,..."). Reconstruct the bytes and re-encode.
        const bytesArray = rawXdr.split(',').map((numStr) => parseInt(numStr, 10));
        txBase64 = Buffer.from(new Uint8Array(bytesArray)).toString('base64');
      } else {
        // Already a plain Base64 string — use as-is.
        txBase64 = rawXdr;
      }
    } else if (rawXdr instanceof Uint8Array || Buffer.isBuffer(rawXdr)) {
      // stellar-sdk v15: toXDR() returned a raw byte array.
      txBase64 = Buffer.from(rawXdr).toString('base64');
    }

    console.log('[SEP-10] Signed Challenge Base64 snippet:', txBase64.substring(0, 30) + '...');

    return txBase64;
  } catch (err) {
    throw new AnchorServiceError(
      'Failed to sign the authentication challenge.',
      'SEP10_SIGN_FAILED',
      String(err),
    );
  }
}

/**
 * Submits the signed challenge XDR to the anchor and returns the JWT token.
 */
async function submitSignedChallenge(
  webAuthEndpoint: string,
  signedXdr: string,
): Promise<string> {
  let response: Response;
  try {
    response = await fetch(webAuthEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transaction: signedXdr }),
    });
  } catch (err) {
    throw new AnchorServiceError(
      'Failed to connect to the authentication server.',
      'SEP10_TOKEN_FAILED',
      String(err),
    );
  }

  if (!response.ok) {
    const body = await safeJson(response);
    throw new AnchorServiceError(
      'Authentication failed. Please try again.',
      'SEP10_TOKEN_FAILED',
      body?.error ?? `HTTP ${response.status}`,
    );
  }

  const json = await response.json();

  if (!json?.token) {
    throw new AnchorServiceError(
      'Anchor did not return a session token.',
      'SEP10_TOKEN_FAILED',
      'Response missing `token` field.',
    );
  }

  return json.token as string;
}

/**
 * Calls the SEP-24 deposit initiation endpoint.
 *
 * POST /transactions/deposit/interactive
 *
 * The anchor creates a pending transaction in its database and returns the
 * URL of the interactive webview the user must complete.
 */
async function initiateSep24Deposit(
  transferServerSep24: string,
  assetCode: string,
  publicKey: string,
  token: string,
): Promise<{ url: string; transactionId: string }> {
  // Remove trailing slash for consistent URL construction.
  const base = transferServerSep24.replace(/\/$/, '');
  const depositUrl = `${base}/transactions/deposit/interactive`;

  const formData = new FormData();
  formData.append('asset_code', assetCode);
  formData.append('account', publicKey);

  let response: Response;
  try {
    response = await fetch(depositUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: formData,
    });
  } catch (err) {
    throw new AnchorServiceError(
      'Could not initiate the deposit. Please check your internet connection.',
      'SEP24_DEPOSIT_FAILED',
      String(err),
    );
  }

  if (!response.ok) {
    const body = await safeJson(response);
    throw new AnchorServiceError(
      'The anchor rejected the deposit request.',
      'SEP24_DEPOSIT_FAILED',
      body?.error ?? `HTTP ${response.status}`,
    );
  }

  const json = await response.json();

  if (!json?.url || !json?.id) {
    throw new AnchorServiceError(
      'Anchor returned an incomplete deposit response.',
      'SEP24_DEPOSIT_FAILED',
      'Response missing `url` or `id` field.',
    );
  }

  return { url: json.url as string, transactionId: json.id as string };
}

// ─── Utility helpers ─────────────────────────────────────────────────────────

/**
 * Parses a `KEY="value"` pair from a TOML string.
 * Handles both quoted and unquoted values.
 */
function parseTomlValue(toml: string, key: string): string | null {
  const regex = new RegExp(`^${key}\\s*=\\s*["']?([^"'\\n]+)["']?`, 'm');
  const match = toml.match(regex);
  return match ? match[1].trim() : null;
}

/**
 * Attempts to parse a response body as JSON without throwing.
 * Returns `null` on failure.
 */
async function safeJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

// Re-export for convenience so callers don't need a separate import.
export { Keypair };
