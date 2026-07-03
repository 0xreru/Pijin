/**
 * @file app/api/sep24/transactions/deposit/interactive/route.ts
 *
 * SEP-24: Interactive Deposit Initiation
 * ────────────────────────────────────────
 * Spec: https://stellar.org/protocol/sep-24#deposit-2
 *
 * POST /api/sep24/transactions/deposit/interactive
 *
 * Step 1 of the SEP-24 interactive deposit flow:
 *   1. Client sends a SEP-10 JWT in the Authorization: Bearer header.
 *   2. This handler verifies the JWT, extracts the user's Stellar account (sub),
 *      creates an AnchorTransaction record in the DB (status: incomplete),
 *      mints a short-lived "interactive URL JWT" for the webview handoff,
 *      and returns the interactive URL + transaction ID to the wallet.
 *
 * Security model
 * ──────────────
 * - The SEP-10 JWT proves the wallet controls the Stellar account.
 * - The interactive URL JWT uses a SEPARATE secret so a leaked webview URL
 *   cannot be replayed as a SEP-10 session credential.
 * - AnchorTransaction is bound to the authenticated account at creation time.
 *
 * Environment variables
 * ──────────────────────
 * SECRET_SEP10_JWT_SECRET                 Verifies the incoming SEP-10 session token.
 * SECRET_SEP24_INTERACTIVE_URL_JWT_SECRET Signs the short-lived webview token.
 * NEXT_PUBLIC_APP_URL                     Canonical origin (e.g. "https://pijin-api.vercel.app").
 */

// ── Runtime ───────────────────────────────────────────────────────────────────
export const runtime = 'nodejs';

// ── Imports ───────────────────────────────────────────────────────────────────
import { NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import { prisma } from '@/lib/prisma';
import { AnchorTxType } from '@prisma/client';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Asset codes this anchor accepts for deposits. Must match /info response. */
const SUPPORTED_DEPOSIT_ASSETS = new Set(['PHPC', 'USDC']);

/** Webview handoff JWT lifetime — short enough to limit replay window. */
const INTERACTIVE_JWT_TTL_SECONDS = 15 * 60; // 15 minutes

// ── Types ─────────────────────────────────────────────────────────────────────

interface Sep10JwtPayload {
  sub: string;
  iss?: string;
  iat?: number;
  exp?: number;
}

interface DepositRequestBody {
  asset_code?: string;
  memo_type?: string;
  memo?: string;
  [key: string]: string | undefined;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`[SEP-24 Deposit] Missing env var: ${name}`);
  return value;
}

/**
 * Extracts and verifies the SEP-10 Bearer JWT from an Authorization header.
 * Throws on any failure — the handler's catch block maps this to a 401.
 */
function verifyBearerToken(authHeader: string | null, secret: string): Sep10JwtPayload {
  if (!authHeader?.startsWith('Bearer ')) {
    throw new Error('Missing or malformed Authorization header. Expected: Bearer <token>');
  }
  const token = authHeader.slice('Bearer '.length).trim();
  const payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
  if (typeof payload !== 'object' || payload === null || !('sub' in payload)) {
    throw new Error('JWT payload is missing the required `sub` claim.');
  }
  return payload as Sep10JwtPayload;
}

/**
 * Bulletproof body parser — handles all content types sent by Web3 wallets:
 *
 *  • multipart/form-data           → native request.formData()  (Demo Wallet, most mobile wallets)
 *  • application/x-www-form-urlencoded → native request.formData()  (legacy wallets, curl)
 *  • application/json / text/plain → request.text() + conditional JSON.parse()
 *
 * Using request.formData() for both form types lets the browser's built-in
 * MIME parser handle boundary extraction for multipart bodies, which is far
 * more reliable than manual URLSearchParams parsing.
 */
async function parseRequestBody(request: Request): Promise<DepositRequestBody> {
  const contentType = request.headers.get('content-type') ?? '';

  // ── Form data: multipart OR url-encoded ─────────────────────────────────────
  if (
    contentType.includes('multipart/form-data') ||
    contentType.includes('application/x-www-form-urlencoded')
  ) {
    const formData = await request.formData();
    const body: DepositRequestBody = {};
    formData.forEach((value, key) => {
      // formData values can be File objects; only capture string fields.
      if (typeof value === 'string') {
        body[key] = value;
      }
    });
    return body;
  }

  // ── JSON / plain-text fallback ───────────────────────────────────────────────
  const text = await request.text();
  if (!text) return {};

  try {
    return JSON.parse(text) as DepositRequestBody;
  } catch {
    // Body was not valid JSON (e.g. empty or malformed) — return empty object
    // so downstream validation can produce a meaningful 400 error message.
    return {};
  }
}

// ── POST Handler ──────────────────────────────────────────────────────────────

export async function POST(request: Request): Promise<Response> {
  try {
    // ── 1. Authenticate: verify the SEP-10 session JWT ──────────────────────
    const sep10Secret = requireEnv('SECRET_SEP10_JWT_SECRET');
    let sessionPayload: Sep10JwtPayload;

    try {
      sessionPayload = verifyBearerToken(request.headers.get('authorization'), sep10Secret);
    } catch (authErr: unknown) {
      const message = authErr instanceof Error ? authErr.message : String(authErr);
      console.warn(`[SEP-24 Deposit] Auth failure: ${message}`);
      return NextResponse.json(
        { error: 'Unauthorized', message: 'A valid SEP-10 bearer token is required.' },
        { status: 401 },
      );
    }

    // `sub` is the authenticated wallet's Stellar public key (G…).
    const stellarAccount = sessionPayload.sub;

    // ── 2. Parse & validate the request body ────────────────────────────────
    let body: DepositRequestBody;
    try {
      body = await parseRequestBody(request);
    } catch {
      return NextResponse.json(
        { error: 'Bad Request', message: 'Could not parse request body.' },
        { status: 400 },
      );
    }

    const assetCode = body.asset_code?.toUpperCase();

    if (!assetCode) {
      return NextResponse.json(
        { error: 'Bad Request', message: "Missing required field: 'asset_code'" },
        { status: 400 },
      );
    }

    if (!SUPPORTED_DEPOSIT_ASSETS.has(assetCode)) {
      return NextResponse.json(
        {
          error: 'Bad Request',
          message: `Unsupported asset: '${assetCode}'. Supported: ${[...SUPPORTED_DEPOSIT_ASSETS].join(', ')}`,
        },
        { status: 400 },
      );
    }

    // ── 3. Persist the AnchorTransaction record ──────────────────────────────
    //
    // Created immediately so:
    //   (a) The UUID is available for the interactive URL.
    //   (b) The webview can update this record after the user fills the form.
    //   (c) The polling endpoint can return status to the wallet.
    //
    // Initial status is `incomplete` — the user has not yet completed the
    // interactive form.  The webview transitions it to
    // `pending_user_transfer_start` after collecting KYC/amount details.
    const anchorTx = await prisma.anchorTransaction.create({
      data: {
        stellarAccount,
        type: AnchorTxType.deposit,
        status: 'incomplete',
        assetCode,
        memo: body.memo ?? null,
        memoType: body.memo_type ?? null,
      },
    });

    console.info(
      `[SEP-24 Deposit] Transaction created | id=${anchorTx.id} | account=${stellarAccount} | asset=${assetCode}`,
    );

    // ── 4. Mint the short-lived interactive URL JWT ──────────────────────────
    //
    // Uses a SEPARATE secret from the SEP-10 JWT to enforce isolation:
    // a leaked URL token cannot be used as a session credential elsewhere.
    //
    // The frontend page at /deposit MUST verify this token before rendering.
    const interactiveSecret = requireEnv('SECRET_SEP24_INTERACTIVE_URL_JWT_SECRET');

    const interactiveToken = jwt.sign(
      {
        sub: stellarAccount,            // Authenticated account
        transaction_id: anchorTx.id,   // Ties the token to one specific tx
      },
      interactiveSecret,
      {
        algorithm: 'HS256',
        expiresIn: INTERACTIVE_JWT_TTL_SECONDS,
      },
    );

    // ── 5. Build the interactive webview URL ─────────────────────────────────
    //
    // Wallet opens this URL in a webview.  The frontend at /deposit MUST:
    //   1. Verify `token` with SECRET_SEP24_INTERACTIVE_URL_JWT_SECRET.
    //   2. Show the deposit form (amount, payment method, KYC fields).
    //   3. On submit, update the AnchorTransaction in the DB.
    //   4. Signal completion via the SEP-24 postMessage callback to the wallet.
    const appUrl = requireEnv('NEXT_PUBLIC_APP_URL').replace(/\/$/, '');
    const interactiveUrl =
      `${appUrl}/deposit` +
      `?transaction_id=${encodeURIComponent(anchorTx.id)}` +
      `&token=${encodeURIComponent(interactiveToken)}`;

    // ── 6. Return the SEP-24 interactive response ────────────────────────────
    //
    // `type` MUST be "interactive_customer_info_needed".
    // Wallet uses `url` for the webview and `id` to start polling
    // GET /api/sep24/transaction?id=<id> for status updates.
    return NextResponse.json(
      {
        type: 'interactive_customer_info_needed',
        url: interactiveUrl,
        id: anchorTx.id,
      },
      { status: 200 },
    );

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[SEP-24 Deposit] Internal error:', message);
    return NextResponse.json(
      { error: 'Internal Server Error', message },
      { status: 500 },
    );
  }
}
