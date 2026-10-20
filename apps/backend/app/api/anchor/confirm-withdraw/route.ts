/**
 * @swagger
 * /api/anchor/confirm-withdraw:
 *   post:
 *     tags:
 *       - Anchor (SEP-24)
 *     summary: Confirm the user's on-chain withdrawal payment
 *     description: |
 *       After the wallet pays the treasury, the app posts the Stellar transaction hash.
 *       The backend reads it from **Horizon** and accepts it only if **all** of these hold:
 *
 *       - the transaction succeeded and its source account is the authenticated user;
 *       - it carries a `text` memo equal to the memo issued by `submit-withdraw`;
 *       - it contains a `payment` from the user to `TREASURY_PUBLIC_KEY` in the withdrawal's
 *         asset (code **and** issuer) for exactly the submitted amount.
 *
 *       On success the withdrawal moves to `pending_external` (fiat payout pending).
 *       Repeating the call after success returns `200` with the same status.
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [transaction_id, stellar_transaction_id]
 *             properties:
 *               transaction_id:
 *                 type: string
 *                 format: uuid
 *               stellar_transaction_id:
 *                 type: string
 *                 pattern: '^[0-9a-f]{64}$'
 *                 description: Hex transaction hash (case-insensitive).
 *     responses:
 *       '200':
 *         description: Payment verified (or already verified).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 status:
 *                   type: string
 *                   example: pending_external
 *       '400':
 *         description: Invalid JSON or IDs.
 *       '401':
 *         description: Missing or invalid SEP-10 token.
 *       '404':
 *         description: Withdrawal not found for this account.
 *       '409':
 *         description: Withdrawal is not awaiting a user transfer, or its status changed concurrently.
 *       '422':
 *         description: The Stellar payment does not match this withdrawal.
 *       '500':
 *         description: Horizon or database failure.
 *       '503':
 *         description: Withdrawals are disabled by the ramp kill switch.
 */

export const runtime = 'nodejs';

import jwt from 'jsonwebtoken';
import { type NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { enforceRampKillSwitch, logRampAudit } from '@/lib/ramp-config';

const HORIZON_TESTNET_URL = 'https://horizon-testnet.stellar.org';

interface ConfirmWithdrawalBody {
  transaction_id?: unknown;
  stellar_transaction_id?: unknown;
}

interface HorizonTransaction {
  successful?: unknown;
  source_account?: unknown;
  memo?: unknown;
  memo_type?: unknown;
}

interface HorizonOperation {
  type?: unknown;
  from?: unknown;
  to?: unknown;
  asset_type?: unknown;
  asset_code?: unknown;
  asset_issuer?: unknown;
  amount?: unknown;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`[Confirm Withdrawal] Missing environment variable: ${name}`);
  return value;
}

function authenticatedAccount(request: NextRequest): string {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) throw new Error('Missing bearer token');
  const payload = jwt.verify(
    authorization.slice('Bearer '.length).trim(),
    requireEnv('SECRET_SEP10_JWT_SECRET'),
    { algorithms: ['HS256'] },
  );
  if (typeof payload === 'string' || typeof payload.sub !== 'string' || !payload.sub.trim()) {
    throw new Error('SEP-10 token is missing a valid sub claim');
  }
  return payload.sub;
}

function amountToStroops(value: string): bigint {
  const match = /^(\d+)(?:\.(\d{1,7}))?$/.exec(value);
  if (!match) throw new Error(`Invalid Stellar amount: ${value}`);
  return BigInt(match[1]) * 10_000_000n + BigInt((match[2] ?? '').padEnd(7, '0'));
}

function issuerFor(assetCode: string): string {
  if (assetCode === 'PHPC') return requireEnv('PHPC_ISSUER_PUBKEY');
  if (assetCode === 'USDC') return requireEnv('USDC_ISSUER_PUBKEY');
  throw new Error(`Unsupported withdrawal asset: ${assetCode}`);
}

async function horizonJson(url: string): Promise<Record<string, unknown>> {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Horizon returned HTTP ${response.status}`);
  return (await response.json()) as Record<string, unknown>;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const ip = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? '127.0.0.1';

  const killSwitchResponse = enforceRampKillSwitch('withdraw');
  if (killSwitchResponse) {
    return killSwitchResponse;
  }

  let account: string;
  try {
    account = authenticatedAccount(request);
  } catch (error: unknown) {
    console.warn('[Confirm Withdrawal] Authentication failed:', error instanceof Error ? error.message : error);
    return NextResponse.json({ success: false, error: 'A valid SEP-10 token is required.' }, { status: 401 });
  }

  let body: ConfirmWithdrawalBody;
  try {
    body = (await request.json()) as ConfirmWithdrawalBody;
  } catch {
    return NextResponse.json({ success: false, error: 'The request body must be valid JSON.' }, { status: 400 });
  }

  const transactionId = typeof body.transaction_id === 'string' ? body.transaction_id.trim() : '';
  const stellarTransactionId = typeof body.stellar_transaction_id === 'string'
    ? body.stellar_transaction_id.trim().toLowerCase()
    : '';
  if (!transactionId || !/^[0-9a-f]{64}$/.test(stellarTransactionId)) {
    return NextResponse.json({ success: false, error: 'Valid transaction IDs are required.' }, { status: 400 });
  }

  try {
    const anchorTx = await prisma.anchorTransaction.findFirst({
      where: { id: transactionId, stellarAccount: account, type: 'withdrawal' },
    });
    if (!anchorTx) {
      return NextResponse.json({ success: false, error: 'Withdrawal not found.' }, { status: 404 });
    }
    if (anchorTx.status === 'pending_external') {
      return NextResponse.json({ success: true, status: 'pending_external' }, { status: 200 });
    }
    if (anchorTx.status !== 'pending_user_transfer_start' || !anchorTx.amountIn || !anchorTx.memo) {
      return NextResponse.json({ success: false, error: 'Withdrawal is not awaiting a user transfer.' }, { status: 409 });
    }

    const [transaction, operationsResponse] = await Promise.all([
      horizonJson(`${HORIZON_TESTNET_URL}/transactions/${stellarTransactionId}`),
      horizonJson(`${HORIZON_TESTNET_URL}/transactions/${stellarTransactionId}/operations?limit=200`),
    ]);
    const tx = transaction as HorizonTransaction;
    const embedded = operationsResponse._embedded;
    const operations = typeof embedded === 'object' && embedded !== null && Array.isArray((embedded as { records?: unknown }).records)
      ? (embedded as { records: HorizonOperation[] }).records
      : [];
    const expectedAmount = anchorTx.amountIn;
    const expectedMemo = anchorTx.memo;
    const treasury = requireEnv('TREASURY_PUBLIC_KEY');
    const issuer = issuerFor(anchorTx.assetCode);

    const transactionMatches =
      tx.successful === true &&
      tx.source_account === account &&
      tx.memo_type === 'text' &&
      tx.memo === expectedMemo;
    const paymentMatches = operations.some((operation) =>
      operation.type === 'payment' &&
      operation.from === account &&
      operation.to === treasury &&
      operation.asset_type !== 'native' &&
      operation.asset_code === anchorTx.assetCode &&
      operation.asset_issuer === issuer &&
      typeof operation.amount === 'string' &&
      amountToStroops(operation.amount) === amountToStroops(expectedAmount),
    );

    if (!transactionMatches || !paymentMatches) {
      console.warn(`[Confirm Withdrawal] Horizon verification mismatch | id=${transactionId} | hash=${stellarTransactionId}`);
      logRampAudit({
        action: 'withdraw',
        transactionId,
        user: account,
        amount: expectedAmount,
        asset: anchorTx.assetCode,
        ip,
        status: 'FAILED',
        stellarTxHash: stellarTransactionId,
        reason: 'Horizon verification mismatch',
      });
      return NextResponse.json({ success: false, error: 'The Stellar payment does not match this withdrawal.' }, { status: 422 });
    }

    const update = await prisma.anchorTransaction.updateMany({
      where: { id: transactionId, stellarAccount: account, status: 'pending_user_transfer_start' },
      data: { status: 'pending_external' },
    });
    if (update.count !== 1) {
      return NextResponse.json({ success: false, error: 'Withdrawal status changed during confirmation.' }, { status: 409 });
    }

    console.info(`[Confirm Withdrawal] Payment verified | id=${transactionId} | hash=${stellarTransactionId}`);
    logRampAudit({
      action: 'withdraw',
      transactionId,
      user: account,
      amount: expectedAmount,
      asset: anchorTx.assetCode,
      ip,
      status: 'COMPLETED',
      stellarTxHash: stellarTransactionId,
    });
    return NextResponse.json({ success: true, status: 'pending_external' }, { status: 200 });
  } catch (error: unknown) {
    console.error(`[Confirm Withdrawal] Failed | id=${transactionId}:`, error);
    return NextResponse.json({ success: false, error: 'Unable to verify the Stellar withdrawal payment.' }, { status: 500 });
  }
}
