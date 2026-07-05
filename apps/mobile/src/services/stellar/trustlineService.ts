/**
 * trustlineService.ts
 *
 * JIT (Just-in-Time) Trustline Service for Pijin.
 *
 * Responsibility: Given an asset code + issuer, determine whether the user
 * already trusts that asset and, if not, create the trustline on-chain.
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

// ─── Constants ───────────────────────────────────────────────────────────────

export const HORIZON_TESTNET_URL = 'https://horizon-testnet.stellar.org';

/** Minimum XLM reserve that must remain after paying the trustline base reserve. */
const BASE_FEE_STROOPS = 100;

/** Max ledgers to wait for confirmation before the tx expires. */
const TX_TIMEOUT_SECONDS = 30;

export type AssetCode = 'PHPC' | 'USDC';

export const PIJIN_ASSETS: Record<AssetCode, { code: string; issuer: string }> = {
  PHPC: {
    code: 'PHPC',
    issuer: 'GDDKZAOAME26SD2GAQGGDUTI6F5VQ5CLXXELWOYOAXLUIQTQVLIFWZLY',
  },
  USDC: {
    code: 'USDC',
    issuer: 'GDQGJU5JTW5IFCGS6JZTIGK57IKPW4N4LJWWEN7F3K3GSEJEYPVJ3BYA',
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
  assetCode: AssetCode,
): Promise<boolean> {
  const { issuer } = PIJIN_ASSETS[assetCode];

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

export async function ensureTrustline(
  publicKey: string,
  keypair: Keypair,
  assetCode: AssetCode,
): Promise<TrustlineResult> {
  const already = await hasTrustline(publicKey, assetCode);
  if (already) {
    return { status: 'exists', assetCode };
  }

  const sourceAccount = await testnetServer.loadAccount(publicKey);
  const { code, issuer } = PIJIN_ASSETS[assetCode];
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

  // 4. Sign with the user's keypair.
  transaction.sign(keypair);

  // 5. Convert to Base64 (With Polyfill Recovery for React Native)
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

  // 6. Submit to Testnet Horizon manually using fetch
  const response = await fetch(`${HORIZON_TESTNET_URL}/transactions`, {
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