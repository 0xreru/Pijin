/**
 * End-to-End Simulation Script: PHPC Custom Token Offline Voucher Pipeline
 *
 * This script tests the complete offline payment pipeline for custom PHPC tokens by:
 * 1. Generating two new Stellar Keypairs (Sender and Receiver).
 * 2. Funding both accounts with base XLM via Friendbot for reserves and fees.
 * 3. Establishing trustlines for the PHPC asset on both Sender and Receiver via Horizon.
 * 4. Funding both Sender and Receiver with 100 PHPC each from the PHPC distributor account.
 * 5. Registering/upserting both accounts in PostgreSQL using the G... Stellar public address.
 * 6. Ensuring the PHPC token contract (ID: 1) is active in PostgreSQL.
 * 7. Constructing, signing, and dispatching a 7-tuple offline voucher for 10 PHPC to the Textbee webhook.
 */

import 'dotenv/config';
import crypto from 'node:crypto';
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
import {
  buildOfflineSignatureXdr,
  verifyOfflineVoucherSignature,
} from '../lib/offline-voucher';

// ─────────────────────────────────────────────────────────────────────────────
// Configuration & Constants
// ─────────────────────────────────────────────────────────────────────────────

const WEBHOOK_URL =
  process.env.WEBHOOK_URL ||
  'https://pijin-4621epw44-xrerus-projects.vercel.app/api/sms/webhook';

const WEBHOOK_SECRET = process.env.TEXTBEE_WEBHOOK_SECRET ?? '';
if (!WEBHOOK_SECRET) {
  throw new Error('TEXTBEE_WEBHOOK_SECRET is not set in environment.');
}

const DATABASE_URL = process.env.DATABASE_URL ?? '';
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is not set in environment.');
}

const PHPC_DISTRIBUTOR_SECRET = process.env.PHPC_DISTRIBUTOR_SECRET?.trim() ?? '';
if (!PHPC_DISTRIBUTOR_SECRET) {
  throw new Error('Missing PHPC_DISTRIBUTOR_SECRET in process.env');
}

const HORIZON_URL =
  process.env.STELLAR_HORIZON_URL || 'https://horizon-testnet.stellar.org';

const NETWORK_PASSPHRASE =
  process.env.STELLAR_NETWORK_PASSPHRASE || Networks.TESTNET;

// PHPC Classic Asset Details
const PHPC_ISSUER_PUBKEY =
  process.env.PHPC_ISSUER_PUBKEY?.trim() ||
  'GDDKZAOAME26SD2GAQGGDUTI6F5VQ5CLXXELWOYOAXLUIQTQVLIFWZLY';

const PHPC_CONTRACT_ID =
  process.env.PHPC_CONTRACT_ID?.trim() ||
  'CD26OANM4I4GF2GBC47UYTSP3FUBZRQ7WGMGECEQHMZ2D6QV2LXJTNIS';

const PIJIN_CONTRACT_ADDRESS =
  process.env.PIJIN_CONTRACT_OVERRIDE ||
  'CBYRV2FDGXHMKQILP3EWYI4ILKKQ2HW4NW4NJCFYQY6NEE7463ARLNUD';

const GATEWAY_PUBLIC_KEY =
  process.env.GATEWAY_PUBKEY_OVERRIDE ||
  'GDTDK62M4ZJU6QPCEFUSQWOPYED4I4GPHLB4ZZTMBZZL2AO2VK63VQUH';

const BASE62_ALPHABET =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function generateRandomShortId(length = 6): string {
  return Array.from(crypto.randomBytes(length))
    .map((b) => BASE62_ALPHABET[b % 62])
    .join('');
}
// Short IDs (must be exactly 6 Base62 chars)
const SENDER_SHORT_ID = generateRandomShortId();
const RECEIVER_SHORT_ID = generateRandomShortId();

function encodeBase62(amount: bigint): string {
  if (amount === 0n) return '0';
  let result = '';
  let current = amount;
  while (current > 0n) {
    const remainder = Number(current % 62n);
    result = BASE62_ALPHABET[remainder] + result;
    current /= 62n;
  }
  return result;
}

function computeHmac(rawBody: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
}

async function fundWithFriendbot(publicKey: string, label: string): Promise<boolean> {
  const friendbotUrl = `https://friendbot.stellar.org?addr=${encodeURIComponent(publicKey)}`;
  console.log(`[Friendbot] Funding ${label} (${publicKey})...`);
  try {
    const res = await fetch(friendbotUrl);
    if (!res.ok) {
      const errText = await res.text();
      console.warn(`[Friendbot] HTTP ${res.status}: ${errText}`);
      return false;
    }
    const json = (await res.json()) as { successful?: boolean; hash?: string };
    console.log(`[Friendbot] Successfully funded ${label}! (txHash: ${json.hash || 'ok'})`);
    return true;
  } catch (err) {
    console.error(`[Friendbot] Network error funding ${label}:`, err);
    return false;
  }
}

/**
 * Submits a changeTrust operation to establish a trustline for the specified asset.
 */
async function establishTrustline(
  keypair: Keypair,
  asset: Asset,
  horizon: Horizon.Server,
  label: string,
): Promise<string> {
  console.log(`[Trustline] Establishing PHPC trustline for ${label} (${keypair.publicKey()})...`);
  const account = await horizon.loadAccount(keypair.publicKey());
  const tx = new TransactionBuilder(account, {
    fee: '10000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(Operation.changeTrust({ asset }))
    .setTimeout(30)
    .build();

  tx.sign(keypair);
  const result = await horizon.submitTransaction(tx);
  console.log(`[Trustline] Trustline established for ${label}! (txHash: ${result.hash})`);
  return result.hash;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Pipeline
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('================================================================');
  console.log('       Pijin PHPC Custom Token E2E Live Test Pipeline          ');
  console.log('================================================================');
  console.log(`Webhook Target:   ${WEBHOOK_URL}`);
  console.log(`Horizon Server:   ${HORIZON_URL}`);
  console.log(`Pijin Contract:   ${PIJIN_CONTRACT_ADDRESS}`);
  console.log(`Gateway Key:      ${GATEWAY_PUBLIC_KEY}`);
  console.log(`PHPC Issuer:      ${PHPC_ISSUER_PUBKEY}`);
  console.log(`PHPC Contract ID: ${PHPC_CONTRACT_ID}`);

  const horizon = new Horizon.Server(HORIZON_URL);
  const phpcAsset = new Asset('PHPC', PHPC_ISSUER_PUBKEY);

  // ── Step 1: Account Generation & Base XLM Funding ──────────────────────────
  console.log('\n--- Step 1: Generating Keypairs & Base XLM Funding ---');
  const senderKeypair = Keypair.random();
  const receiverKeypair = Keypair.random();

  console.log(`Sender Public Key:   ${senderKeypair.publicKey()}`);
  console.log(`Receiver Public Key: ${receiverKeypair.publicKey()}`);

  const fundedSender = await fundWithFriendbot(senderKeypair.publicKey(), 'Sender');
  if (!fundedSender) throw new Error('Failed to fund Sender via Friendbot.');

  const fundedReceiver = await fundWithFriendbot(receiverKeypair.publicKey(), 'Receiver');
  if (!fundedReceiver) throw new Error('Failed to fund Receiver via Friendbot.');

  // ── Step 2: Establish Trustlines ───────────────────────────────────────────
  console.log('\n--- Step 2: Establishing PHPC Trustlines ---');
  await establishTrustline(senderKeypair, phpcAsset, horizon, 'Sender');
  await establishTrustline(receiverKeypair, phpcAsset, horizon, 'Receiver');

  // ── Step 3: Fund Accounts with PHPC ────────────────────────────────────────
  console.log('\n--- Step 3: Funding Accounts with 100 PHPC each ---');
  const distributorKeypair = Keypair.fromSecret(PHPC_DISTRIBUTOR_SECRET);
  console.log(`Distributor Public Key: ${distributorKeypair.publicKey()}`);

  const distributorAccount = await horizon.loadAccount(distributorKeypair.publicKey());
  const fundingTx = new TransactionBuilder(distributorAccount, {
    fee: '20000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.payment({
        destination: senderKeypair.publicKey(),
        asset: phpcAsset,
        amount: '100',
      }),
    )
    .addOperation(
      Operation.payment({
        destination: receiverKeypair.publicKey(),
        asset: phpcAsset,
        amount: '100',
      }),
    )
    .setTimeout(30)
    .build();

  fundingTx.sign(distributorKeypair);
  const fundingResult = await horizon.submitTransaction(fundingTx);
  console.log(`[Payment] Distributed 100 PHPC to Sender & Receiver! (txHash: ${fundingResult.hash})`);

  // ── Step 4: Database Registration ──────────────────────────────────────────
  console.log('\n--- Step 4: Registering Accounts and PHPC Token in PostgreSQL ---');
  const adapter = new PrismaPg({ connectionString: DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  try {
    // 4a. Ensure PHPC Token exists with ID 1
    const token = await prisma.token.upsert({
      where: { id: 1 },
      update: {
        symbol: 'PHPC',
        contractId: PHPC_CONTRACT_ID,
        decimals: 7,
        isActive: true,
      },
      create: {
        id: 1,
        symbol: 'PHPC',
        contractId: PHPC_CONTRACT_ID,
        decimals: 7,
        isActive: true,
      },
    });
    console.log(`PHPC Token configured: ID = ${token.id}, Symbol = ${token.symbol}, Contract = ${token.contractId}`);

    // 4b. Upsert Sender Account
    // CRITICAL: offlineDeviceKey and stellarPublicKey store the Stellar G... address, NOT hex
    const senderAccount = await prisma.account.upsert({
      where: { shortId: SENDER_SHORT_ID },
      update: {
        stellarPublicKey: senderKeypair.publicKey(),
        offlineDeviceKey: senderKeypair.publicKey(),
        phoneNumber: '+639123456789',
        pin: '123456',
        firstName: 'E2E',
        lastName: 'Sender',
        email: 'e2e-sender@pijin.dev',
      },
      create: {
        shortId: SENDER_SHORT_ID,
        stellarPublicKey: senderKeypair.publicKey(),
        offlineDeviceKey: senderKeypair.publicKey(),
        phoneNumber: '+639123456789',
        pin: '123456',
        firstName: 'E2E',
        lastName: 'Sender',
        email: 'e2e-sender@pijin.dev',
      },
    });
    console.log(`Sender registered: shortId=${senderAccount.shortId}, dbId=${senderAccount.id}`);

    // 4c. Upsert Receiver Account
    const receiverAccount = await prisma.account.upsert({
      where: { shortId: RECEIVER_SHORT_ID },
      update: {
        stellarPublicKey: receiverKeypair.publicKey(),
        offlineDeviceKey: receiverKeypair.publicKey(),
        phoneNumber: '+639987654321',
        pin: '654321',
        firstName: 'E2E',
        lastName: 'Receiver',
        email: 'e2e-receiver@pijin.dev',
      },
      create: {
        shortId: RECEIVER_SHORT_ID,
        stellarPublicKey: receiverKeypair.publicKey(),
        offlineDeviceKey: receiverKeypair.publicKey(),
        phoneNumber: '+639987654321',
        pin: '654321',
        firstName: 'E2E',
        lastName: 'Receiver',
        email: 'e2e-receiver@pijin.dev',
      },
    });
    console.log(`Receiver registered: shortId=${receiverAccount.shortId}, dbId=${receiverAccount.id}`);

    // ── Step 5: Construct & Send Voucher ─────────────────────────────────────
    console.log('\n--- Step 5: Constructing and Signing PHPC Offline Voucher ---');
    const amountStroops = 100_000_000n; // 10 PHPC (7 decimals)
    const tollStroops = 0n;    // 0.5 PHPC protocol toll for PHPC transfers
    const nonce = crypto.randomBytes(32);

    // Build domain-separated 7-tuple XDR payload
    const xdrBytes = buildOfflineSignatureXdr({
      amountStroops,
      tollStroops,
      nonce,
      receiverShortId: RECEIVER_SHORT_ID,
      gatewayPublicKey: GATEWAY_PUBLIC_KEY,
      tokenContractId: PHPC_CONTRACT_ID,
      contractAddress: PIJIN_CONTRACT_ADDRESS,
    });
    console.log(`Constructed 7-Tuple XDR: ${xdrBytes.length} bytes`);

    // Sign the XDR using Sender's secret key
    const rawSignature = senderKeypair.sign(xdrBytes);
    console.log(`Generated Ed25519 signature: ${rawSignature.length} bytes`);

    // Local firewall pre-flight sanity verification
    const localVerification = verifyOfflineVoucherSignature(
      senderKeypair.publicKey(),
      xdrBytes,
      rawSignature,
    );
    console.log(`Local Pre-Flight Signature Check: ${localVerification ? 'VALID' : 'INVALID'}`);
    if (!localVerification) {
      throw new Error('Local signature verification failed on freshly signed voucher!');
    }

    // Format 6-part SMS string:
    // <tokenId>:<senderId>:<receiverId>:<amountBase62>:<nonceBase64>:<signatureBase64>
    const tokenIdStr = token.id.toString();
    const amountBase62 = encodeBase62(amountStroops);
    const nonceBase64 = nonce.toString('base64').replace(/=+$/, '');
    const signatureBase64 = rawSignature.toString('base64').replace(/=+$/, '');

    const smsPayload = [
      tokenIdStr,
      SENDER_SHORT_ID,
      RECEIVER_SHORT_ID,
      amountBase62,
      nonceBase64,
      signatureBase64,
    ].join(':');

    console.log('\nFormatted SMS Payload:');
    console.log(`>>> ${smsPayload} <<<`);
    console.log(`Payload character count: ${smsPayload.length} chars`);

    // ── Webhook Submission ───────────────────────────────────────────────────
    console.log('\n--- Webhook Submission with HMAC Authentication ---');
    const mockSenderPhone = '+639123456789';
    const textbeeBody = {
      event: 'MESSAGE_RECEIVED',
      data: {
        sender: mockSenderPhone,
        message: smsPayload,
      },
      sender: mockSenderPhone,
      message: smsPayload,
      device: 'pijin-live-e2e-tester',
    };

    const rawBody = JSON.stringify(textbeeBody);
    const hmacSignature = computeHmac(rawBody, WEBHOOK_SECRET);
    const timestamp = Math.floor(Date.now() / 1000).toString();

    console.log(`Computed HMAC-SHA256: ${hmacSignature}`);
    console.log(`Sending POST request to ${WEBHOOK_URL}...`);

    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-signature': hmacSignature,
        'x-textbee-signature': hmacSignature,
        'x-timestamp': timestamp,
      },
      body: rawBody,
    });

    const responseStatus = response.status;
    const responseStatusText = response.statusText;
    const responseBody = await response.json().catch(() => null);

    console.log(`\nWebhook HTTP Status: [${responseStatus}] ${responseStatusText}`);
    console.log('Webhook Response Body:', JSON.stringify(responseBody, null, 2));

    if (response.ok && responseBody?.status === 'Buffered') {
      console.log('\nSUCCESS: Webhook accepted the PHPC offline voucher and buffered it for settlement!');
      console.log(`Trace ID: ${responseBody.traceId}`);
    } else {
      console.warn('\nNOTICE: Webhook response outcome:', responseBody);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('\nE2E Live Test Fatal Error:', err);
  process.exit(1);
});
