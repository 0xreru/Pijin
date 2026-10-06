/**
 * @file lib/sms-security.test.ts
 *
 * Test suite for SMS security and ingress hardening:
 *  - Constant-time HMAC verification with hex validation
 *  - Conditional timestamp drift validation (graceful omission)
 *  - Single-stream bounded body reading with early byte aborts
 *  - PII masking and secret redaction
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import {
    readBoundedRequestBody,
    verifyTextbeeHmac,
    verifyTimestampDrift,
    maskPhoneNumber,
    sanitizeLogData,
} from './sms-security';

// ─────────────────────────────────────────────────────────────────────────────
// HMAC Verification Tests
// ─────────────────────────────────────────────────────────────────────────────

test('verifyTextbeeHmac: accepts valid HMAC signature', () => {
    const secret = 'test-webhook-secret-12345';
    const body = JSON.stringify({ message: '1:aB3x9Q:Zx7mNk:3v5K:nonce:sig', sender: '+639171234567' });
    const expectedSig = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex');

    assert.equal(verifyTextbeeHmac(body, expectedSig, secret), true);
    // Case-insensitive sha256= prefix support
    assert.equal(verifyTextbeeHmac(body, `sha256=${expectedSig}`, secret), true);
    assert.equal(verifyTextbeeHmac(body, `SHA256=${expectedSig}`, secret), true);
});

test('verifyTextbeeHmac: rejects tampered payload or incorrect secret', () => {
    const secret = 'test-webhook-secret-12345';
    const body = JSON.stringify({ message: '1:aB3x9Q:Zx7mNk:3v5K:nonce:sig' });
    const validSig = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex');

    // Tampered body
    assert.equal(verifyTextbeeHmac(`${body}tampered`, validSig, secret), false);
    // Wrong secret
    assert.equal(verifyTextbeeHmac(body, validSig, 'different-secret'), false);
    // Single-byte flipped signature
    const tamperedSig = validSig.slice(0, -1) + (validSig.endsWith('0') ? '1' : '0');
    assert.equal(verifyTextbeeHmac(body, tamperedSig, secret), false);
});

test('verifyTextbeeHmac: rejects malformed signature formats cleanly without throwing', () => {
    const secret = 'test-webhook-secret-12345';
    const body = 'sample payload';

    assert.equal(verifyTextbeeHmac(body, '', secret), false);
    assert.equal(verifyTextbeeHmac(body, null, secret), false);
    assert.equal(verifyTextbeeHmac(body, 'short', secret), false);
    assert.equal(verifyTextbeeHmac(body, '12345', secret), false);
    // 63 characters (odd/incomplete hex)
    assert.equal(verifyTextbeeHmac(body, 'a'.repeat(63), secret), false);
    // 65 characters (oversized hex)
    assert.equal(verifyTextbeeHmac(body, 'a'.repeat(65), secret), false);
    // 64 characters with invalid non-hex characters
    assert.equal(verifyTextbeeHmac(body, 'g'.repeat(64), secret), false);
    assert.equal(verifyTextbeeHmac(body, '!@#$'.repeat(16), secret), false);
});

// ─────────────────────────────────────────────────────────────────────────────
// Timestamp Drift Tests
// ─────────────────────────────────────────────────────────────────────────────

test('verifyTimestampDrift: conditionally passes when header is absent', () => {
    assert.deepEqual(verifyTimestampDrift(null), { valid: true });
    assert.deepEqual(verifyTimestampDrift(undefined), { valid: true });
    assert.deepEqual(verifyTimestampDrift(''), { valid: true });
    assert.deepEqual(verifyTimestampDrift('   '), { valid: true });
});

test('verifyTimestampDrift: accepts fresh timestamps (seconds and milliseconds)', () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const nowMs = Date.now();

    assert.deepEqual(verifyTimestampDrift(String(nowSec)), { valid: true });
    assert.deepEqual(verifyTimestampDrift(String(nowMs)), { valid: true });
    // Within 60 seconds
    assert.deepEqual(verifyTimestampDrift(String(nowSec - 60)), { valid: true });
    assert.deepEqual(verifyTimestampDrift(String(nowSec + 30)), { valid: true });
});

test('verifyTimestampDrift: rejects stale or heavily drifted timestamps', () => {
    const nowSec = Math.floor(Date.now() / 1000);

    // 301 seconds in the past (> 300s tolerance)
    const staleResult = verifyTimestampDrift(String(nowSec - 301), 300);
    assert.equal(staleResult.valid, false);
    assert.match(staleResult.reason ?? '', /Timestamp drift.*exceeds/);

    // 350 seconds in the future
    const futureResult = verifyTimestampDrift(String(nowSec + 350), 300);
    assert.equal(futureResult.valid, false);

    // Unparseable timestamp string
    const invalidResult = verifyTimestampDrift('invalid-timestamp');
    assert.equal(invalidResult.valid, false);
    assert.match(invalidResult.reason ?? '', /Unparseable timestamp/);
});

// ─────────────────────────────────────────────────────────────────────────────
// Bounded Body Reader Tests
// ─────────────────────────────────────────────────────────────────────────────

test('readBoundedRequestBody: reads body under max limit', async () => {
    const text = JSON.stringify({ hello: 'world' });
    const req = new Request('http://localhost/api/test', {
        method: 'POST',
        body: text,
        headers: { 'content-length': String(Buffer.byteLength(text)) },
    });

    const result = await readBoundedRequestBody(req, 2048);
    assert.equal(result.exceeded, false);
    assert.equal(result.rawBody, text);
});

test('readBoundedRequestBody: rejects early via Content-Length header', async () => {
    const oversizedLength = 5000;
    const req = new Request('http://localhost/api/test', {
        method: 'POST',
        body: 'small-body',
        headers: { 'content-length': String(oversizedLength) },
    });

    const result = await readBoundedRequestBody(req, 2048);
    assert.equal(result.exceeded, true);
    assert.equal(result.rawBody, '');
});

test('readBoundedRequestBody: stream reader aborts immediately when bytes exceed max limit', async () => {
    // Construct stream chunk without content-length header
    const chunkA = new Uint8Array(1500).fill(65);
    const chunkB = new Uint8Array(1500).fill(66);

    const stream = new ReadableStream({
        start(controller) {
            controller.enqueue(chunkA);
            controller.enqueue(chunkB);
            controller.close();
        },
    });

    const req = new Request('http://localhost/api/test', {
        method: 'POST',
        body: stream,
        duplex: 'half',
    } as RequestInit);

    const result = await readBoundedRequestBody(req, 2048);
    assert.equal(result.exceeded, true);
    assert.equal(result.rawBody, '');
});

// ─────────────────────────────────────────────────────────────────────────────
// PII & Secret Sanitization Tests
// ─────────────────────────────────────────────────────────────────────────────

test('maskPhoneNumber: masks middle digits of international phone numbers', () => {
    assert.equal(maskPhoneNumber('+639171234567'), '+639*****4567');
    assert.equal(maskPhoneNumber('09171234567'), '091****4567');
    assert.equal(maskPhoneNumber('+14155552671'), '+141****2671');
    assert.equal(maskPhoneNumber('123'), '[REDACTED]');
});

test('sanitizeLogData: redacts Stellar secrets and QStash keys recursively', () => {
    const dummyStellarSeed = 'SB3WXYZABCDEFGHIJKLMN67890OPQRSTUVWXYZ1234567890ABCDEFGH'; // 56 chars starting with S
    const dummyQStashKey = 'sig_super_secret_qstash_signing_key_123';

    const rawLog = {
        traceId: 'trace-123',
        status: 'PENDING',
        relayerKey: dummyStellarSeed,
        qstashKey: dummyQStashKey,
        nested: {
            authHeader: 'Bearer eyJhbGciOiJIUzI1NiJ9.test',
            operatorSeed: `Seed is ${dummyStellarSeed}`,
        },
        items: [dummyStellarSeed, 'public-item'],
    };

    const sanitized = sanitizeLogData(rawLog);

    assert.equal(sanitized.traceId, 'trace-123');
    assert.equal(sanitized.status, 'PENDING');
    assert.equal(sanitized.relayerKey, '[REDACTED]');
    assert.equal(sanitized.qstashKey, '[REDACTED]');

    const nested = sanitized.nested as Record<string, unknown>;
    assert.equal(nested.authHeader, '[REDACTED]');
    assert.equal(nested.operatorSeed, 'Seed is [REDACTED]');

    const items = sanitized.items as unknown[];
    assert.equal(items[0], '[REDACTED]');
    assert.equal(items[1], 'public-item');
});
