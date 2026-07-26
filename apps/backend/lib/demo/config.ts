import { timingSafeEqual } from 'node:crypto';
import { Networks } from '@stellar/stellar-sdk';

const DEFAULT_PAIR_COUNT = 14;
const DEFAULT_QA_PAIR_COUNT = 2;
const DEFAULT_SESSION_TTL_HOURS = 12;

function positiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export function demoPoolConfig() {
  const targetPairs = positiveInteger(process.env.DEMO_POOL_TARGET_PAIRS, DEFAULT_PAIR_COUNT);
  const qaPairs = Math.min(
    positiveInteger(process.env.DEMO_POOL_QA_PAIRS, DEFAULT_QA_PAIR_COUNT),
    targetPairs,
  );

  return {
    targetPairs,
    qaPairs,
    judgePairs: targetPairs - qaPairs,
    sessionTtlHours: positiveInteger(
      process.env.DEMO_SESSION_TTL_HOURS,
      DEFAULT_SESSION_TTL_HOURS,
    ),
  };
}

export function assertDemoEnabled(): void {
  const enabled =
    process.env.DEMO_ENABLED === 'true' ||
    (process.env.NODE_ENV !== 'production' && process.env.DEMO_ENABLED !== 'false');
  if (!enabled) throw new DemoDisabledError();
}

export function assertDemoTestnet(): void {
  const passphrase = process.env.STELLAR_NETWORK_PASSPHRASE ?? Networks.TESTNET;
  if (passphrase !== Networks.TESTNET) {
    throw new Error('Demo account pool is restricted to Stellar Testnet');
  }
}

export function assertDemoAccessCode(candidate: string | null): void {
  const configured = process.env.DEMO_ACCESS_CODE;
  if (!configured) return;

  const expected = Buffer.from(configured);
  const actual = Buffer.from(candidate ?? '');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new DemoUnauthorizedError();
  }
}

export class DemoDisabledError extends Error {
  constructor() {
    super('Demo sessions are disabled');
    this.name = 'DemoDisabledError';
  }
}

export class DemoUnauthorizedError extends Error {
  constructor() {
    super('Invalid demo access code');
    this.name = 'DemoUnauthorizedError';
  }
}
