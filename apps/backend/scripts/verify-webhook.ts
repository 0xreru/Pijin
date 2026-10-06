import 'dotenv/config';
import crypto from 'crypto';

// Configuration (Match .env values)
const WEBHOOK_SECRET = process.env.TEXTBEE_WEBHOOK_SECRET || 'my-super-secret-password-123';
// NOTE!! If testing locally, we MUST use an ngrok URL so QStash can reach /api/engine/settle route.
const WEBHOOK_URL =
  process.env.WEBHOOK_URL ||
  'https://pijin-rigfcidn5-xrerus-projects.vercel.app/api/sms/webhook';
const SETTLE_URL =
  process.env.SETTLE_URL ||
  WEBHOOK_URL.replace(/\/api\/sms\/webhook\/?$/, '/api/engine/settle');

const mockSender = '+639975598413';

function createMockSms(customNonce?: string) {
  const mockTokenId = '1';
  const mockSenderShortId = 'aB3x9Q';
  const mockReceiverShortId = 'Zx7mNk';
  const mockAmountBase62 = '3v5K';
  const mockNonceBase64 = customNonce || crypto.randomBytes(32).toString('base64').replace(/=+$/, '');
  const mockSignatureBase64 = crypto.randomBytes(64).toString('base64').replace(/=+$/, '');

  const body = `${mockTokenId}:${mockSenderShortId}:${mockReceiverShortId}:${mockAmountBase62}:${mockNonceBase64}:${mockSignatureBase64}`;
  return { nonce: mockNonceBase64, body };
}

function createTextbeePayload(smsMessage: string) {
  return {
    event: 'MESSAGE_RECEIVED',
    data: {
      message: smsMessage,
      sender: mockSender,
    },
    sender: mockSender,
    message: smsMessage,
    device: process.env.TEXTBEE_DEVICE_ID || 'demo-device-id',
  };
}

function computeHmac(rawBody: string, secret = WEBHOOK_SECRET): string {
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

// ─────────────────────────────────────────────────────────────────────────────
// Baseline: Legitimate Webhook Request
// ─────────────────────────────────────────────────────────────────────────────
async function runBaselineSimulation() {
  console.log('\n================================================================');
  console.log('--- BASELINE: Legitimate Textbee Ingress ---');
  console.log(`Target: ${WEBHOOK_URL}`);

  const sms = createMockSms();
  const payload = createTextbeePayload(sms.body);
  const rawBody = JSON.stringify(payload);
  const signature = computeHmac(rawBody);
  const timestamp = Math.floor(Date.now() / 1000).toString();

  try {
    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-textbee-signature': signature,
        'x-timestamp': timestamp,
      },
      body: rawBody,
    });

    const result = await response.json().catch(() => null);
    console.log(`Status: [${response.status}] ${response.statusText}`);
    console.log('Response:', result);

    if (response.ok) {
      console.log('PASS: Webhook accepted valid HMAC and queued settlement.');
    } else {
      console.log('FAIL: Webhook unexpectedly rejected legitimate payload.');
    }
  } catch (error) {
    console.error('Network Error:', error);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 1: The Forgery Attack (HMAC Verification)
// ─────────────────────────────────────────────────────────────────────────────
async function runScenario1ForgeryAttack() {
  console.log('\n================================================================');
  console.log('--- SCENARIO 1: The Forgery Attack (HMAC Verification) ---');
  console.log('Goal: Prove that nobody can spoof a webhook without TEXTBEE_WEBHOOK_SECRET.');

  const sms = createMockSms();
  const payload = createTextbeePayload(sms.body);
  const rawBody = JSON.stringify(payload);

  // Attacker doesn't know the secret and sends a fake 64-char hex signature
  const fakeSignature = '1234567890abcdef'.repeat(4);
  const timestamp = Math.floor(Date.now() / 1000).toString();

  try {
    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-textbee-signature': fakeSignature,
        'x-timestamp': timestamp,
      },
      body: rawBody,
    });

    const result = await response.json().catch(() => null);
    console.log(`Status: [${response.status}] ${response.statusText}`);
    console.log('Response:', result);

    if (response.status === 401) {
      console.log('PASS: Server rejected forged HMAC signature with HTTP 401 Unauthorized.');
    } else {
      console.log(`FAIL: Expected HTTP 401, got ${response.status}.`);
    }
  } catch (error) {
    console.error('Network Error:', error);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 2: The Replay Attack (Timestamp Drift & Nonce Deduplication)
// ─────────────────────────────────────────────────────────────────────────────
async function runScenario2ReplayAttack() {
  console.log('\n================================================================');
  console.log('--- SCENARIO 2: The Replay Attack (Timestamp Drift & Nonce Cache) ---');
  console.log('Goal: Prove intercepted valid requests cannot be replayed.');

  // Part 2A: Stale Timestamp Drift (> 300 seconds)
  console.log('\n[2A] Testing Timestamp Drift (10 minutes in the past):');
  const smsA = createMockSms();
  const payloadA = createTextbeePayload(smsA.body);
  const rawBodyA = JSON.stringify(payloadA);
  const signatureA = computeHmac(rawBodyA);
  const staleTimestamp = (Math.floor(Date.now() / 1000) - 600).toString(); // 10 minutes ago

  try {
    const resA = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-textbee-signature': signatureA,
        'x-timestamp': staleTimestamp,
      },
      body: rawBodyA,
    });

    const resultA = await resA.json().catch(() => null);
    console.log(`Status: [${resA.status}] ${resA.statusText}`);
    console.log('Response:', resultA);

    if (resA.status === 401) {
      console.log('PASS: Server rejected stale timestamp (>300s drift) with HTTP 401.');
    } else {
      console.log(`FAIL: Expected HTTP 401 for drifted timestamp, got ${resA.status}.`);
    }
  } catch (error) {
    console.error('Network Error in 2A:', error);
  }

  // Part 2B: Nonce Deduplication Cache Replay
  console.log('\n[2B] Testing Duplicate Nonce Replay (Firing identical voucher twice):');
  const fixedNonce = crypto.randomBytes(32).toString('base64').replace(/=+$/, '');
  const smsB = createMockSms(fixedNonce);
  const payloadB = createTextbeePayload(smsB.body);
  const rawBodyB = JSON.stringify(payloadB);
  const signatureB = computeHmac(rawBodyB);
  const timestampB = Math.floor(Date.now() / 1000).toString();

  try {
    console.log('Sending first attempt (initial voucher submission)...');
    const resFirst = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-textbee-signature': signatureB,
        'x-timestamp': timestampB,
      },
      body: rawBodyB,
    });
    const resultFirst = await resFirst.json().catch(() => null);
    console.log(`Attempt 1 Status: [${resFirst.status}]`, resultFirst);

    console.log('Replaying identical attempt immediately...');
    const resSecond = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-textbee-signature': signatureB,
        'x-timestamp': timestampB,
      },
      body: rawBodyB,
    });
    const resultSecond = (await resSecond.json().catch(() => null)) as { status?: string } | null;
    console.log(`Attempt 2 Status: [${resSecond.status}]`, resultSecond);

    if (resultSecond?.status === 'Duplicate Replay') {
      console.log('PASS: Redis nonce deduplication intercepted replay: HTTP 200 Duplicate Replay.');
    } else {
      console.log('NOTE: Replay outcome:', resultSecond?.status || resSecond.status);
    }
  } catch (error) {
    console.error('Network Error in 2B:', error);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 3: The Memory Exhaustion DoS Attack (2 KB Limit)
// ─────────────────────────────────────────────────────────────────────────────
async function runScenario3MemoryExhaustionAttack() {
  console.log('\n================================================================');
  console.log('--- SCENARIO 3: The Memory Exhaustion DoS Attack (2 KB Limit) ---');
  console.log('Goal: Prove that oversized payloads are dropped before JSON parsing.');

  // Construct a bloated payload exceeding the 2048-byte streaming limit
  const oversizedSms = 'A'.repeat(5000);
  const payload = createTextbeePayload(oversizedSms);
  const rawBody = JSON.stringify(payload);
  const signature = computeHmac(rawBody);
  const timestamp = Math.floor(Date.now() / 1000).toString();

  console.log(`Payload size: ${Buffer.byteLength(rawBody, 'utf8')} bytes (Streaming limit: 2048 bytes)`);

  try {
    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-textbee-signature': signature,
        'x-timestamp': timestamp,
      },
      body: rawBody,
    });

    const result = await response.json().catch(() => null);
    console.log(`Status: [${response.status}] ${response.statusText}`);
    console.log('Response:', result);

    if (response.status === 413) {
      console.log('PASS: Stream reader terminated early with HTTP 413 Payload Too Large.');
    } else if (response.status === 400) {
      console.log('PASS: Server rejected oversized SMS body with HTTP 400.');
    } else {
      console.log(`FAIL: Expected HTTP 413 or 400, got ${response.status}.`);
    }
  } catch (error) {
    console.error('Network Error:', error);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 4: The Queue Bypass Attack (Direct Worker Invocation)
// ─────────────────────────────────────────────────────────────────────────────
async function runScenario4QueueBypassAttack() {
  console.log('\n================================================================');
  console.log('--- SCENARIO 4: The Queue Bypass Attack (Direct Worker Invocation) ---');
  console.log('Goal: Prove attacker cannot invoke /api/engine/settle without QStash.');
  console.log(`Direct Target: ${SETTLE_URL}`);

  const sms = createMockSms();
  const directPayload = {
    smsPayload: sms.body,
    senderPhone: mockSender,
    traceId: 'unauthorized-bypass-attempt',
  };

  try {
    const response = await fetch(SETTLE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Deliberately omit QStash signature: 'upstash-signature'
      },
      body: JSON.stringify(directPayload),
    });

    const result = await response.json().catch(() => null);
    console.log(`Status: [${response.status}] ${response.statusText}`);
    console.log('Response:', result);

    if (response.status === 401 || response.status === 403) {
      console.log('PASS: Settlement worker blocked direct call: HTTP 401/403 (Missing QStash signature).');
    } else {
      console.log(`FAIL: Expected HTTP 401/403, got ${response.status}.`);
    }
  } catch (error) {
    console.error('Network Error:', error);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Runner
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const arg = process.argv[2]?.toLowerCase();

  console.log('Pijin Webhook & Security Testing Script');
  console.log(`Webhook URL: ${WEBHOOK_URL}`);
  console.log(`Settle URL:  ${SETTLE_URL}`);

  if (arg === '1' || arg === 'forgery') {
    await runScenario1ForgeryAttack();
  } else if (arg === '2' || arg === 'replay') {
    await runScenario2ReplayAttack();
  } else if (arg === '3' || arg === 'dos') {
    await runScenario3MemoryExhaustionAttack();
  } else if (arg === '4' || arg === 'bypass') {
    await runScenario4QueueBypassAttack();
  } else if (arg === 'baseline') {
    await runBaselineSimulation();
  } else {
    // Run all scenarios by default
    await runBaselineSimulation();
    await runScenario1ForgeryAttack();
    await runScenario2ReplayAttack();
    await runScenario3MemoryExhaustionAttack();
    await runScenario4QueueBypassAttack();
  }

  console.log('\n================================================================');
  console.log('Simulation complete.');
}

main();