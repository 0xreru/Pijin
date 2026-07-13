export const runtime = 'nodejs';

import jwt, { type JwtPayload } from 'jsonwebtoken';
import { type NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';

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
