/**
 * trustlineService.ts
 *
 * Stellar trustline service for Pijin account onboarding.
 *
 * Responsibility: Given an asset code + issuer, determine whether the user
 * already trusts that asset and, if not, create the trustline on-chain before
 * registration completes.
 */

import { Buffer } from 'buffer';
import {
  Asset,
  Horizon,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { fetchWithTimeout } from '../api/client';

// ─── Constants ───────────────────────────────────────────────────────────────

export const HORIZON_TESTNET_URL = 'https://horizon-testnet.stellar.org';

/** Minimum XLM reserve that must remain after paying the trustline base reserve. */
const BASE_FEE_STROOPS = 100;

/** Max ledgers to wait for confirmation before the tx expires. */
const TX_TIMEOUT_SECONDS = 30;

export type AssetCode = 'PHPC' | 'USDC';

function cleanEnv(value?: string): string {
  return (value || '').trim().replace(/^['"]|['"]$/g, '');
}

export const PHPC_ISSUER =
  cleanEnv(process.env.EXPO_PUBLIC_PHPC_ISSUER_PUBKEY) ||
  'GCBC6SUF536YKVWQVX3LXZIGXYHW6ZX3CKHGNNSOPVCDGPFWC73YMSWK';

export const USDC_ISSUER =
  cleanEnv(process.env.EXPO_PUBLIC_USDC_ISSUER_PUBKEY) ||
  'GDQGJU5JTW5IFCGS6JZTIGK57IKPW4N4LJWWEN7F3K3GSEJEYPVJ3BYA';

export const PIJIN_ASSETS: Record<AssetCode, { code: string; issuer: string }> = {
  PHPC: {
    code: 'PHPC',
    issuer: PHPC_ISSUER,
  },
  USDC: {
    code: 'USDC',
    issuer: USDC_ISSUER,
  },
};

// ─── Types ───────────────────────────────────────────────────────────────────

export type TrustlineStatus = 'exists' | 'created';

export interface TrustlineResult {
  status: TrustlineStatus;
  assetCode: AssetCode;
}

// ─── Horizon Server (Testnet) ─────────────────────────────────────────────────

const testnetServer = new Horizon.Server(HORIZON_TESTNET_URL);

// ─── Public API ──────────────────────────────────────────────────────────────

export async function hasTrustline(
  publicKey: string,
  assetCode: AssetCode = 'PHPC',
): Promise<boolean> {
  const issuer =
    (assetCode === 'PHPC'
      ? cleanEnv(process.env.EXPO_PUBLIC_PHPC_ISSUER_PUBKEY)
      : cleanEnv(process.env.EXPO_PUBLIC_USDC_ISSUER_PUBKEY)) ||
    PIJIN_ASSETS[assetCode]?.issuer;
  
  if (!issuer || issuer.length !== 56) {
    throw new Error(`CRITICAL: Invalid or missing issuer key for ${assetCode}. Current value: ${issuer}`);
  }
  let account: Awaited<ReturnType<typeof testnetServer.loadAccount>>;
  try {
    account = await testnetServer.loadAccount(publicKey);
  } catch (err: unknown) {
    const status =
      isObject(err) &&
      isObject(err['response']) &&
      (err['response'] as Record<string, unknown>)['status'];
    if (status === 404) {
      return false;
    }
    throw err;
  }

  return account.balances.some((balance) => {
    if (balance.asset_type === 'native') return false;
    if (!('asset_code' in balance)) return false;
    return balance.asset_code === assetCode && balance.asset_issuer === issuer;
  });
}

/** Fallback helper to fund an account on Testnet if it does not yet exist */
async function fundAccountViaFriendbot(publicKey: string): Promise<void> {
  try {
    await fetchWithTimeout(
      `https://friendbot.stellar.org/?addr=${encodeURIComponent(publicKey)}`,
      { method: 'GET' },
    );
  } catch (err) {
    console.warn('[TrustlineService] Friendbot funding fallback notice:', err);
  }
}

export async function ensureTrustline(
  publicKey: string,
  keypairOrSecret: Keypair | string,
  assetCode: AssetCode = 'PHPC',
): Promise<TrustlineResult> {
  const signerKeypair =
    typeof keypairOrSecret === 'string'
      ? Keypair.fromSecret(keypairOrSecret)
      : keypairOrSecret;

  const already = await hasTrustline(publicKey, assetCode);
  if (already) {
    return { status: 'exists', assetCode };
  }

  let sourceAccount: Awaited<ReturnType<typeof testnetServer.loadAccount>>;
  try {
    sourceAccount = await testnetServer.loadAccount(publicKey);
  } catch (err: unknown) {
    const status =
      isObject(err) &&
      isObject(err['response']) &&
      (err['response'] as Record<string, unknown>)['status'];
    if (status === 404) {
      await fundAccountViaFriendbot(publicKey);
      sourceAccount = await testnetServer.loadAccount(publicKey);
    } else {
      throw err;
    }
  }

  const issuer =
    (assetCode === 'PHPC'
      ? cleanEnv(process.env.EXPO_PUBLIC_PHPC_ISSUER_PUBKEY)
      : cleanEnv(process.env.EXPO_PUBLIC_USDC_ISSUER_PUBKEY)) ||
    PIJIN_ASSETS[assetCode]?.issuer;
  const { code } = PIJIN_ASSETS[assetCode];
  const asset = new Asset(code, issuer);

  const transaction = new TransactionBuilder(sourceAccount, {
    fee: String(BASE_FEE_STROOPS),
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.changeTrust({
        asset,
      }),
    )
    .setTimeout(TX_TIMEOUT_SECONDS)
    .build();

  // Sign with the mobile wallet's keypair / secret key.
  transaction.sign(signerKeypair);

  // Convert to Base64 (with polyfill recovery for React Native).
  const rawXdr = transaction.toXDR() as unknown;
  let txBase64 = '';

  if (typeof rawXdr === 'string') {
    if (rawXdr.includes(',')) {
      // We parse the string back into an array of numbers, convert to Uint8Array, and encode it properly.
      const bytesArray = rawXdr.split(',').map((numStr) => parseInt(numStr, 10));
      const uint8Bytes = new Uint8Array(bytesArray);
      txBase64 = Buffer.from(uint8Bytes).toString('base64');
    } else {
      // It's already a valid Base64 string
      txBase64 = rawXdr;
    }
  } else if (rawXdr instanceof Uint8Array || Buffer.isBuffer(rawXdr)) {
    // If it correctly returned bytes, encode them
    txBase64 = Buffer.from(rawXdr).toString('base64');
  }

  // Submit to Testnet Horizon manually using fetch.
  const response = await fetchWithTimeout(`${HORIZON_TESTNET_URL}/transactions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: `tx=${encodeURIComponent(txBase64)}`,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    console.error(
      '[TrustlineService] Horizon submission failed:',
      JSON.stringify(errorData, null, 2)
    );
    
    const resultCodes = errorData?.extras?.result_codes;
    const detail = resultCodes ? JSON.stringify(resultCodes) : (errorData?.detail || 'Transaction malformed.');
    
    throw new TrustlineError(`Transaction Failed: ${detail}`, assetCode, detail);
  }

  return { status: 'created', assetCode };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

export class TrustlineError extends Error {
  constructor(
    message: string,
    public readonly assetCode: AssetCode,
    public readonly detail?: string,
  ) {
    super(message);
    this.name = 'TrustlineError';
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
