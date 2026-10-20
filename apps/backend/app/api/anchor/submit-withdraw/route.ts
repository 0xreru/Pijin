/**
 * @swagger
 * /api/anchor/submit-withdraw:
 *   post:
 *     tags:
 *       - Anchor (SEP-24)
 *     summary: Submit withdrawal amount and GCash payout number (webview step)
 *     description: |
 *       Called by the `/withdraw` webview. Moves an `incomplete` withdrawal to
 *       `pending_user_transfer_start` and assigns a 28-character text memo that the
 *       user's on-chain payment to the treasury must carry.
 *
 *       - The interactive token's `transaction_id` must equal the body's `transaction_id` (`403` otherwise).
 *       - Amount must be positive with at most 7 decimals and within the ramp limits
 *         (`RAMP_MAX_PER_TX_*`, `RAMP_DAILY_MAX_PER_USER_*`).
 *       - The GCash number is validated but **never logged or stored**.
 *       - The status transition is conditional, so replaying a submit returns `409`.
 *     security:
 *       - InteractiveToken: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [transaction_id, amount, gcash_number]
 *             properties:
 *               transaction_id:
 *                 type: string
 *                 format: uuid
 *               amount:
 *                 oneOf:
 *                   - type: string
 *                   - type: number
 *                 example: "250.00"
 *               gcash_number:
 *                 type: string
 *                 description: "`09XXXXXXXXX` or `+639XXXXXXXXX`; spaces and dashes are stripped."
 *                 example: "09171234567"
 *     responses:
 *       '200':
 *         description: Withdrawal is now awaiting the user's Stellar payment.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *       '400':
 *         description: Invalid JSON, amount, GCash number, or ramp limit exceeded.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/RampError'
 *       '401':
 *         description: Interactive session is invalid or expired.
 *       '403':
 *         description: Body `transaction_id` does not match the signed session.
 *       '404':
 *         description: Transaction not found, or it belongs to a different account.
 *       '409':
 *         description: Withdrawal already submitted.
 *       '503':
 *         description: Withdrawals are disabled by the ramp kill switch.
 */

export const runtime = 'nodejs';

import jwt, { type JwtPayload } from 'jsonwebtoken';
import { type NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import {
  enforceRampKillSwitch,
  validateRampLimits,
  logRampAudit,
} from '@/lib/ramp-config';

interface SubmitWithdrawalBody {
  transaction_id?: unknown;
  amount?: unknown;
  gcash_number?: unknown;
}

interface InteractiveJwtPayload extends JwtPayload {
  sub: string;
  transaction_id: string;
}

const AMOUNT_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,7})?$/;
const GCASH_PATTERN = /^(?:09\d{9}|\+639\d{9})$/;

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`[Submit Withdrawal] Missing environment variable: ${name}`);
  return value;
}

function verifyInteractiveToken(request: NextRequest): InteractiveJwtPayload {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) throw new Error('Missing bearer token');

  const token = authorization.slice('Bearer '.length).trim();
  const payload = jwt.verify(token, requireEnv('SECRET_SEP24_INTERACTIVE_URL_JWT_SECRET'), {
    algorithms: ['HS256'],
  });

  if (
    typeof payload === 'string' ||
    typeof payload.sub !== 'string' ||
    typeof payload.transaction_id !== 'string'
  ) {
    throw new Error('Interactive token is missing required claims');
  }
  return payload as InteractiveJwtPayload;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const ip = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? '127.0.0.1';

  const killSwitchResponse = enforceRampKillSwitch('withdraw');
  if (killSwitchResponse) {
    return killSwitchResponse;
  }

  let tokenPayload: InteractiveJwtPayload;
  try {
    tokenPayload = verifyInteractiveToken(request);
  } catch (error: unknown) {
    console.warn(
      '[Submit Withdrawal] Interactive authentication failed:',
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      { success: false, error: 'This withdrawal session is invalid or has expired.' },
      { status: 401 },
    );
  }

  let body: SubmitWithdrawalBody;
  try {
    body = (await request.json()) as SubmitWithdrawalBody;
  } catch {
    return NextResponse.json(
      { success: false, error: 'The request body must be valid JSON.' },
      { status: 400 },
    );
  }

  const transactionId = typeof body.transaction_id === 'string' ? body.transaction_id.trim() : '';
  const amount = typeof body.amount === 'string' || typeof body.amount === 'number'
    ? String(body.amount).trim()
    : '';
  const gcashNumber = typeof body.gcash_number === 'string'
    ? body.gcash_number.replace(/[\s-]/g, '')
    : '';

  if (!transactionId || tokenPayload.transaction_id !== transactionId) {
    return NextResponse.json(
      { success: false, error: 'The transaction does not match this signed session.' },
      { status: 403 },
    );
  }
  if (!AMOUNT_PATTERN.test(amount) || Number(amount) <= 0) {
    return NextResponse.json(
      { success: false, error: 'amount must be positive and have at most 7 decimal places.' },
      { status: 400 },
    );
  }
  if (!GCASH_PATTERN.test(gcashNumber)) {
    return NextResponse.json(
      { success: false, error: 'gcash_number must be a valid 09XXXXXXXXX or +639XXXXXXXXX number.' },
      { status: 400 },
    );
  }

  // Check transaction existence and assetCode for limit validation
  const existingTx = await prisma.anchorTransaction.findUnique({
    where: { id: transactionId },
    select: { assetCode: true, stellarAccount: true },
  });

  if (!existingTx || existingTx.stellarAccount !== tokenPayload.sub) {
    return NextResponse.json(
      { success: false, error: 'Withdrawal transaction not found or account mismatch.' },
      { status: 404 },
    );
  }

  const limitCheck = await validateRampLimits(existingTx.stellarAccount, existingTx.assetCode, Number(amount));
  if (!limitCheck.allowed) {
    logRampAudit({
      action: 'withdraw',
      transactionId,
      user: existingTx.stellarAccount,
      amount,
      asset: existingTx.assetCode,
      ip,
      status: 'REJECTED',
      reason: limitCheck.error,
    });
    return NextResponse.json(
      { success: false, error: limitCheck.error ?? 'Withdrawal limit exceeded.' },
      { status: 400 },
    );
  }

  // A 28-byte text memo keeps the user transfer attributable to this withdrawal.
  const memo = transactionId.replace(/-/g, '').substring(0, 28);

  try {
    // The ownership/type/status predicates make this transition idempotency-safe
    // and prevent a signed URL from mutating another or already-started record.
    const result = await prisma.anchorTransaction.updateMany({
      where: {
        id: transactionId,
        stellarAccount: tokenPayload.sub,
        type: 'withdrawal',
        status: 'incomplete',
      },
      data: {
        status: 'pending_user_transfer_start',
        amountIn: amount,
        amountOut: amount,
        memo,
        memoType: 'text',
      },
    });

    if (result.count !== 1) {
      return NextResponse.json(
        { success: false, error: 'Withdrawal not found or it has already been submitted.' },
        { status: 409 },
      );
    }

    logRampAudit({
      action: 'withdraw',
      transactionId,
      user: tokenPayload.sub,
      amount,
      asset: existingTx.assetCode,
      ip,
      status: 'INITIATED',
    });

    // gcashNumber is deliberately not logged. Add an encrypted payout-details
    // model before persisting sensitive customer payout information.
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error: unknown) {
    console.error(`[Submit Withdrawal] Failed to update transaction ${transactionId}:`, error);
    return NextResponse.json(
      { success: false, error: 'Unable to submit the withdrawal.' },
      { status: 500 },
    );
  }
}
