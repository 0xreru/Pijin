/**
 * @file lib/engine-retry-classifier.test.ts
 *
 * Test suite for QStash retry classification and error normalization:
 *  - Ensures transient infra failures (RPC rate limits, 502/503/504, tx_bad_seq) trigger retry (true)
 *  - Ensures permanent business / contract failures (ContractError, invalid sigs) terminate (false)
 *  - Verifies normalized failure messages protect internal keys and provide actionable feedback
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
    isRetryableSettlementError,
    normalizeSettlementFailure,
    normalizeSettlementUserFailure,
} from './qstash-security';

// ─────────────────────────────────────────────────────────────────────────────
// Retryable Error Classification Tests (Expect true -> HTTP 500)
// ─────────────────────────────────────────────────────────────────────────────

test('isRetryableSettlementError: classifies HTTP 429 (Rate Limits) as retryable', () => {
    assert.equal(isRetryableSettlementError(new Error('RPC request failed with status: 429')), true);
    assert.equal(isRetryableSettlementError(new Error('Horizon error: Too Many Requests')), true);
    assert.equal(isRetryableSettlementError(new Error('Rate limit exceeded on Stellar RPC endpoint')), true);
});

test('isRetryableSettlementError: classifies HTTP 502, 503, 504 (Server Errors) as retryable', () => {
    assert.equal(isRetryableSettlementError(new Error('upstream server returned status: 502 Bad Gateway')), true);
    assert.equal(isRetryableSettlementError(new Error('RPC endpoint returned status: 503 Service Unavailable')), true);
    assert.equal(isRetryableSettlementError(new Error('Gateway Timeout (status: 504)')), true);
});

test('isRetryableSettlementError: classifies network and socket drops as retryable', () => {
    assert.equal(isRetryableSettlementError(new Error('connect ECONNREFUSED 127.0.0.1:8000')), true);
    assert.equal(isRetryableSettlementError(new Error('read ETIMEDOUT')), true);
    assert.equal(isRetryableSettlementError(new Error('socket hang up')), true);
    assert.equal(isRetryableSettlementError(new Error('fetch failed')), true);
    assert.equal(isRetryableSettlementError(new Error('connection reset by peer')), true);
});

test('isRetryableSettlementError: classifies Stellar sequence collision (tx_bad_seq) as retryable', () => {
    // tx_bad_seq occurs when concurrent transactions from the same relayer race.
    // Retrying allows loading a fresh sequence number.
    assert.equal(isRetryableSettlementError(new Error('Transaction simulation failed with tx_bad_seq')), true);
    assert.equal(isRetryableSettlementError(new Error('Horizon rejected: tx_insufficient_fee')), true);
});

// ─────────────────────────────────────────────────────────────────────────────
// Non-Retryable Error Classification Tests (Expect false -> HTTP 200 with FAILED)
// ─────────────────────────────────────────────────────────────────────────────

test('isRetryableSettlementError: classifies Soroban Contract Errors as non-retryable', () => {
    // Contract errors: Error(Contract, #) must NEVER loop in QStash
    assert.equal(isRetryableSettlementError(new Error('HostError: Error(Contract, 6)')), false); // InsufficientBalance
    assert.equal(isRetryableSettlementError(new Error('HostError: Error(Contract, 5)')), false); // NonceReplayed
    assert.equal(isRetryableSettlementError(new Error('HostError: Error(Contract, 7)')), false); // RecipientNotFound
    assert.equal(isRetryableSettlementError(new Error('HostError: Error(Contract, 2)')), false); // Unauthorized
    assert.equal(isRetryableSettlementError(new Error('HostError: Error(Contract, 12)')), false); // InvalidShortId
});

test('isRetryableSettlementError: classifies invalid signatures as non-retryable', () => {
    assert.equal(isRetryableSettlementError(new Error('Local Firewall Rejected: Invalid Ed25519 signature.')), false);
    assert.equal(isRetryableSettlementError(new Error('failed ED25519 verification on host')), false);
});

test('isRetryableSettlementError: classifies account and token validation errors as non-retryable', () => {
    assert.equal(isRetryableSettlementError(new Error('Account not found: aB3x9Q')), false);
    assert.equal(isRetryableSettlementError(new Error('Token not found: id=99')), false);
    assert.equal(isRetryableSettlementError(new Error('Token is inactive: id=1')), false);
    assert.equal(isRetryableSettlementError(new Error('Malformed SMS payload: expected 6 parts')), false);
});

test('isRetryableSettlementError: handles non-Error objects safely', () => {
    assert.equal(isRetryableSettlementError('random string error'), false);
    assert.equal(isRetryableSettlementError(null), false);
    assert.equal(isRetryableSettlementError(undefined), false);
    assert.equal(isRetryableSettlementError({ error: 'object' }), false);
});

// ─────────────────────────────────────────────────────────────────────────────
// Error Normalization Tests
// ─────────────────────────────────────────────────────────────────────────────

test('normalizeSettlementFailure: formats offline device key mismatch clearly', () => {
    const err = new Error('failed ED25519 verification: verify_sig_ed25519 failed');
    const reason = normalizeSettlementFailure(err);
    assert.match(reason, /Offline device key mismatch/);
    assert.match(reason, /set_offline_key/);
});

test('normalizeSettlementFailure: formats missing trustline errors clearly', () => {
    const err = new Error('trustline entry is missing for account GBZXN7PIRZGNMHGA7MUUUF4FCGLUK25P2WSMW7G7SV2ACD35W5LO6U3A');
    const reason = normalizeSettlementFailure(err);
    assert.match(reason, /Missing token trustline for account GBZXN7PIRZGNMHGA7MUUUF4FCGLUK25P2WSMW7G7SV2ACD35W5LO6U3A/);
});

test('normalizeSettlementFailure: formats contract error messages', () => {
    const err = new Error('HostError: Error(Contract, 6) triggered during spend_offline');
    const reason = normalizeSettlementFailure(err);
    assert.match(reason, /Contract rejection: HostError: Error\(Contract, 6\)/);
});

// ─────────────────────────────────────────────────────────────────────────────
// User SMS Failure Normalization Tests
// ─────────────────────────────────────────────────────────────────────────────

test('normalizeSettlementUserFailure: produces user-friendly messages for contract errors', () => {
    assert.equal(
        normalizeSettlementUserFailure(new Error('HostError: Error(Contract, 6) triggered during spend_offline')),
        'Insufficient balance.',
    );
    assert.equal(
        normalizeSettlementUserFailure(new Error('HostError: Error(Contract, 5)')),
        'Voucher has already been used.',
    );
    assert.equal(
        normalizeSettlementUserFailure(new Error('HostError: Error(Contract, 4)')),
        'Voucher has expired.',
    );
    assert.equal(
        normalizeSettlementUserFailure(new Error('HostError: Error(Contract, 7)')),
        'Recipient was not found.',
    );
    assert.equal(
        normalizeSettlementUserFailure(new Error('HostError: Error(Contract, 2)')),
        'Unauthorized transaction.',
    );
    assert.equal(
        normalizeSettlementUserFailure(new Error('HostError: Error(Contract, 12)')),
        'Invalid recipient ID.',
    );
});

test('normalizeSettlementUserFailure: produces friendly messages for offline key and signature errors', () => {
    assert.equal(
        normalizeSettlementUserFailure(new Error('failed ED25519 verification: verify_sig_ed25519 failed')),
        'Invalid voucher signature.',
    );
    assert.equal(
        normalizeSettlementUserFailure(new Error('Offline device key is not enrolled. Sign in online to synchronize this device.')),
        'Offline device key is not enrolled.',
    );
});

test('normalizeSettlementUserFailure: produces friendly messages for missing trustline errors', () => {
    assert.equal(
        normalizeSettlementUserFailure(new Error('trustline entry is missing for account GBZXN7PIRZGNMHGA7MUUUF4FCGLUK25P2WSMW7G7SV2ACD35W5LO6U3A')),
        'Missing token trustline.',
    );
});

test('normalizeSettlementUserFailure: produces friendly messages for missing sender or recipient account errors', () => {
    assert.equal(
        normalizeSettlementUserFailure(new Error('Account not found: aB3x9Q')),
        'Sender account aB3x9Q is not registered.',
    );
    assert.equal(
        normalizeSettlementUserFailure(new Error('Recipient not found: Zx7mNk')),
        'Recipient was not found.',
    );
});

test('normalizeSettlementUserFailure: returns empty string for unclassified or raw errors without leaking codes', () => {
    assert.equal(normalizeSettlementUserFailure(new Error('Random internal stack trace')), '');
    assert.equal(normalizeSettlementUserFailure(null), '');
    assert.equal(normalizeSettlementUserFailure(undefined), '');
});
