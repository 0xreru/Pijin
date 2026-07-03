/**
 * @file app/deposit/page.tsx
 *
 * SEP-24: Interactive Deposit Webview
 * ────────────────────────────────────
 * Spec: https://stellar.org/protocol/sep-24#deposit
 *
 * This page is opened by the wallet client inside an in-app browser (webview)
 * after a successful deposit initiation.  The URL is short-lived and carries a
 * signed JWT so no additional authentication is needed from the user.
 *
 * Flow:
 *   1. Wallet calls POST /api/sep24/deposit  → anchor returns `interactive_url`
 *   2. Wallet opens this page in a webview
 *   3. User fills in the amount and clicks "Simulate GCash Payment"
 *   4. Client Component POSTs to /api/anchor/simulate-payment
 *   5. Server settles on Stellar; page shows success state
 *
 * Security
 * ────────
 * The `token` query-param is a HS256 JWT signed by the anchor with
 * SECRET_SEP24_INTERACTIVE_URL_JWT_SECRET.  It encodes:
 *   - transaction_id  (sub / tid)
 *   - stellarAccount  (act)
 *   - short expiry    (exp, typically 5–15 minutes)
 *
 * If the token is missing, invalid, or expired the page renders an opaque
 * error without exposing internals.
 */

// ── Imports ───────────────────────────────────────────────────────────────────
import { Suspense } from 'react';
import jwt from 'jsonwebtoken';
import { prisma } from '@/lib/prisma';
import type { AnchorTransaction } from '@prisma/client';
import DepositForm from './DepositForm';

// ── Helpers ───────────────────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

interface InteractiveJwtPayload {
  transaction_id?: string; // UUID minted by /api/sep24/transactions/deposit/interactive
  sub?: string;            // Stellar public key (G…) — NOT used for tx ID comparison
  act?: string;            // stellarAccount (informational; DB is authoritative)
  iat?: number;
  exp?: number;
}

// ── Error UI Primitives ───────────────────────────────────────────────────────

function ErrorCard({ title, message }: { title: string; message: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 to-slate-800 p-4">
      <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-8 max-w-sm w-full text-center shadow-2xl">
        {/* Red X icon */}
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-500/20 border border-red-500/30">
          <svg
            className="h-8 w-8 text-red-400"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-white mb-2">{title}</h1>
        <p className="text-sm text-slate-400 leading-relaxed">{message}</p>
      </div>
    </div>
  );
}

// ── Page (Server Component) ───────────────────────────────────────────────────

interface DepositPageProps {
  searchParams: Promise<{ transaction_id?: string; token?: string }>;
}

export default async function DepositPage({ searchParams }: DepositPageProps) {
  // Await searchParams — required in Next.js 15+
  const params = await searchParams;

  const { transaction_id, token } = params;

  // ── 1. Presence check ────────────────────────────────────────────────────
  if (!transaction_id || !token) {
    return (
      <ErrorCard
        title="Invalid Link"
        message="This deposit link is missing required parameters. Please return to your wallet and start a new deposit."
      />
    );
  }

  // ── 2. JWT Verification ─────────────────────────────────────────────────
  let jwtPayload: InteractiveJwtPayload;

  try {
    const secret = requireEnv('SECRET_SEP24_INTERACTIVE_URL_JWT_SECRET');
    const raw = jwt.verify(token, secret, { algorithms: ['HS256'] });
    if (typeof raw !== 'object' || raw === null) throw new Error('Empty payload');
    jwtPayload = raw as InteractiveJwtPayload;
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`[Deposit Webview] JWT verification failed for tx=${transaction_id}: ${reason}`);
    return (
      <ErrorCard
        title="Unauthorized / Expired Session"
        message="This deposit link has expired or is invalid. For security, deposit links are only valid for a short window. Please return to your wallet and try again."
      />
    );
  }

  // ── 3. transaction_id consistency check ─────────────────────────────────
  // jwtPayload.transaction_id is the UUID set by the minting route.
  // jwtPayload.sub holds the Stellar public key and must NOT be used as a
  // transaction ID fallback — doing so caused the previous Security Error.
  if (jwtPayload.transaction_id && jwtPayload.transaction_id !== transaction_id) {
    console.warn(
      `[Deposit Webview] transaction_id mismatch | url=${transaction_id} | jwt=${jwtPayload.transaction_id}`,
    );
    return (
      <ErrorCard
        title="Security Error"
        message="The transaction identifier in this URL does not match the signed token. This link may have been tampered with."
      />
    );
  }

  // ── 4. Database lookup ──────────────────────────────────────────────────
  let anchorTx: AnchorTransaction | null;

  try {
    anchorTx = await prisma.anchorTransaction.findUnique({
      where: { id: transaction_id },
    });
  } catch (dbErr: unknown) {
    const reason = dbErr instanceof Error ? dbErr.message : String(dbErr);
    console.error(`[Deposit Webview] DB error for tx=${transaction_id}: ${reason}`);
    return (
      <ErrorCard
        title="Service Unavailable"
        message="We could not retrieve your transaction details right now. Please try again in a moment."
      />
    );
  }

  if (!anchorTx) {
    return (
      <ErrorCard
        title="Transaction Not Found"
        message="This deposit transaction does not exist. It may have been cancelled. Please return to your wallet and start a new deposit."
      />
    );
  }

  // ── 5. Status guard — don't re-show completed / errored transactions ────
  if (anchorTx.status === 'completed') {
    return (
      <ErrorCard
        title="Already Completed"
        message={`This ${anchorTx.assetCode} deposit has already been processed. Check your wallet for the credited tokens.`}
      />
    );
  }

  // ── 6. Render the deposit form ──────────────────────────────────────────
  return (
    <Suspense>
      <DepositForm
        transactionId={anchorTx.id}
        assetCode={anchorTx.assetCode}
        stellarAccount={anchorTx.stellarAccount}
      />
    </Suspense>
  );
}
