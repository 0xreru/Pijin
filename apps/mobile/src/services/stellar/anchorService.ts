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
  Asset,
  Horizon,
  Keypair,
  Memo,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
  Transaction,
} from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';
import {
  HORIZON_TESTNET_URL,
  PIJIN_ASSETS,
  type AssetCode,
} from './trustlineService';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Base URL of the Pijin anchor backend (no trailing slash). */
export const ANCHOR_DOMAIN = 'pijin-api.vercel.app';
export const ANCHOR_BASE_URL = `https://${ANCHOR_DOMAIN}`;

/** Stellar network we are targeting. */
const NETWORK_PASSPHRASE = Networks.TESTNET;
const HORIZON_BASE_FEE = '100';
const PAYMENT_TIMEOUT_SECONDS = 180;

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
  | 'SEP24_WITHDRAWAL_FAILED'
  | 'SEP24_WITHDRAWAL_INSTRUCTIONS_FAILED'
  | 'SEP24_WITHDRAWAL_PAYMENT_FAILED'
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

/** Successful result of `startSep24Withdrawal`. */
export interface Sep24WithdrawalResult {
  url: string;
  transactionId: string;
  /** SEP-10 token used to securely poll the transaction after the webview handoff. */
  token: string;
}

/** Authenticated payment instructions returned by the anchor polling endpoint. */
export interface Sep24WithdrawalInstructions {
  id: string;
  kind: 'withdrawal';
  status: 'pending_user_transfer_start';
  stellarAccount: string;
  assetCode: AssetCode;
  amount: string;
  /** SECURITY: This is the anchor Treasury Cold Wallet, never the relayer. */
  destination: string;
  memo?: string;
  memoType?: 'text';
}

export interface Sep24WithdrawalPaymentResult {
  hash: string;
  amount: string;
  assetCode: AssetCode;
  destination: string;
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
/**
 * Performs the full SEP-10 authentication handshake to retrieve a JWT token.
 *
 * @param userKeypair - The user's Stellar keypair.
 */
export async function getSep10Token(userKeypair: Keypair): Promise<string> {
  const publicKey = userKeypair.publicKey();
  const endpoints = await fetchAnchorEndpoints();
  const challengeXdr = await fetchSep10Challenge(
    endpoints.webAuthEndpoint,
    publicKey,
  );
  const signedXdr = signChallenge(challengeXdr, userKeypair);
  const token = await submitSignedChallenge(
    endpoints.webAuthEndpoint,
    signedXdr,
  );
  return token;
}

export async function startSep24Deposit(
  assetCode: string,
  userKeypair: Keypair,
): Promise<Sep24DepositResult> {
  const publicKey = userKeypair.publicKey();
  const endpoints = await fetchAnchorEndpoints();
  const token = await getSep10Token(userKeypair);

  const { url, transactionId } = await initiateSep24Deposit(
    endpoints.transferServerSep24,
    assetCode,
    publicKey,
    token,
  );

  return { url, transactionId, token };
}

/**
 * Starts a SEP-24 withdrawal funded exclusively by the user's main Stellar
 * wallet. Offline Omni-Vault funds must first be moved back online through the
 * existing vault withdrawal flow.
 */
export async function startSep24Withdrawal(
  assetCode: AssetCode,
  userKeypair: Keypair,
): Promise<Sep24WithdrawalResult> {
  const publicKey = userKeypair.publicKey();
  const endpoints = await fetchAnchorEndpoints();
  const token = await getSep10Token(userKeypair);

  const { url, transactionId } = await initiateSep24Withdrawal(
    endpoints.transferServerSep24,
    assetCode,
    publicKey,
    token,
  );

  return { url, transactionId, token };
}

/**
 * Polls the authenticated SEP-24 transaction until the webview has moved it to
 * `pending_user_transfer_start`, then returns strictly validated instructions.
 */
export async function getSep24WithdrawalInstructions(
  transactionId: string,
  token: string,
  expectedAccount: string,
): Promise<Sep24WithdrawalInstructions> {
  const endpoint = `${ANCHOR_BASE_URL}/api/sep24/transaction?id=${encodeURIComponent(transactionId)}`;

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (err) {
      if (attempt === 5) {
        throw new AnchorServiceError(
          'Could not retrieve withdrawal instructions.',
          'SEP24_WITHDRAWAL_INSTRUCTIONS_FAILED',
          String(err),
        );
      }
      await delay(400);
      continue;
    }

    const body = await safeJson(response);
    if (!response.ok) {
      throw new AnchorServiceError(
        'The anchor rejected the withdrawal status request.',
        'SEP24_WITHDRAWAL_INSTRUCTIONS_FAILED',
        typeof body?.message === 'string' ? body.message : `HTTP ${response.status}`,
      );
    }

    const transaction = isRecord(body?.transaction) ? body.transaction : null;
    if (!transaction) {
      throw new AnchorServiceError(
        'Anchor returned invalid withdrawal instructions.',
        'SEP24_WITHDRAWAL_INSTRUCTIONS_FAILED',
        'Response missing transaction object.',
      );
    }

    if (transaction.status !== 'pending_user_transfer_start') {
      if (attempt < 5 && transaction.status === 'incomplete') {
        await delay(400);
        continue;
      }
      throw new AnchorServiceError(
        'Withdrawal is not ready for wallet transfer.',
        'SEP24_WITHDRAWAL_INSTRUCTIONS_FAILED',
        `Unexpected transaction status: ${String(transaction.status)}`,
      );
    }

    return validateWithdrawalInstructions(transaction, transactionId, expectedAccount);
  }

  throw new AnchorServiceError(
    'Withdrawal instructions timed out.',
    'SEP24_WITHDRAWAL_INSTRUCTIONS_FAILED',
  );
}

/**
 * Builds, signs, and submits the user-authorized classic Stellar payment from
 * the main wallet to the Treasury destination supplied by authenticated polling.
 */
export async function submitSep24WithdrawalPayment(
  instructions: Sep24WithdrawalInstructions,
  userKeypair: Keypair,
): Promise<Sep24WithdrawalPaymentResult> {
  if (userKeypair.publicKey() !== instructions.stellarAccount) {
    throw new AnchorServiceError(
      'Active wallet does not own this withdrawal.',
      'SEP24_WITHDRAWAL_PAYMENT_FAILED',
    );
  }

  const server = new Horizon.Server(HORIZON_TESTNET_URL);
  const assetConfig = PIJIN_ASSETS[instructions.assetCode];

  try {
    const sourceAccount = await server.loadAccount(instructions.stellarAccount);
    const matchingBalance = sourceAccount.balances.find((balance) =>
      balance.asset_type !== 'native' &&
      'asset_code' in balance &&
      balance.asset_code === assetConfig.code &&
      balance.asset_issuer === assetConfig.issuer
    );

    if (!matchingBalance || decimalToStroops(matchingBalance.balance) < decimalToStroops(instructions.amount)) {
      throw new AnchorServiceError(
        `Insufficient online ${instructions.assetCode} balance. Move offline funds online first if needed.`,
        'SEP24_WITHDRAWAL_PAYMENT_FAILED',
      );
    }

    let builder = new TransactionBuilder(sourceAccount, {
      fee: HORIZON_BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    }).addOperation(
      Operation.payment({
        destination: instructions.destination,
        asset: new Asset(assetConfig.code, assetConfig.issuer),
        amount: instructions.amount,
      }),
    );

    if (instructions.memo) {
      builder = builder.addMemo(Memo.text(instructions.memo));
    }

    const transaction = builder.setTimeout(PAYMENT_TIMEOUT_SECONDS).build();
    transaction.sign(userKeypair);

    const txBase64 = transactionToBase64(transaction);
    const response = await fetch(`${HORIZON_TESTNET_URL}/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `tx=${encodeURIComponent(txBase64)}`,
    });
    const responseBody = await safeJson(response);

    if (!response.ok || typeof responseBody?.hash !== 'string') {
      const resultCodes = isRecord(responseBody?.extras)
        ? responseBody.extras.result_codes
        : undefined;
      throw new AnchorServiceError(
        'The Stellar withdrawal transfer failed.',
        'SEP24_WITHDRAWAL_PAYMENT_FAILED',
        resultCodes ? JSON.stringify(resultCodes) : `HTTP ${response.status}`,
      );
    }

    return {
      hash: responseBody.hash,
      amount: instructions.amount,
      assetCode: instructions.assetCode,
      destination: instructions.destination,
    };
  } catch (err) {
    if (err instanceof AnchorServiceError) throw err;
    throw new AnchorServiceError(
      'Could not send the withdrawal transfer.',
      'SEP24_WITHDRAWAL_PAYMENT_FAILED',
      String(err),
    );
  }
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
    const detail = typeof body?.error === "string" ? body.error : `HTTP ${response.status}`;
    throw new AnchorServiceError(
      'Authentication challenge request was rejected.',
      'SEP10_CHALLENGE_FAILED',
      detail,
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
    const detail = typeof body?.error === "string" ? body.error : `HTTP ${response.status}`;
    throw new AnchorServiceError(
      'Authentication failed. Please try again.',
      'SEP10_TOKEN_FAILED',
      detail,
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
    const detail = typeof body?.error === "string" ? body.error : `HTTP ${response.status}`;
    throw new AnchorServiceError(
      'The anchor rejected the deposit request.',
      'SEP24_DEPOSIT_FAILED',
      detail,
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

/** Calls the inverse SEP-24 interactive endpoint without changing deposit behavior. */
async function initiateSep24Withdrawal(
  transferServerSep24: string,
  assetCode: AssetCode,
  publicKey: string,
  token: string,
): Promise<{ url: string; transactionId: string }> {
  const base = transferServerSep24.replace(/\/$/, '');
  const withdrawalUrl = `${base}/transactions/withdraw/interactive`;
  const formData = new FormData();
  formData.append('asset_code', assetCode);
  formData.append('account', publicKey);

  let response: Response;
  try {
    response = await fetch(withdrawalUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
  } catch (err) {
    throw new AnchorServiceError(
      'Could not initiate the withdrawal. Please check your internet connection.',
      'SEP24_WITHDRAWAL_FAILED',
      String(err),
    );
  }

  const json = await safeJson(response);
  if (!response.ok) {
    throw new AnchorServiceError(
      'The anchor rejected the withdrawal request.',
      'SEP24_WITHDRAWAL_FAILED',
      typeof json?.message === 'string'
        ? json.message
        : typeof json?.error === 'string'
          ? json.error
          : `HTTP ${response.status}`,
    );
  }

  if (typeof json?.url !== 'string' || typeof json?.id !== 'string') {
    throw new AnchorServiceError(
      'Anchor returned an incomplete withdrawal response.',
      'SEP24_WITHDRAWAL_FAILED',
      'Response missing `url` or `id` field.',
    );
  }

  return { url: json.url, transactionId: json.id };
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

function validateWithdrawalInstructions(
  transaction: Record<string, unknown>,
  expectedId: string,
  expectedAccount: string,
): Sep24WithdrawalInstructions {
  const id = transaction.id;
  const kind = transaction.kind;
  const status = transaction.status;
  const stellarAccount = transaction.stellar_account;
  const assetCode = transaction.asset_code;
  const amount = transaction.amount_in;
  const destination = transaction.withdraw_anchor_account;
  const memo = transaction.withdraw_memo;
  const memoType = transaction.withdraw_memo_type;

  if (id !== expectedId || kind !== 'withdrawal' || status !== 'pending_user_transfer_start') {
    throw new AnchorServiceError(
      'Anchor returned mismatched withdrawal instructions.',
      'SEP24_WITHDRAWAL_INSTRUCTIONS_FAILED',
    );
  }
  if (stellarAccount !== expectedAccount) {
    throw new AnchorServiceError(
      'Withdrawal instructions belong to a different Stellar account.',
      'SEP24_WITHDRAWAL_INSTRUCTIONS_FAILED',
    );
  }
  if (assetCode !== 'PHPC' && assetCode !== 'USDC') {
    throw new AnchorServiceError(
      'Anchor returned an unsupported withdrawal asset.',
      'SEP24_WITHDRAWAL_INSTRUCTIONS_FAILED',
    );
  }
  if (typeof amount !== 'string' || decimalToStroops(amount) <= 0n) {
    throw new AnchorServiceError(
      'Anchor returned an invalid withdrawal amount.',
      'SEP24_WITHDRAWAL_INSTRUCTIONS_FAILED',
    );
  }
  if (typeof destination !== 'string' || !StrKey.isValidEd25519PublicKey(destination)) {
    throw new AnchorServiceError(
      'Anchor Treasury destination is missing or invalid.',
      'SEP24_WITHDRAWAL_INSTRUCTIONS_FAILED',
    );
  }
  if (memo !== undefined && memo !== null && typeof memo !== 'string') {
    throw new AnchorServiceError(
      'Anchor returned an invalid withdrawal memo.',
      'SEP24_WITHDRAWAL_INSTRUCTIONS_FAILED',
    );
  }
  if (memo && memoType !== 'text') {
    throw new AnchorServiceError(
      'This wallet only accepts the anchor text memo used for Treasury attribution.',
      'SEP24_WITHDRAWAL_INSTRUCTIONS_FAILED',
      `Unexpected memo type: ${String(memoType)}`,
    );
  }

  return {
    id,
    kind,
    status,
    stellarAccount,
    assetCode,
    amount,
    destination,
    memo: typeof memo === 'string' && memo ? memo : undefined,
    memoType: typeof memo === 'string' && memo ? 'text' : undefined,
  };
}

function decimalToStroops(value: string): bigint {
  const match = /^(\d+)(?:\.(\d{1,7}))?$/.exec(value);
  if (!match) {
    throw new AnchorServiceError(
      'Invalid Stellar amount.',
      'SEP24_WITHDRAWAL_INSTRUCTIONS_FAILED',
      value,
    );
  }
  const whole = BigInt(match[1]);
  const fractional = BigInt((match[2] ?? '').padEnd(7, '0'));
  return whole * 10_000_000n + fractional;
}

function transactionToBase64(transaction: Transaction): string {
  const rawXdr = transaction.toXDR() as unknown;
  if (typeof rawXdr === 'string') {
    if (!rawXdr.includes(',')) return rawXdr;
    return Buffer.from(
      new Uint8Array(rawXdr.split(',').map((value) => Number.parseInt(value, 10))),
    ).toString('base64');
  }
  if (rawXdr instanceof Uint8Array || Buffer.isBuffer(rawXdr)) {
    return Buffer.from(rawXdr).toString('base64');
  }
  throw new AnchorServiceError(
    'Could not serialize the Stellar withdrawal transaction.',
    'SEP24_WITHDRAWAL_PAYMENT_FAILED',
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

// Re-export for convenience so callers don't need a separate import.
export { Keypair };
