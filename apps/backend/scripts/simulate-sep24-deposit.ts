/**
 * simulate-sep24-deposit.ts
 *
 * End-to-End Simulation Script for SEP-24 Interactive Deposit Flow:
 * 1. Generates a new random Stellar Keypair (representing a new mobile wallet).
 * 2. Funds the new keypair via Friendbot.
 * 3. Reads PHPC_ISSUER_PUBKEY directly from the backend's .env file (verifies new GCBC... key).
 * 4. Establishes a trustline for PHPC to the issuer on Stellar Testnet.
 * 5. Sends HTTP POST to ${NEXT_PUBLIC_APP_URL}/api/anchor/simulate-payment mimicking DepositForm.
 * 6. Logs the API response and verifies the account's final PHPC balance on the ledger.
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import {
  Asset,
  Horizon,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Redis } from '@upstash/redis';

// ─── 0. Configuration & Environment Setup ─────────────────────────────────────

const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

function cleanEnv(val?: string): string {
  return (val || '').trim().replace(/^['"]|['"]$/g, '');
}

const HORIZON_TESTNET_URL =
  cleanEnv(process.env.HORIZON_URL) || 'https://horizon-testnet.stellar.org';
const horizon = new Horizon.Server(HORIZON_TESTNET_URL);

const appBaseUrl =
  cleanEnv(process.env.NEXT_PUBLIC_APP_URL) || 'http://localhost:3000';
const SIMULATE_PAYMENT_URL = `${appBaseUrl.replace(/\/$/, '')}/api/anchor/simulate-payment`;

const connectionString = cleanEnv(process.env.DATABASE_URL);
const prisma = connectionString
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
  : null;

function getRedisClient(): Redis | null {
  const url = cleanEnv(process.env.UPSTASH_REDIS_REST_URL);
  const token = cleanEnv(process.env.UPSTASH_REDIS_REST_TOKEN);
  if (!url || !token) return null;
  return new Redis({ url, token });
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log('🚀 SEP-24 Interactive Deposit Simulation Test');
  console.log('═══════════════════════════════════════════════════════════════════════');

  // ─── 1. Generate New Stellar Keypair (Mobile Wallet) ─────────────────────────
  console.log('\n[1/6] Generating new random Stellar keypair for mobile wallet...');
  const mobileWallet = Keypair.random();
  const publicKey = mobileWallet.publicKey();
  console.log(`  • Public Key: ${publicKey}`);
  console.log(`  • Secret Key: ${mobileWallet.secret().slice(0, 5)}...[REDACTED]`);

  // ─── 2. Fund Keypair via Friendbot ───────────────────────────────────────────
  console.log('\n[2/6] Funding new mobile wallet via Friendbot...');
  const friendbotUrl = `https://friendbot.stellar.org/?addr=${encodeURIComponent(publicKey)}`;
  const friendbotRes = await fetch(friendbotUrl);
  if (!friendbotRes.ok) {
    const errorText = await friendbotRes.text().catch(() => '');
    throw new Error(`Friendbot funding failed with status ${friendbotRes.status}: ${errorText}`);
  }
  console.log('  ✅ Mobile wallet funded with base Testnet XLM.');

  // ─── 3. Read PHPC_ISSUER_PUBKEY from .env ───────────────────────────────────
  console.log('\n[3/6] Reading PHPC_ISSUER_PUBKEY from backend .env file...');
  const phpcIssuerPubkey = cleanEnv(process.env.PHPC_ISSUER_PUBKEY);
  console.log(`  • Resolved PHPC_ISSUER_PUBKEY: ${phpcIssuerPubkey}`);

  if (!phpcIssuerPubkey) {
    throw new Error('PHPC_ISSUER_PUBKEY is missing in backend .env file.');
  }
  if (!phpcIssuerPubkey.startsWith('G')) {
    throw new Error(`Invalid PHPC_ISSUER_PUBKEY format: ${phpcIssuerPubkey}`);
  }
  if (phpcIssuerPubkey === 'GCBC6SUF536YKVWQVX3LXZIGXYHW6ZX3CKHGNNSOPVCDGPFWC73YMSWK') {
    console.log('  ✅ Verified: matches the expected new PHPC Issuer key.');
  } else {
    console.warn(`  ⚠️ Warning: Issuer key is ${phpcIssuerPubkey} (different from standard GCBC... key).`);
  }

  // ─── 4. Establish Trustline on Testnet ───────────────────────────────────────
  console.log('\n[4/6] Establishing PHPC trustline on Testnet for the mobile wallet...');
  const phpcAsset = new Asset('PHPC', phpcIssuerPubkey);
  const account = await horizon.loadAccount(publicKey);

  const trustlineTx = new TransactionBuilder(account, {
    fee: '1000',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.changeTrust({
        asset: phpcAsset,
      }),
    )
    .setTimeout(60)
    .build();

  trustlineTx.sign(mobileWallet);
  const trustlineResult = await horizon.submitTransaction(trustlineTx);
  console.log(`  ✅ Trustline established successfully! Tx Hash: ${trustlineResult.hash}`);

  // ─── 5. Prepare Mock Data & Call /api/anchor/simulate-payment ────────────────
  const transactionId = 'mock-tx-123';
  const depositAmount = '100';

  console.log('\n[5/6] Preparing mock SEP-24 transaction and interactive session...');
  
  // 5a. Upsert mock AnchorTransaction in database so backend can validate it
  if (prisma) {
    try {
      await prisma.anchorTransaction.upsert({
        where: { id: transactionId },
        create: {
          id: transactionId,
          stellarAccount: publicKey,
          type: 'deposit',
          status: 'incomplete',
          assetCode: 'PHPC',
          amountIn: depositAmount,
        },
        update: {
          stellarAccount: publicKey,
          status: 'incomplete',
          assetCode: 'PHPC',
          amountIn: depositAmount,
        },
      });
      console.log(`  • Seeded AnchorTransaction record in database (id: ${transactionId})`);
    } catch (dbErr) {
      console.warn('  ⚠️ Note: Could not upsert AnchorTransaction in DB (backend may be mock-only):', dbErr);
    }
  }

  // 5b. Clear single-use token lock in Redis if configured
  try {
    const redis = getRedisClient();
    if (redis) {
      await redis.del(`pijin:sep24:token:used:${transactionId}`);
      console.log('  • Cleared single-use token Redis cache for mock transaction');
    }
  } catch (redisErr) {
    // Non-critical in test environments
  }

  // 5c. Generate short-lived interactive token signed with SECRET_SEP24_INTERACTIVE_URL_JWT_SECRET
  const jwtSecret = cleanEnv(process.env.SECRET_SEP24_INTERACTIVE_URL_JWT_SECRET);
  let interactiveToken: string | undefined;
  if (jwtSecret) {
    interactiveToken = jwt.sign(
      {
        sub: publicKey,
        transaction_id: transactionId,
      },
      jwtSecret,
      {
        algorithm: 'HS256',
        expiresIn: 900,
      },
    );
    console.log('  • Generated signed SEP-24 interactive JWT token');
  }

  // 5d. Dispatch HTTP POST to /api/anchor/simulate-payment mimicking DepositForm.tsx
  console.log(`\n  Dispatching POST request to: ${SIMULATE_PAYMENT_URL}`);
  const payload = {
    transaction_id: transactionId,
    amount: depositAmount,
    stellarAccount: publicKey,
    token: interactiveToken,
  };
  console.log('  • Request Payload:', JSON.stringify(payload, null, 2));

  const response = await fetch(SIMULATE_PAYMENT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(interactiveToken ? { Authorization: `Bearer ${interactiveToken}` } : {}),
    },
    body: JSON.stringify(payload),
  });

  const responseBody = await response.json().catch(() => ({}));

  console.log(`\n  • Response HTTP Status: ${response.status} ${response.statusText}`);
  console.log('  • Response Body:', JSON.stringify(responseBody, null, 2));

  // ─── 6. Validate Response & Verify Balance on Ledger ─────────────────────────
  console.log('\n[6/6] Verifying simulation outcome and on-chain balances...');

  if (!response.ok || !responseBody.success) {
    console.error('\n❌ SIMULATION FAILED:');
    console.error(`  Error:  ${responseBody.error ?? 'Unknown error'}`);
    if (responseBody.detail) {
      console.error(`  Detail: ${responseBody.detail}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log('\n✅ Backend payment simulation succeeded!');
  console.log(`  • Stellar Tx Hash: ${responseBody.stellar_tx_hash}`);
  console.log(`  • Settled Amount:  ${responseBody.amount} ${responseBody.asset_code}`);
  console.log(`  • Destination:     ${responseBody.destination}`);

  // Query updated balances on Horizon ledger
  console.log('\nChecking ledger balances for mobile wallet...');
  const updatedAccount = await horizon.loadAccount(publicKey);
  let phpcBalanceFound = '0';

  console.log('  Account Balances:');
  for (const b of updatedAccount.balances) {
    if (b.asset_type === 'native') {
      console.log(`    - XLM:  ${b.balance}`);
    } else if ('asset_code' in b) {
      console.log(`    - ${b.asset_code} (Issuer: ${b.asset_issuer}): ${b.balance}`);
      if (b.asset_code === 'PHPC' && b.asset_issuer === phpcIssuerPubkey) {
        phpcBalanceFound = b.balance;
      }
    }
  }

  const numericBalance = parseFloat(phpcBalanceFound);
  if (numericBalance >= 100) {
    console.log(`\n🎉 SUCCESS! Mobile wallet received ${numericBalance} PHPC.`);
    console.log('   The backend correctly picked up the new PHPC issuer and settled the payment without op_no_trust error!');
  } else {
    console.error(`\n⚠️ Warning: Expected at least 100 PHPC, but found ${numericBalance} PHPC.`);
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error('\n❌ UNHANDLED SCRIPT ERROR:');
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      if (prisma) await prisma.$disconnect();
    } catch {}
  });
