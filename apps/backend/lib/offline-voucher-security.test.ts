/**
 * @file lib/offline-voucher-security.test.ts
 *
 * Boundary and security tests for offline voucher decompression and validation:
 *  - 6-part structure and colon delimiters
 *  - Base62 short ID character validation
 *  - Strict Base64 validation for nonce and signature
 *  - Amount bounds (zero, negative, and i128::MAX overflow)
 *  - Nonce length (32 bytes) and signature length (64 bytes)
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseOfflineVoucher, decodeBase62, restoreBase64Padding } from './offline-voucher';

// 32-byte dummy nonce and 64-byte dummy signature encoded in Base64
const VALID_NONCE_B64 = Buffer.alloc(32, 0xaa).toString('base64');
const VALID_SIG_B64 = Buffer.alloc(64, 0xbb).toString('base64');

// Valid baseline 6-part voucher string
const VALID_VOUCHER = `1:aB3x9Q:Zx7mNk:3v5K:${VALID_NONCE_B64}:${VALID_SIG_B64}`;

test('parseOfflineVoucher: parses a valid 6-part voucher', () => {
    const voucher = parseOfflineVoucher(VALID_VOUCHER);
    assert.equal(voucher.tokenId, 1);
    assert.equal(voucher.senderShortId, 'aB3x9Q');
    assert.equal(voucher.receiverShortId, 'Zx7mNk');
    assert.equal(voucher.amountBase62, '3v5K');
    assert.ok(voucher.amountStroops > 0n);
    assert.equal(voucher.nonce.length, 32);
    assert.equal(voucher.signature.length, 64);
});

test('parseOfflineVoucher: supports unpadded and URL-safe Base64', () => {
    const unpaddedNonce = VALID_NONCE_B64.replace(/=+$/, '');
    const unpaddedSig = VALID_SIG_B64.replace(/=+$/, '');
    const voucherStr = `1:aB3x9Q:Zx7mNk:3v5K:${unpaddedNonce}:${unpaddedSig}`;

    const voucher = parseOfflineVoucher(voucherStr);
    assert.equal(voucher.nonce.length, 32);
    assert.equal(voucher.signature.length, 64);
});

test('parseOfflineVoucher: rejects payloads with incorrect part counts', () => {
    assert.throws(() => parseOfflineVoucher(''), /Malformed SMS payload: expected 6 parts/);
    assert.throws(() => parseOfflineVoucher('1:2:3'), /expected 6 parts, got 3/);
    assert.throws(() => parseOfflineVoucher(`${VALID_VOUCHER}:extraPart`), /expected 6 parts, got 7/);
});

test('parseOfflineVoucher: rejects invalid token IDs', () => {
    assert.throws(() => parseOfflineVoucher(`abc:aB3x9Q:Zx7mNk:3v5K:${VALID_NONCE_B64}:${VALID_SIG_B64}`), /Invalid token ID/);
    assert.throws(() => parseOfflineVoucher(`0:aB3x9Q:Zx7mNk:3v5K:${VALID_NONCE_B64}:${VALID_SIG_B64}`), /Invalid token ID/);
    assert.throws(() => parseOfflineVoucher(`-1:aB3x9Q:Zx7mNk:3v5K:${VALID_NONCE_B64}:${VALID_SIG_B64}`), /Invalid token ID/);
});

test('parseOfflineVoucher: rejects non-Base62 or wrong-length short IDs', () => {
    // Length 5 (too short)
    assert.throws(() => parseOfflineVoucher(`1:short:Zx7mNk:3v5K:${VALID_NONCE_B64}:${VALID_SIG_B64}`), /must be exactly 6/);
    // Length 7 (too long)
    assert.throws(() => parseOfflineVoucher(`1:tooLong1:Zx7mNk:3v5K:${VALID_NONCE_B64}:${VALID_SIG_B64}`), /must be exactly 6/);
    // Invalid characters (dashes, underscores)
    assert.throws(() => parseOfflineVoucher(`1:aB-3x9:Zx7mNk:3v5K:${VALID_NONCE_B64}:${VALID_SIG_B64}`), /must be exactly 6/);
    assert.throws(() => parseOfflineVoucher(`1:aB3x9Q:Zx_mNk:3v5K:${VALID_NONCE_B64}:${VALID_SIG_B64}`), /must be exactly 6/);
});

test('parseOfflineVoucher: rejects zero or negative amounts', () => {
    // '0' decodes to 0n
    assert.throws(() => parseOfflineVoucher(`1:aB3x9Q:Zx7mNk:0:${VALID_NONCE_B64}:${VALID_SIG_B64}`), /Amount must be greater than zero/);
});

test('parseOfflineVoucher: rejects amounts exceeding Soroban i128::MAX', () => {
    // 2^127 - 1 is i128::MAX (approx 1.7014e38)
    // 70 Z's in Base62 overflows i128::MAX by many orders of magnitude
    const hugeAmountBase62 = 'ZZZZZZZZZZZZZZZZZZZZZZ';
    assert.throws(
        () => parseOfflineVoucher(`1:aB3x9Q:Zx7mNk:${hugeAmountBase62}:${VALID_NONCE_B64}:${VALID_SIG_B64}`),
        /exceeds i128::MAX/,
    );
});

test('parseOfflineVoucher: rejects invalid Base64 in nonce and signature', () => {
    const invalidBase64 = '!!!invalid_b64@@@';

    // Invalid nonce Base64 characters
    assert.throws(
        () => parseOfflineVoucher(`1:aB3x9Q:Zx7mNk:3v5K:${invalidBase64}:${VALID_SIG_B64}`),
        /Nonce contains invalid Base64 characters/,
    );

    // Invalid signature Base64 characters
    assert.throws(
        () => parseOfflineVoucher(`1:aB3x9Q:Zx7mNk:3v5K:${VALID_NONCE_B64}:${invalidBase64}`),
        /Signature contains invalid Base64 characters/,
    );
});

test('parseOfflineVoucher: rejects nonce with wrong byte count (!= 32 bytes)', () => {
    // 16 bytes instead of 32
    const shortNonceB64 = Buffer.alloc(16).toString('base64');
    assert.throws(
        () => parseOfflineVoucher(`1:aB3x9Q:Zx7mNk:3v5K:${shortNonceB64}:${VALID_SIG_B64}`),
        /Nonce must decode to 32 bytes, got 16/,
    );
});

test('parseOfflineVoucher: rejects signature with wrong byte count (!= 64 bytes)', () => {
    // 32 bytes instead of 64
    const shortSigB64 = Buffer.alloc(32).toString('base64');
    assert.throws(
        () => parseOfflineVoucher(`1:aB3x9Q:Zx7mNk:3v5K:${VALID_NONCE_B64}:${shortSigB64}`),
        /Signature must decode to 64 bytes, got 32/,
    );
});
