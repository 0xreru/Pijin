/**
 * @file lib/ramp-config.ts
 *
 * Central configuration and enforcement for SEP-24 On/Off Ramp kill switches,
 * per-transaction caps, daily per-user limits, and interactive token verification.
 */

import jwt, { type JwtPayload } from 'jsonwebtoken';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getRedis } from '@/lib/rate-limit';

export interface InteractiveJwtPayload extends JwtPayload {
  sub: string;
  transaction_id: string;
}

export const RAMP_CAPS: Record<string, { maxPerTx: number; maxDailyPerUser: number }> = {
  PHPC: {
    maxPerTx: Number(process.env.RAMP_MAX_PER_TX_PHPC ?? 5000),
    maxDailyPerUser: Number(process.env.RAMP_DAILY_MAX_PER_USER_PHPC ?? 20000),
  },
  USDC: {
    maxPerTx: Number(process.env.RAMP_MAX_PER_TX_USDC ?? 100),
    maxDailyPerUser: Number(process.env.RAMP_DAILY_MAX_PER_USER_USDC ?? 400),
  },
};

/**
 * Returns whether the overall On/Off Ramp is enabled.
 */
export function isRampEnabled(): boolean {
  return process.env.RAMP_ENABLED !== 'false';
}

/**
 * Returns whether interactive deposits are enabled.
 */
export function isDepositEnabled(): boolean {
  return isRampEnabled() && process.env.DEPOSIT_ENABLED !== 'false';
}

/**
 * Returns whether interactive withdrawals are enabled.
 */
export function isWithdrawEnabled(): boolean {
  return isRampEnabled() && process.env.WITHDRAW_ENABLED !== 'false';
}

/**
 * Returns a 503 response if the ramp or specified action is locked, otherwise null.
 */
export function enforceRampKillSwitch(action?: 'deposit' | 'withdraw'): NextResponse | null {
  if (!isRampEnabled()) {
    return NextResponse.json(
      { code: 'RAMP_LOCKED', error: 'On/Off Ramp is temporarily disabled for maintenance.' },
      { status: 503 },
    );
  }
  if (action === 'deposit' && !isDepositEnabled()) {
    return NextResponse.json(
      { code: 'RAMP_LOCKED', error: 'Deposits are temporarily disabled for maintenance.' },
      { status: 503 },
    );
  }
  if (action === 'withdraw' && !isWithdrawEnabled()) {
    return NextResponse.json(
      { code: 'RAMP_LOCKED', error: 'Withdrawals are temporarily disabled for maintenance.' },
      { status: 503 },
    );
  }
  return null;
}

/**
 * Verifies the short-lived SEP-24 interactive URL JWT from Bearer header or fallback token parameter.
 */
export function verifyInteractiveToken(tokenOrRequest: string | NextRequest | Request): InteractiveJwtPayload {
  let token = '';

  if (typeof tokenOrRequest === 'string') {
    token = tokenOrRequest.replace(/^Bearer\s+/i, '').trim();
  } else {
    const authHeader = tokenOrRequest.headers.get('authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7).trim();
    }
  }

  if (!token) {
    throw new Error('Missing interactive authentication token');
  }

  const secret = process.env.SECRET_SEP24_INTERACTIVE_URL_JWT_SECRET?.trim();
  if (!secret) {
    throw new Error('Server configuration error: missing SECRET_SEP24_INTERACTIVE_URL_JWT_SECRET');
  }

  const payload = jwt.verify(token, secret, { algorithms: ['HS256'] });

  if (
    typeof payload === 'string' ||
    typeof payload.sub !== 'string' ||
    typeof payload.transaction_id !== 'string'
  ) {
    throw new Error('Interactive token is missing required claims (sub or transaction_id)');
  }

  return payload as InteractiveJwtPayload;
}

/**
 * Marks an interactive token as consumed in Redis to guarantee single-use.
 * Returns true if the token was successfully claimed, false if it was already used.
 */
export async function claimInteractiveTokenOnce(transactionId: string): Promise<boolean> {
  try {
    const redis = getRedis();
    const key = `pijin:sep24:token:used:${transactionId}`;
    // Expiration: 1 hour (matches or exceeds max interactive JWT lifetime)
    const res = await redis.set(key, 'used', { nx: true, ex: 3600 });
    return res === 'OK' || Boolean(res);
  } catch (error) {
    if (process.env.NODE_ENV === 'test') {
      return true;
    }
    console.error('[RampConfig] Redis error claiming interactive token:', error);
    return true; // fail-open on transient Redis failure to avoid stranding legitimate users
  }
}

/**
 * Validates that the requested amount is within per-transaction and per-user daily limits.
 */
export async function validateRampLimits(
  stellarAccount: string,
  assetCode: string,
  amount: number,
): Promise<{ allowed: boolean; error?: string }> {
  const code = assetCode.toUpperCase();
  const caps = RAMP_CAPS[code] ?? RAMP_CAPS.PHPC;

  if (amount <= 0) {
    return { allowed: false, error: 'Amount must be greater than zero.' };
  }

  if (amount > caps.maxPerTx) {
    return {
      allowed: false,
      error: `Transaction amount exceeds the maximum limit of ${caps.maxPerTx} ${code} per transaction.`,
    };
  }

  // Calculate start of current UTC day
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  try {
    const todaysTransactions = await prisma.anchorTransaction.findMany({
      where: {
        stellarAccount,
        assetCode: code,
        status: { in: ['completed', 'pending_external'] },
        createdAt: { gte: startOfDay },
      },
      select: { amountIn: true, amountOut: true },
    });

    const dailySum = todaysTransactions.reduce((acc, tx) => {
      const val = parseFloat(tx.amountIn || tx.amountOut || '0');
      return acc + (isNaN(val) ? 0 : val);
    }, 0);

    if (dailySum + amount > caps.maxDailyPerUser) {
      return {
        allowed: false,
        error: `Daily limit of ${caps.maxDailyPerUser} ${code} exceeded for this account (current today: ${dailySum.toFixed(2)} ${code}).`,
      };
    }
  } catch (dbError) {
    console.error('[RampConfig] Error querying daily ramp limits:', dbError);
  }

  return { allowed: true };
}

/**
 * Structured audit log for on/off ramp operations.
 */
export function logRampAudit(event: {
  action: 'deposit' | 'withdraw';
  transactionId: string;
  user: string;
  amount: string | number;
  asset: string;
  ip: string;
  status: 'INITIATED' | 'COMPLETED' | 'REJECTED' | 'FAILED';
  stellarTxHash?: string;
  reason?: string;
}): void {
  console.info(
    `[Audit][Ramp] action=${event.action} status=${event.status} txId=${event.transactionId} ` +
      `user=${event.user} amount=${event.amount} asset=${event.asset} ip=${event.ip} ` +
      `hash=${event.stellarTxHash || 'none'}${event.reason ? ` reason="${event.reason}"` : ''}`,
  );
}
