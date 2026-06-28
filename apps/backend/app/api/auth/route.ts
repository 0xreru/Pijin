/**
 * @file app/api/auth/route.ts
 *
 * SEP-10: Stellar Web Authentication
 * ─────────────────────────────────
 * Implements the two-legged challenge/response handshake defined in
 * https://stellar.org/protocol/sep-10
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  GET  /api/auth?account=G…   →  { transaction: "<challenge XDR>" }     │
 * │  POST /api/auth              →  { token: "<JWT>" }                      │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Security contract
 * -----------------
 * - The server signs the challenge with its SEP-10 signing key; the client
 *   MUST sign with the private key that corresponds to the supplied account.
 * - `WebAuth.readChallengeTx` validates structure, timebounds, and the
 *   server's own signature on the challenge.
 * - `WebAuth.verifyChallengeTxThreshold` validates that the client's account
 *   threshold requirement is met (handles both single-sig and multisig wallets
 *   transparently).
 * - The resulting JWT is a short-lived, HS256-signed bearer token that
 *   downstream SEP handlers (SEP-6, SEP-24, SEP-31) MUST validate before
 *   processing any sensitive request.
 *
 * SDK namespace note (@stellar/stellar-sdk v15+)
 * -----------------------------------------------
 * SEP-10 helpers live under `StellarSdk.WebAuth`, NOT `StellarSdk.Utils`.
 * Usage:
 *   StellarSdk.WebAuth.buildChallengeTx(...)
 *   StellarSdk.WebAuth.readChallengeTx(...)
 *   StellarSdk.WebAuth.verifyChallengeTxThreshold(...)
 *
 * Environment variables (all mandatory — fail fast on boot if missing)
 * -------------------------------------------------------------------
 * SEP10_HOME_DOMAINS          Comma-separated allowed home domains.
 *                             e.g. "example.com" or "localhost:3000"
 * SECRET_SEP10_SIGNING_SEED   Anchor's SEP-10 signing keypair seed (S…).
 *                             Generate a DEDICATED keypair — never reuse the
 *                             relayer key.
 * SECRET_SEP10_JWT_SECRET     HS256 secret for minting / verifying JWTs.
 *                             Must be at least 32 cryptographically random bytes.
 * SEP10_AUTH_TIMEOUT          Challenge validity window in seconds (default: 900)
 * SEP10_JWT_TIMEOUT           JWT lifetime in seconds (default: 86400)
 */

// ── Runtime ──────────────────────────────────────────────────────────────────
// Force this route to run in the Node.js runtime (not Edge) so that the full
// @stellar/stellar-sdk crypto stack and jsonwebtoken are available.
export const runtime = 'nodejs';

// ── Imports ───────────────────────────────────────────────────────────────────
import { NextResponse } from 'next/server';
import {
  Keypair,
  StrKey,
  Networks,
  WebAuth,
  Horizon,
} from '@stellar/stellar-sdk';
import jwt from 'jsonwebtoken';

// ── Type Aliases ──────────────────────────────────────────────────────────────

/** Shape of a valid POST body for the token exchange endpoint. */
interface Sep10PostBody {
  transaction: string;
}

// ── Environment Helpers ───────────────────────────────────────────────────────

/**
 * Reads a required environment variable.
 * Throws a descriptive Error at call-time if the variable is absent, ensuring
 * the deployment surface fails fast and loudly rather than silently at runtime.
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `[SEP-10] Missing required environment variable: ${name}. ` +
        'Check your .env or Vercel/Render environment configuration.',
    );
  }
  return value;
}

/**
 * Reads an optional numeric environment variable, returning `defaultValue`
 * when the variable is absent or not a valid positive integer.
 */
function optionalIntEnv(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * The Stellar network passphrase used for challenge construction and
 * verification.  Switch to `Networks.PUBLIC` for mainnet.
 */
const NETWORK_PASSPHRASE: string = Networks.TESTNET;

/**
 * Horizon server used to fetch the client account's signers list for threshold
 * verification.  Switch URL to mainnet when promoting to production.
 */
const HORIZON_URL = 'https://horizon-testnet.stellar.org';

// ── GET /api/auth?account=G… ─────────────────────────────────────────────────
//
// Step 1 of the SEP-10 handshake: the client presents its Stellar account G…
// address and receives back a signed challenge transaction XDR.  The client
// must sign that XDR with the corresponding private key and return it via POST.

export async function GET(request: Request): Promise<Response> {
  try {
    // ── 1. Parse & validate the `account` query param ──────────────────────
    const { searchParams } = new URL(request.url);
    const account = searchParams.get('account');

    if (!account) {
      return NextResponse.json(
        {
          error: 'Bad Request',
          message: "Missing required query parameter: 'account'",
        },
        { status: 400 },
      );
    }

    // Validate the G… address structure before passing to the SDK.
    // StrKey.isValidEd25519PublicKey returns false (does not throw) on bad input.
    if (!StrKey.isValidEd25519PublicKey(account)) {
      return NextResponse.json(
        {
          error: 'Bad Request',
          message: `Invalid Stellar account address: ${account}`,
        },
        { status: 400 },
      );
    }

    // ── 2. Parse optional SEP-10 query parameters ───────────────────────────
    //
    // `memo`         — An optional plain-text memo to embed in the challenge.
    //                  Wallets that use muxed accounts (e.g. exchange sub-accounts)
    //                  supply this to distinguish per-user accounts under a shared G….
    // `client_domain` — The domain of the client making the auth request.  Sent by
    //                  some wallets to support per-client WebAuth domain pinning.
    //                  When present the SDK will add a `client_domain` manage_data op.
    const memo: string | null = searchParams.get('memo');
    const clientDomain: string | null = searchParams.get('client_domain');

    // ── 3. Load runtime config ──────────────────────────────────────────────
    const signingKeypair = Keypair.fromSecret(
      requireEnv('SECRET_SEP10_SIGNING_SEED'),
    );

    // Use the first domain in the comma-separated list as the canonical home
    // domain for the challenge.  The stellar.toml endpoint advertises the same.
    const homeDomain = requireEnv('SEP10_HOME_DOMAINS').split(',')[0].trim();

    const authTimeout = optionalIntEnv('SEP10_AUTH_TIMEOUT', 900);

    // ── 4. Build the SEP-10 challenge transaction ───────────────────────────
    //
    // WebAuth.buildChallengeTx produces a transaction with:
    //   - A `manage_data` operation whose key is "<home_domain> auth" and
    //     whose value is a cryptographically random 48-byte nonce.
    //   - Tight timebounds: [now, now + timeout].
    //   - The server's SEP-10 keypair signature.
    //
    // The client must add its own signature before sending the XDR back.
    //
    // Exact SDK type signature (must be followed precisely to avoid XDR errors):
    //   buildChallengeTx(
    //     serverKeypair    : Keypair,
    //     clientAccountID  : string,
    //     homeDomain       : string,
    //     timeout          : number | undefined,   ← 4th
    //     networkPassphrase: string,               ← 5th
    //     webAuthDomain    : string,               ← 6th
    //     memo?            : string | null,        ← 7th (optional)
    //     clientDomain?    : string | null,        ← 8th (optional)
    //     clientSigningKey?: string | null         ← 9th (optional, omitted)
    //   ): string
    //
    // NOTE: Swapping `networkPassphrase` and `timeout` (positions 4 & 5) produces
    // a structurally invalid transaction XDR that wallets cannot deserialize —
    // the exact "unable to deserialize challengeTx" error seen during GET.
    const challengeXdr = WebAuth.buildChallengeTx(
      signingKeypair,     // 1. serverKeypair
      account,            // 2. clientAccountID
      homeDomain,         // 3. homeDomain
      authTimeout,        // 4. timeout (number | undefined)
      NETWORK_PASSPHRASE, // 5. networkPassphrase (string)
      homeDomain,         // 6. webAuthDomain (string)
      memo,               // 7. memo (string | null | undefined)
      clientDomain,       // 8. clientDomain (string | null | undefined)
    );

    // ── 4. Return the challenge ─────────────────────────────────────────────
    console.info(
      `[SEP-10 GET] Challenge issued | account=${account} | domain=${homeDomain}`,
    );

    return NextResponse.json(
      { transaction: challengeXdr },
      { status: 200 },
    );

  } catch (err: unknown) {
    // Any error here is a server-side misconfiguration (bad seed, env missing).
    const message = err instanceof Error ? err.message : String(err);
    console.error('[SEP-10 GET] Internal error:', message);
    return NextResponse.json(
      { error: 'Internal Server Error', message },
      { status: 500 },
    );
  }
}

// ── POST /api/auth ────────────────────────────────────────────────────────────
//
// Step 2 of the SEP-10 handshake: the client returns the challenge XDR,
// now signed by its own keypair.  The server verifies every aspect of the
// signed transaction and, if valid, mints a JWT bearer token.

export async function POST(request: Request): Promise<Response> {
  try {
    // ── 1. Parse request body ───────────────────────────────────────────────
    let body: Sep10PostBody;
    try {
      body = await request.json() as Sep10PostBody;
    } catch {
      return NextResponse.json(
        {
          error: 'Bad Request',
          message: 'Request body must be valid JSON.',
        },
        { status: 400 },
      );
    }

    if (!body?.transaction) {
      return NextResponse.json(
        {
          error: 'Bad Request',
          message: "Missing required field in body: 'transaction'",
        },
        { status: 400 },
      );
    }

    const signedChallengeXdr = body.transaction;

    // ── 2. Load runtime config ──────────────────────────────────────────────
    const signingKeypair = Keypair.fromSecret(
      requireEnv('SECRET_SEP10_SIGNING_SEED'),
    );
    const serverPublicKey = signingKeypair.publicKey();

    const jwtSecret = requireEnv('SECRET_SEP10_JWT_SECRET');
    const jwtTimeout = optionalIntEnv('SEP10_JWT_TIMEOUT', 86400);

    // Build an array of allowed home domains (comma-separated in env).
    const homeDomains = requireEnv('SEP10_HOME_DOMAINS')
      .split(',')
      .map((d) => d.trim())
      .filter(Boolean);

    // Use the primary domain for WebAuth domain validation.
    const primaryDomain = homeDomains[0];

    // ── 3. Read & structurally validate the challenge ───────────────────────
    //
    // readChallengeTx performs:
    //   - XDR decoding
    //   - TimeBounds validation (not expired, not too far in the future)
    //   - Server signature verification (was this challenge issued by us?)
    //   - Nonce / manage_data operation structure checks
    //
    // Returns: { tx, clientAccountID, matchedHomeDomain, memo }
    // Throws a descriptive Error on any failure → caught below → 401.
    const { clientAccountID, memo } = WebAuth.readChallengeTx(
      signedChallengeXdr,
      serverPublicKey,
      NETWORK_PASSPHRASE,
      homeDomains,     // array of allowed home domains
      primaryDomain,   // webAuthDomain
    );

    // ── 4. Hydrate the client's account signers from Horizon ────────────────
    //
    // verifyChallengeTxThreshold requires the full set of on-chain signers for
    // the client account to evaluate threshold requirements.
    // This supports multisig wallets transparently.
    const horizonServer = new Horizon.Server(HORIZON_URL);

    let accountSigners: Horizon.ServerApi.AccountRecordSigners[];
    try {
      const accountRecord = await horizonServer.loadAccount(clientAccountID);
      accountSigners = accountRecord.signers;
    } catch (horizonErr: unknown) {
      // The account might be unfunded (e.g. on testnet).  For SEP-10 we
      // require the account to exist on-chain so signers can be evaluated.
      const message =
        horizonErr instanceof Error ? horizonErr.message : String(horizonErr);
      console.warn(
        `[SEP-10 POST] Could not load account from Horizon: ${clientAccountID} — ${message}`,
      );
      return NextResponse.json(
        {
          error: 'Unauthorized',
          message:
            'Could not load account from the Stellar network. ' +
            'Ensure the account is funded and exists on-chain.',
        },
        { status: 401 },
      );
    }

    // ── 5. Verify signatures meet the account's medium threshold ────────────
    //
    // verifyChallengeTxThreshold validates:
    //   - Every signature on the transaction is from a known signer.
    //   - The cumulative weight of those signatures meets the provided threshold.
    //
    // For standard single-sig accounts, the master key weight (1) always
    // satisfies the low threshold (0) and medium threshold (0 by default).
    // For multisig accounts, the full signer set is checked against the threshold.
    //
    // We compute the total weight of all signers as the required threshold,
    // which matches the SDK's default "medium threshold" verification behaviour.
    //
    // Throws `InvalidChallengeError` on failure → caught below → 401.
    //
    // Signature: verifyChallengeTxThreshold(
    //   challengeTx, serverAccountID, networkPassphrase, threshold,
    //   signerSummary, homeDomains, webAuthDomain
    // )
    const totalWeight = accountSigners.reduce(
      (sum: number, signer: Horizon.ServerApi.AccountRecordSigners) =>
        sum + signer.weight,
      0,
    );

    WebAuth.verifyChallengeTxThreshold(
      signedChallengeXdr,
      serverPublicKey,
      NETWORK_PASSPHRASE,
      totalWeight,        // Required cumulative signer weight threshold
      accountSigners,     // On-chain signers list (ServerApi.AccountRecordSigners[])
      homeDomains,        // Allowed home domains
      primaryDomain,      // webAuthDomain
    );

    // ── 6. Mint the JWT bearer token ────────────────────────────────────────
    //
    // The JWT payload follows the SEP-10 spec:
    //   sub   — the authenticated account's Stellar public key
    //   iss   — the anchor's home domain (identifies the token issuer)
    //   iat   — issued-at timestamp (Unix seconds)
    //   exp   — expiry timestamp, enforced by downstream SEP handlers
    //
    // Optional:
    //   memo  — injected when present, identifying the muxed sub-account.
    //           Downstream SEP-24 / SEP-31 handlers MUST honour this claim
    //           to route to the correct user record.
    //
    // Algorithm: HS256 (symmetric — secret never leaves the backend).
    // The `exp` claim is set manually so that downstream middleware can read
    // expiry without re-verifying the full JWT on each call.
    const issuedAt = Math.floor(Date.now() / 1000);
    const expiresAt = issuedAt + jwtTimeout;

    // Build the core payload first, then conditionally spread `memo` so that
    // the claim is absent (not `null` or `undefined`) when there is no memo.
    const jwtPayload: Record<string, unknown> = {
      sub: clientAccountID,   // Verified Stellar public key (G…)
      iss: primaryDomain,     // Issuing anchor domain
      iat: issuedAt,
      exp: expiresAt,
      // Include the memo only when one was present in the verified challenge.
      // This lets downstream SEP handlers identify muxed / exchange sub-accounts.
      ...(memo != null ? { memo } : {}),
    };

    // jwt.sign with a pre-set `exp` in the payload; do NOT also pass
    // `expiresIn` to avoid a duplicate / conflicting claim.
    const token = jwt.sign(jwtPayload, jwtSecret, {
      algorithm: 'HS256',
    });

    console.info(
      `[SEP-10 POST] Token issued | account=${clientAccountID} | ` +
        `memo=${memo ?? 'none'} | ` +
        `exp=${new Date(expiresAt * 1000).toISOString()}`,
    );

    return NextResponse.json({ token }, { status: 200 });

  } catch (err: unknown) {
    // Stellar SDK throws for:
    //   - Expired timebounds              → challenge window elapsed
    //   - Invalid server signature        → forged / tampered challenge
    //   - Insufficient signing threshold  → client didn't sign correctly
    //   - Malformed XDR                   → garbage input
    //
    // All of these are client/auth failures, NOT server errors → 401.
    const message = err instanceof Error ? err.message : String(err);

    // Warn-level log — this is expected in adversarial conditions and should
    // NOT trigger an on-call alert for every failed auth attempt.
    console.warn('[SEP-10 POST] Auth verification failed:', message);

    return NextResponse.json(
      {
        error: 'Unauthorized',
        message:
          'SEP-10 challenge verification failed. ' +
          'Ensure the challenge is signed correctly and has not expired.',
      },
      { status: 401 },
    );
  }
}
