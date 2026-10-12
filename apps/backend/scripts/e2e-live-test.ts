/**
 * End-to-End Simulation Script: Phase 2.2 Two-Phase Submission Live Test
 *
 * This script tests the complete offline payment pipeline by:
 * 1. Generating two new Stellar Keypairs (Sender and Receiver).
 * 2. Funding the Sender's public key on Stellar Testnet via Friendbot.
 * 3. Upserting the XLM token contract and registering both Sender & Receiver
 *    in the Postgres database via PrismaClient.
 *    (Crucial: `offline_device_key` and `stellar_public_key` store the Stellar G... address).
 * 4. Constructing a valid domain-separated 7-tuple XDR payload for `spend_offline`.
 * 5. Signing the XDR with the Sender's secret key and encoding into a 6-part SMS string.
 * 6. Posting the payload directly to the live Textbee SMS webhook with HMAC-SHA256 authentication.
 */

import 'dotenv/config';
import crypto from 'node:crypto';
import { Keypair } from '@stellar/stellar-sdk';
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
  'https://pijin-k5z0yqsdr-xrerus-projects.vercel.app/api/sms/webhook';

const WEBHOOK_SECRET = process.env.TEXTBEE_WEBHOOK_SECRET ?? '';
if (!WEBHOOK_SECRET) {
  throw new Error('TEXTBEE_WEBHOOK_SECRET is not set in environment.');
}

const DATABASE_URL = process.env.DATABASE_URL ?? '';
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is not set in environment.');
}

// User-provided configuration
const PIJIN_CONTRACT_ADDRESS =
  process.env.PIJIN_CONTRACT_OVERRIDE ||
  'CBYRV2FDGXHMKQILP3EWYI4ILKKQ2HW4NW4NJCFYQY6NEE7463ARLNUD';

const GATEWAY_PUBLIC_KEY =
  process.env.GATEWAY_PUBKEY_OVERRIDE ||
  'GDTDK62M4ZJU6QPCEFUSQWOPYED4I4GPHLB4ZZTMBZZL2AO2VK63VQUH';

// Testnet Native XLM Soroban SAC Address
const XLM_CONTRACT_ID = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';

// Short IDs (must be exactly 6 Base62 chars)
const SENDER_SHORT_ID = 'e2est1';
const RECEIVER_SHORT_ID = 'e2ert1';

const BASE62_ALPHABET =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

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

// ─────────────────────────────────────────────────────────────────────────────
// Main Execution
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('================================================================');
  console.log('       Pijin Phase 2.2 Live End-to-End Simulation Test          ');
  console.log('================================================================');
  console.log(`Webhook Target:  ${WEBHOOK_URL}`);
  console.log(`Pijin Contract:  ${PIJIN_CONTRACT_ADDRESS}`);
  console.log(`Gateway Key:     ${GATEWAY_PUBLIC_KEY}`);
  console.log(`XLM Token SAC:   ${XLM_CONTRACT_ID}`);

  // ── Step 1: Key Generation & Funding ───────────────────────────────────────
  console.log('\n--- Step 1: Generating Keypairs & Funding Sender ---');
  const senderKeypair = Keypair.random();
  const receiverKeypair = Keypair.random();

  console.log(`Sender Public Key:   ${senderKeypair.publicKey()}`);
  console.log(`Receiver Public Key: ${receiverKeypair.publicKey()}`);

  const fundedSender = await fundWithFriendbot(senderKeypair.publicKey(), 'Sender');
  if (!fundedSender) {
    console.warn('Friendbot funding reported a non-OK status. Continuing in case account already exists.');
  }

  // Also fund receiver to ensure account exists on ledger
  await fundWithFriendbot(receiverKeypair.publicKey(), 'Receiver');

  // ── Step 2: Database Registration ──────────────────────────────────────────
  console.log('\n--- Step 2: Registering Accounts and XLM Token in PostgreSQL ---');
  const adapter = new PrismaPg({ connectionString: DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  try {
    // 2a. Ensure XLM token exists in database
    const token = await prisma.token.upsert({
      where: { symbol: 'XLM' },
      update: {
        contractId: XLM_CONTRACT_ID,
        decimals: 7,
        isActive: true,
      },
      create: {
        symbol: 'XLM',
        contractId: XLM_CONTRACT_ID,
        decimals: 7,
        isActive: true,
      },
    });
    console.log(`XLM Token configured: ID = ${token.id}, Contract = ${token.contractId}`);

    // 2b. Upsert Sender Account
    // CRITICAL: offline_device_key and stellar_public_key are Stellar Public Addresses (G...)
    const senderAccount = await prisma.account.upsert({
      where: { shortId: SENDER_SHORT_ID },
      update: {
        stellarPublicKey: senderKeypair.publicKey(), // G... address
        offlineDeviceKey: senderKeypair.rawPublicKey().toString('hex'), // RAW HEX for Firewall
        phoneNumber: '+639123456789',
        pin: '123456',
        firstName: 'E2E',
        lastName: 'Sender',
        email: 'e2e-sender@pijin.dev',
      },
      create: {
        shortId: SENDER_SHORT_ID,
        stellarPublicKey: senderKeypair.publicKey(), // G... address
        offlineDeviceKey: senderKeypair.rawPublicKey().toString('hex'), // RAW HEX for Firewall
        phoneNumber: '+639123456789',
        pin: '123456',
        firstName: 'E2E',
        lastName: 'Sender',
        email: 'e2e-sender@pijin.dev',
      },
    });
    console.log(`Sender Account registered: shortId=${senderAccount.shortId}, dbId=${senderAccount.id}`);

    // 2c. Upsert Receiver Account
    const receiverAccount = await prisma.account.upsert({
      where: { shortId: RECEIVER_SHORT_ID },
      update: {
        stellarPublicKey: receiverKeypair.publicKey(), // G... address
        offlineDeviceKey: receiverKeypair.rawPublicKey().toString('hex'), // RAW HEX for Firewall
        phoneNumber: '+639987654321',
        pin: '654321',
        firstName: 'E2E',
        lastName: 'Receiver',
        email: 'e2e-receiver@pijin.dev',
      },
      create: {
        shortId: RECEIVER_SHORT_ID,
        stellarPublicKey: receiverKeypair.publicKey(), // G... address
        offlineDeviceKey: receiverKeypair.rawPublicKey().toString('hex'), // RAW HEX for Firewall
        phoneNumber: '+639987654321',
        pin: '654321',
        firstName: 'E2E',
        lastName: 'Receiver',
        email: 'e2e-receiver@pijin.dev',
      },
    });
    console.log(`Receiver Account registered: shortId=${receiverAccount.shortId}, dbId=${receiverAccount.id}`);

    // ── Step 3: Voucher Construction ─────────────────────────────────────────
    console.log('\n--- Step 3: Constructing and Signing 7-Tuple Offline Voucher ---');
    const amountStroops = 10_000_000n; // 1 XLM (7 decimals)
    const tollStroops = 0n; // 0 toll for XLM
    const nonce = crypto.randomBytes(32);

    // Build domain-separated 7-tuple XDR byte sequence
    const xdrBytes = buildOfflineSignatureXdr({
      amountStroops,
      tollStroops,
      nonce,
      receiverShortId: RECEIVER_SHORT_ID,
      gatewayPublicKey: GATEWAY_PUBLIC_KEY,
      tokenContractId: XLM_CONTRACT_ID,
      contractAddress: PIJIN_CONTRACT_ADDRESS,
    });
    console.log(`Constructed 7-Tuple XDR: ${xdrBytes.length} bytes`);

    // Sign the XDR using Sender's secret key
    const rawSignature = senderKeypair.sign(xdrBytes);
    console.log(`Generated Ed25519 signature: ${rawSignature.length} bytes`);

    // Verify locally as a firewall sanity check
    const localVerification = verifyOfflineVoucherSignature(
      senderKeypair.publicKey(),
      xdrBytes,
      rawSignature,
    );
    console.log(`Local Pre-Flight Signature Check: ${localVerification ? 'VALID' : 'INVALID'}`);
    if (!localVerification) {
      throw new Error('Local signature verification failed on freshly signed voucher!');
    }

    // Format parts for 6-part SMS string:
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

    // ── Step 4: Webhook Submission ───────────────────────────────────────────
    console.log('\n--- Step 4: Dispatching Webhook Request with HMAC ---');
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
      console.log('\nSUCCESS: Webhook accepted the offline voucher and buffered it for settlement!');
      console.log(`Trace ID: ${responseBody.traceId}`);
    } else {
      console.warn('\nNOTICE: Webhook returned a non-buffered response:', responseBody);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('\nE2E Live Test Fatal Error:', err);
  process.exit(1);
});
