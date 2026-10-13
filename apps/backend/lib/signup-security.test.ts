/**
 * @file lib/signup-security.test.ts
 *
 * Test suite for sign-up hardening:
 *  - PIN hashing, legacy plaintext acceptance and format checks
 *  - OTP generation, zero-padded comparison and phone normalisation
 *  - Phone-verification token binding and expiry
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import { hashPin, isHashedPin, isValidPinFormat, verifyPin } from './pin';
import {
    generateOtp,
    isPlausiblePhone,
    normalizePhoneNumber,
    otpMatches,
    signVerificationToken,
    toDbPhone,
    verifyVerificationToken,
} from './otp';

// ─────────────────────────────────────────────────────────────────────────────
// PIN Tests
// ─────────────────────────────────────────────────────────────────────────────

test('hashPin: produces a salted scrypt hash that verifies', async () => {
    const a = await hashPin('1234');
    const b = await hashPin('1234');
    assert.ok(isHashedPin(a));
    assert.notEqual(a, b, 'salt must make hashes differ');
    assert.ok(!a.includes('1234'));
    assert.deepEqual(await verifyPin('1234', a), { ok: true, needsRehash: false });
    assert.equal((await verifyPin('4321', a)).ok, false);
});

test('verifyPin: accepts legacy plaintext and flags it for rehash', async () => {
    assert.deepEqual(await verifyPin('1234', '1234'), { ok: true, needsRehash: true });
    assert.equal((await verifyPin('1235', '1234')).ok, false);
    assert.equal((await verifyPin('12345', '1234')).ok, false);
});

test('verifyPin: rejects malformed stored hashes', async () => {
    assert.equal((await verifyPin('1234', 'scrypt$broken')).ok, false);
});

test('isValidPinFormat: 4–6 digits only', () => {
    assert.equal(isValidPinFormat('1234'), true);
    assert.equal(isValidPinFormat('123456'), true);
    assert.equal(isValidPinFormat('123'), false);
    assert.equal(isValidPinFormat('1234567'), false);
    assert.equal(isValidPinFormat('12a4'), false);
    assert.equal(isValidPinFormat(1234), false);
});

// ─────────────────────────────────────────────────────────────────────────────
// OTP Tests
// ─────────────────────────────────────────────────────────────────────────────

test('generateOtp: always 6 digits', () => {
    for (let i = 0; i < 500; i++) {
        assert.match(generateOtp(), /^\d{6}$/);
    }
});

test('otpMatches: handles Upstash numeric parsing of leading zeros', () => {
    assert.equal(otpMatches(42, '000042'), true);
    assert.equal(otpMatches('000042', ' 000042 '), true);
    assert.equal(otpMatches(42, '42'), false);
    assert.equal(otpMatches('123456', '123457'), false);
});

test('normalizePhoneNumber / toDbPhone: PH formats converge', () => {
    assert.equal(normalizePhoneNumber('09171234567'), '+639171234567');
    assert.equal(normalizePhoneNumber('639171234567'), '+639171234567');
    assert.equal(normalizePhoneNumber('+63 917 123 4567'), '+639171234567');
    assert.equal(toDbPhone('09171234567'), '639171234567');
    assert.equal(toDbPhone('+639171234567'), '639171234567');
    assert.equal(isPlausiblePhone('123'), false);
    assert.equal(isPlausiblePhone('+639171234567'), true);
});

// ─────────────────────────────────────────────────────────────────────────────
// Verification Token Tests
// ─────────────────────────────────────────────────────────────────────────────

test('verification token: bound to phone, any input format', () => {
    process.env.OTP_VERIFICATION_JWT_SECRET = 'test-otp-secret';
    const token = signVerificationToken('+639171234567');
    assert.ok(token);
    assert.equal(verifyVerificationToken(token!, '639171234567'), true);
    assert.equal(verifyVerificationToken(token!, '09171234567'), true);
    assert.equal(verifyVerificationToken(token!, '+639999999999'), false);
});

test('verification token: rejects wrong secret, wrong purpose and expiry', () => {
    process.env.OTP_VERIFICATION_JWT_SECRET = 'test-otp-secret';
    const forged = jwt.sign({ purpose: 'phone-verification' }, 'other-secret', {
        subject: '639171234567', issuer: 'pijin-otp',
    });
    assert.equal(verifyVerificationToken(forged, '639171234567'), false);

    const wrongPurpose = jwt.sign({ purpose: 'sep10' }, 'test-otp-secret', {
        subject: '639171234567', issuer: 'pijin-otp',
    });
    assert.equal(verifyVerificationToken(wrongPurpose, '639171234567'), false);

    const expired = jwt.sign(
        { purpose: 'phone-verification', exp: Math.floor(Date.now() / 1000) - 10 },
        'test-otp-secret',
        { subject: '639171234567', issuer: 'pijin-otp' },
    );
    assert.equal(verifyVerificationToken(expired, '639171234567'), false);
});

test('verification token: not issued without a secret', () => {
    delete process.env.OTP_VERIFICATION_JWT_SECRET;
    assert.equal(signVerificationToken('+639171234567'), null);
    assert.equal(verifyVerificationToken('anything', '639171234567'), false);
});
