/**
 * @file app/api/sep24/transaction/route.ts
 *
 * SEP-24: Transaction Status Polling Endpoint
 * ────────────────────────────────────────────
 * Spec: https://stellar.org/protocol/sep-24#transaction
 *
 * GET /api/sep24/transaction?id=<uuid>
 *
 * The wallet calls this endpoint repeatedly (polling) after receiving the
 * interactive URL from the deposit/withdraw initiation endpoint.  It is also
 * called to verify completion before finalising a deposit or withdrawal.
 *
 * Authentication
 * ──────────────
 * This endpoint requires the SEP-10 session JWT.  The verified `sub` claim is
 * compared against the `stellarAccount` field on the DB record — this is the
 * authorisation gate ensuring users can only read their own transactions.
 *
 * Status lifecycle (matches AnchorTxStatus Prisma enum)
 * ──────────────────────────────────────────────────────
 *   incomplete              → User has not yet completed the interactive form.
 *   pending_user_transfer_start → User submitted the form; awaiting fiat transfer.
 *   pending_external        → Anchor received payment; broadcasting to Stellar.
 *   completed               → Stellar transaction confirmed.
 *   error                   → Permanent failure; inspect `message` for details.
 *
 * Security note
 * ─────────────
 * We return 404 (not 403) for both "not found" AND "account mismatch" cases.
 * This prevents an authenticated attacker from discovering valid transaction
 * IDs belonging to other users via a timing/oracle attack.
 *
 * Environment variables
 * ──────────────────────
 * SECRET_SEP10_JWT_SECRET  Used to verify the incoming Bearer token.
 */

// ── Runtime ───────────────────────────────────────────────────────────────────
export const runtime = 'nodejs';

// ── Imports ───────────────────────────────────────────────────────────────────
import { NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import { prisma } from '@/lib/prisma';
import type { AnchorTransaction } from '@prisma/client';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Sep10JwtPayload {
  sub: string;
  iss?: string;
  iat?: number;
  exp?: number;
}

/**
 * SEP-24 transaction object shape returned by this endpoint.
 * Field names match the specification exactly so wallet clients can parse them
 * without any mapping.
 */
interface Sep24TransactionResponse {
  id: string;
  kind: string;
  status: string;
  amount_in: string | null;
  amount_out: string | null;
  amount_fee: string | null;
  stellar_account: string;
  asset_code: string;
  started_at: string;
  updated_at: string;
  memo: string | null;
  memo_type: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`[SEP-24 Transaction] Missing env var: ${name}`);
  return value;
}

/**
 * Extracts and verifies the SEP-10 Bearer JWT.
 * Throws on any failure — the handler maps this to 401.
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
 * Maps a Prisma AnchorTransaction record to the SEP-24 transaction response format.
 *
 * The spec uses `kind` (not `type`) in the response object, and snake_case field
 * names.  All Prisma camelCase fields are remapped here.
 */
function toSep24Transaction(tx: AnchorTransaction): Sep24TransactionResponse {
  return {
    id: tx.id,
    kind: tx.type,                              // Prisma: `type` → SEP-24: `kind`
    status: tx.status,
    amount_in: tx.amountIn,                     // null until webview submits
    amount_out: tx.amountOut,                   // null until anchor processes
    amount_fee: tx.amountFee,                   // null until anchor calculates fees
    stellar_account: tx.stellarAccount,
    asset_code: tx.assetCode,
    started_at: tx.createdAt.toISOString(),     // ISO 8601 format per spec
    updated_at: tx.updatedAt.toISOString(),
    memo: tx.memo,
    memo_type: tx.memoType,
  };
}

// ── GET Handler ───────────────────────────────────────────────────────────────

/**
 * GET /api/sep24/transaction?id=<uuid>
 *
 * Returns the current status of a single SEP-24 transaction.
 * Authentication is required; users can only access their own transactions.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    // ── 1. Authenticate: verify the SEP-10 session JWT ──────────────────────
    const sep10Secret = requireEnv('SECRET_SEP10_JWT_SECRET');
    let sessionPayload: Sep10JwtPayload;

    try {
      sessionPayload = verifyBearerToken(request.headers.get('authorization'), sep10Secret);
    } catch (authErr: unknown) {
      const message = authErr instanceof Error ? authErr.message : String(authErr);
      console.warn(`[SEP-24 Transaction] Auth failure: ${message}`);
      return NextResponse.json(
        { error: 'Unauthorized', message: 'A valid SEP-10 bearer token is required.' },
        { status: 401 },
      );
    }

    // The authenticated Stellar public key — used as the ownership gate below.
    const authenticatedAccount = sessionPayload.sub;

    // ── 2. Extract & validate the `id` query parameter ──────────────────────
    const { searchParams } = new URL(request.url);
    const transactionId = searchParams.get('id');

    if (!transactionId) {
      return NextResponse.json(
        { error: 'Bad Request', message: "Missing required query parameter: 'id'" },
        { status: 400 },
      );
    }

    // ── 3. Fetch the transaction from the database ───────────────────────────
    const anchorTx = await prisma.anchorTransaction.findUnique({
      where: { id: transactionId },
    });

    // ── 4. Authorisation gate: ownership check ───────────────────────────────
    //
    // Return 404 for BOTH cases:
    //   (a) Transaction does not exist in the DB.
    //   (b) Transaction exists but belongs to a different account.
    //
    // Returning 404 in both cases prevents an authenticated attacker from
    // discovering valid transaction IDs belonging to other users.
    if (!anchorTx || anchorTx.stellarAccount !== authenticatedAccount) {
      console.warn(
        `[SEP-24 Transaction] Not found or account mismatch | ` +
          `id=${transactionId} | requestedBy=${authenticatedAccount}`,
      );
      return NextResponse.json(
        { error: 'Not Found', message: 'Transaction not found.' },
        { status: 404 },
      );
    }

    // ── 5. Map to SEP-24 response format and return ──────────────────────────
    const transactionResponse = toSep24Transaction(anchorTx);

    console.info(
      `[SEP-24 Transaction] Fetched | id=${anchorTx.id} | status=${anchorTx.status}`,
    );

    // SEP-24 wraps the transaction object under a `transaction` key.
    return NextResponse.json(
      { transaction: transactionResponse },
      { status: 200 },
    );

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[SEP-24 Transaction] Internal error:', message);
    return NextResponse.json(
      { error: 'Internal Server Error', message },
      { status: 500 },
    );
  }
}
