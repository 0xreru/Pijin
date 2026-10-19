/**
 * @file lib/sms-delivery.test.ts
 *
 * Test suite for the unified TextBee sender and related SMS helpers:
 *  - Retry classification (network / 5xx / 429 retried, other 4xx not)
 *  - Fallback device, SIM selection, deadline budget
 *  - Tester OTP gate (OTP_TEST_MODE)
 *  - TextBee device health classification
 */

import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';
import { deliverSms, getSmsGateways, isRetryableStatus, normalizeSmsRecipient } from './sms';
import { getTestOtpCode } from './otp';
import { classifyDevice } from './sms-health';

type Call = { url: string; body: Record<string, unknown> };

const realFetch = globalThis.fetch;
const savedEnv = { ...process.env };
let calls: Call[] = [];

function mockFetch(responses: Array<number | 'network'>) {
    let i = 0;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
        calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) });
        const next = responses[Math.min(i++, responses.length - 1)];
        if (next === 'network') throw new TypeError('fetch failed');
        return new Response(next < 300 ? '{"ok":true}' : 'err', { status: next });
    }) as typeof fetch;
}

beforeEach(() => {
    calls = [];
    for (const key of Object.keys(process.env)) {
        if (key.startsWith('TEXTBEE_') || key.startsWith('OTP_TEST')) delete process.env[key];
    }
    process.env.TEXTBEE_GATEWAY_URL = 'https://primary.test/send-sms';
    process.env.TEXTBEE_API_KEY = 'key';
});

afterEach(() => {
    globalThis.fetch = realFetch;
    process.env = { ...savedEnv };
});

// ─────────────────────────────────────────────────────────────────────────────
// Retry classification
// ─────────────────────────────────────────────────────────────────────────────

test('isRetryableStatus: 408/429/5xx only', () => {
    for (const s of [408, 429, 500, 502, 503]) assert.equal(isRetryableStatus(s), true, String(s));
    for (const s of [400, 401, 403, 404, 422]) assert.equal(isRetryableStatus(s), false, String(s));
});

test('deliverSms: retries a 5xx then succeeds', async () => {
    mockFetch([503, 200]);
    const result = await deliverSms('09171234567', 'hi', { retries: 2 });
    assert.equal(result.success, true);
    assert.equal(result.attempts, 2);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].body.recipients, ['+639171234567']);
});

test('deliverSms: does not retry a 4xx', async () => {
    mockFetch([400, 200]);
    const result = await deliverSms('+639171234567', 'hi', { retries: 2 });
    assert.equal(result.success, false);
    assert.equal(calls.length, 1);
    if (!result.success) assert.equal(result.retryable, false);
});

test('deliverSms: retries network errors and reports retryable failure', async () => {
    mockFetch(['network']);
    const result = await deliverSms('+639171234567', 'hi', { retries: 1 });
    assert.equal(result.success, false);
    assert.equal(calls.length, 2);
    if (!result.success) assert.equal(result.retryable, true);
});

test('deliverSms: falls back to the second device', async () => {
    process.env.TEXTBEE_FALLBACK_GATEWAY_URL = 'https://fallback.test/send-sms';
    process.env.TEXTBEE_FALLBACK_SIM_SUBSCRIPTION_ID = '2';
    mockFetch([500, 200]);
    const result = await deliverSms('+639171234567', 'hi', { retries: 0 });
    assert.equal(result.success, true);
    if (result.success) assert.equal(result.gateway, 'fallback');
    assert.equal(calls[1].url, 'https://fallback.test/send-sms');
    assert.equal(calls[1].body.simSubscriptionId, 2);
});

test('deliverSms: rejects invalid recipients without calling the gateway', async () => {
    mockFetch([200]);
    const result = await deliverSms('123', 'hi');
    assert.equal(result.success, false);
    assert.equal(calls.length, 0);
});

test('deliverSms: missing config is a permanent failure', async () => {
    delete process.env.TEXTBEE_GATEWAY_URL;
    mockFetch([200]);
    const result = await deliverSms('+639171234567', 'hi');
    assert.equal(result.success, false);
    if (!result.success) assert.equal(result.retryable, false);
});

test('deliverSms: respects the overall deadline', async () => {
    mockFetch(['network']);
    const started = Date.now();
    await deliverSms('+639171234567', 'hi', { retries: 10, deadlineMs: 1500 });
    assert.ok(Date.now() - started < 2500, 'should stop near the deadline');
});

test('getSmsGateways: derives URL from device id and skips duplicate fallback', () => {
    delete process.env.TEXTBEE_GATEWAY_URL;
    process.env.TEXTBEE_DEVICE_ID = 'abc';
    process.env.TEXTBEE_FALLBACK_DEVICE_ID = 'abc';
    const gateways = getSmsGateways();
    assert.equal(gateways.length, 1);
    assert.equal(gateways[0].url, 'https://api.textbee.dev/api/v1/gateway/devices/abc/send-sms');
});

test('normalizeSmsRecipient: PH formats', () => {
    assert.equal(normalizeSmsRecipient('0917 123 4567'), '+639171234567');
    assert.equal(normalizeSmsRecipient('639171234567'), '+639171234567');
    assert.equal(normalizeSmsRecipient('abc'), null);
});

// ─────────────────────────────────────────────────────────────────────────────
// Tester OTP gate
// ─────────────────────────────────────────────────────────────────────────────

test('getTestOtpCode: only when enabled, valid code and allow-listed', () => {
    const env = { OTP_TEST_MODE: 'true', OTP_TEST_CODE: '123456', OTP_TEST_NUMBERS: '09171234567, +639990000000' };
    assert.equal(getTestOtpCode('+639171234567', env), '123456');
    assert.equal(getTestOtpCode('639990000000', env), '123456');
    assert.equal(getTestOtpCode('+639181111111', env), null);
    assert.equal(getTestOtpCode('+639171234567', { ...env, OTP_TEST_MODE: 'false' }), null);
    assert.equal(getTestOtpCode('+639171234567', { ...env, OTP_TEST_CODE: '12' }), null);
    assert.equal(getTestOtpCode('+639171234567', {}), null);
});

// ─────────────────────────────────────────────────────────────────────────────
// Device health
// ─────────────────────────────────────────────────────────────────────────────

test('classifyDevice: online, offline, disabled, unknown', () => {
    const now = Date.parse('2026-10-13T12:00:00Z');
    assert.equal(classifyDevice({ enabled: true, lastHeartbeat: '2026-10-13T11:58:00Z' }, now).status, 'online');
    assert.equal(classifyDevice({ enabled: true, lastHeartbeat: '2026-10-13T10:00:00Z' }, now).status, 'offline');
    assert.equal(classifyDevice({ enabled: false }, now).status, 'disabled');
    assert.equal(classifyDevice({ enabled: true }, now).status, 'unknown');
    assert.equal(classifyDevice(undefined, now).status, 'unknown');
});
