/**
 * @file lib/qstash-security.ts
 *
 * QStash signature verification and settlement error classification utilities.
 *
 * Design:
 *  - `verifyQStashSignature` wraps the `@upstash/qstash` `Receiver` to provide
 *    graceful error handling (never throws 500 for missing/invalid signature).
 *  - `isRetryableSettlementError` replaces the narrow string-matching heuristic
 *    in the settle route with a comprehensive classifier covering HTTP 429/502/
 *    503/504, Stellar tx_bad_seq collisions, and connection-level failures.
 */

import { Receiver } from '@upstash/qstash';

// ─────────────────────────────────────────────────────────────────────────────
// QStash Signature Verification
// ─────────────────────────────────────────────────────────────────────────────

export interface QStashVerificationResult {
    valid: boolean;
    /** Human-readable explanation when `valid` is false. */
    error?: string;
}

/**
 * Verifies the `upstash-signature` header on an inbound QStash request.
 *
 * @param rawBody   The request body as a pre-read string. Must be the exact
 *                  same bytes that QStash signed — do NOT re-read `req.body`.
 *
 * Returns `{ valid: false, error }` (never throws) so the caller can return a
 * structured HTTP 401/403 response without a 500 stack trace leaking to QStash.
 *
 * Picks up `QSTASH_CURRENT_SIGNING_KEY` and `QSTASH_NEXT_SIGNING_KEY` from the
 * environment automatically (same as `verifySignatureAppRouter`).
 */
export async function verifyQStashSignature(
    req: Request,
    rawBody: string,
): Promise<QStashVerificationResult> {
    const signature = req.headers.get('upstash-signature');

    if (!signature) {
        return { valid: false, error: '`Upstash-Signature` header is missing' };
    }

    if (typeof signature !== 'string') {
        return { valid: false, error: '`Upstash-Signature` header is not a string' };
    }

    const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
    const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY;

    // Allow local / test environments where keys are deliberately absent.
    // In production, missing keys cause verification to fail (fail-closed).
    if (!currentSigningKey && !nextSigningKey && process.env.NODE_ENV !== 'production') {
        // Dev / test mode: skip verification and return valid.
        return { valid: true };
    }

    if (!currentSigningKey && !nextSigningKey) {
        return {
            valid: false,
            error: 'QStash signing keys are not configured (set QSTASH_CURRENT_SIGNING_KEY / QSTASH_NEXT_SIGNING_KEY)',
        };
    }

    try {
        const receiver = new Receiver({
            currentSigningKey: currentSigningKey ?? '',
            nextSigningKey: nextSigningKey ?? '',
        });

        const upstashRegion = req.headers.get('upstash-region') ?? undefined;

        const isValid = await receiver.verify({
            signature,
            body: rawBody,
            upstashRegion,
        });

        return isValid
            ? { valid: true }
            : { valid: false, error: 'QStash signature verification failed' };
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { valid: false, error: `QStash verification error: ${message}` };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Settlement error classification
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Non-retryable Soroban / Pijin contract error codes.
 * Matching against these prevents QStash from retrying permanent failures.
 *
 * ContractError enum (from pijin_core/src/index.ts):
 *   1  AlreadyInitialized
 *   2  Unauthorized
 *   3  InvalidAmount
 *   4  ExpiredVoucher
 *   5  NonceReplayed
 *   6  InsufficientBalance
 *   7  RecipientNotFound
 *   8  MathOverflow
 *   9  NotWhitelistedGateway
 *  10  ShortIdAlreadyRegistered
 *  11  RegistrarNotConfigured
 *  12  InvalidShortId
 */
const CONTRACT_ERROR_PATTERN = /Error\s*\(\s*Contract\s*,\s*\d+\s*\)/i;

/**
 * HTTP response status substrings that indicate transient gateway/infra errors.
 * These map to QStash-retryable situations.
 */
const RETRYABLE_HTTP_PATTERNS = [
    'status: 429',
    'status: 502',
    'status: 503',
    'status: 504',
    'too many requests',
    'rate limit',
    'bad gateway',
    'service unavailable',
    'gateway timeout',
];

/**
 * Network/socket-level patterns that indicate transient connectivity failures.
 */
const RETRYABLE_NETWORK_PATTERNS = [
    'econnrefused',
    'etimedout',
    'econnreset',
    'socket hang up',
    'fetch failed',
    'failed to fetch',
    'network error',
    'connection refused',
    'connection reset',
    'connect timeout',
    'read timeout',
    'write timeout',
    'epipe',
];

/**
 * Stellar-specific transient patterns (sequence number collision during
 * concurrent relayer submissions, etc.).
 */
const RETRYABLE_STELLAR_PATTERNS = [
    'tx_bad_seq',
    'tx_insufficient_fee',
    'timeout',
];

/**
 * Determines whether a settlement failure should trigger a QStash retry.
 *
 * Returns `true`  → return HTTP 500 from the settle route (QStash retries).
 * Returns `false` → return HTTP 200 with `{ status: "FAILED" }` (QStash stops).
 *
 * Retryable cases:
 *   - HTTP 429, 502, 503, 504 from Stellar RPC / Horizon.
 *   - Network socket failures (ECONNREFUSED, ETIMEDOUT, etc.).
 *   - Stellar `tx_bad_seq` (sequence number drift from concurrent submissions).
 *
 * Non-retryable cases (permanent business / validation failures):
 *   - Pijin contract errors (`Error(Contract, N)`) — invalid sig, nonce replay, etc.
 *   - Account / token not found.
 *   - Invalid Ed25519 voucher signature (local firewall rejection).
 *   - Malformed payload / bad Base62 / bad Base64.
 */
export function isRetryableSettlementError(err: unknown): boolean {
    if (!(err instanceof Error)) return false;

    const msg = err.message.toLowerCase();

    // Permanent contract-level failures — never retry.
    if (CONTRACT_ERROR_PATTERN.test(err.message)) return false;

    // Check retryable HTTP status patterns.
    for (const pattern of RETRYABLE_HTTP_PATTERNS) {
        if (msg.includes(pattern.toLowerCase())) return true;
    }

    // Check retryable network patterns.
    for (const pattern of RETRYABLE_NETWORK_PATTERNS) {
        if (msg.includes(pattern.toLowerCase())) return true;
    }

    // Check retryable Stellar transaction codes.
    for (const pattern of RETRYABLE_STELLAR_PATTERNS) {
        if (msg.includes(pattern.toLowerCase())) return true;
    }

    return false;
}

/**
 * Normalises a settlement failure into a short, operator-readable reason string.
 * Expands well-known RPC error codes into actionable descriptions.
 *
 * Kept intentionally generic — never include private key material or raw phone
 * numbers in the reason string.
 */
export function normalizeSettlementFailure(err: unknown): string {
    const message = err instanceof Error ? err.message : String(err);

    if (
        message.includes('verify_sig_ed25519') ||
        message.includes('failed ED25519 verification')
    ) {
        return 'Offline device key mismatch: the voucher signature is invalid for the registered key. Re-sync with an authenticated set_offline_key call.';
    }

    const trustlineMatch = message.match(/trustline entry is missing for account["\s,]+(G[A-Z2-7]{55})/);
    if (trustlineMatch?.[1]) {
        return `Missing token trustline for account ${trustlineMatch[1]}. Create a trustline before retrying.`;
    }

    if (CONTRACT_ERROR_PATTERN.test(message)) {
        return `Contract rejection: ${message.slice(0, 200)}`;
    }

    return message.slice(0, 500);
}

/**
 * Normalises a settlement failure into a concise, user-friendly SMS message
 * suitable for delivery to end users via SMS.
 *
 * Strips all internal contract error codes, raw RPC payloads, and stack traces.
 * Returns an empty string if the error cannot be safely mapped to a specific
 * user-actionable message, allowing the caller to use a safe default fallback.
 */
export function normalizeSettlementUserFailure(err: unknown): string {
    if (!err) return '';
    const message = err instanceof Error ? err.message : String(err);

    // ContractError enum mapping:
    // 1: AlreadyInitialized, 2: Unauthorized, 3: InvalidAmount, 4: ExpiredVoucher,
    // 5: NonceReplayed, 6: InsufficientBalance, 7: RecipientNotFound, 8: MathOverflow,
    // 9: NotWhitelistedGateway, 10: ShortIdAlreadyRegistered, 11: RegistrarNotConfigured,
    // 12: InvalidShortId
    const contractErrorMatch = message.match(/Error\s*\(\s*Contract\s*,\s*(\d+)\s*\)/i);
    if (contractErrorMatch) {
        const code = Number(contractErrorMatch[1]);
        switch (code) {
            case 6:
                return 'Insufficient balance.';
            case 5:
                return 'Voucher has already been used.';
            case 4:
                return 'Voucher has expired.';
            case 3:
                return 'Invalid transaction amount.';
            case 7:
                return 'Recipient was not found.';
            case 2:
                return 'Unauthorized transaction.';
            case 12:
                return 'Invalid recipient ID.';
            case 9:
                return 'Unauthorized relayer.';
            default:
                return 'Transaction rejected by contract.';
        }
    }

    if (/insufficientbalance/i.test(message) || /insufficient balance/i.test(message)) {
        return 'Insufficient balance.';
    }

    if (/noncereplayed/i.test(message) || /nonce replayed/i.test(message)) {
        return 'Voucher has already been used.';
    }

    if (/expiredvoucher/i.test(message) || /expired voucher/i.test(message)) {
        return 'Voucher has expired.';
    }

    if (
        message.includes('verify_sig_ed25519') ||
        message.includes('failed ED25519 verification') ||
        /invalid.*signature/i.test(message)
    ) {
        return 'Invalid voucher signature.';
    }

    if (/offline device key/i.test(message)) {
        return 'Offline device key is not enrolled.';
    }

    if (/trustline/i.test(message)) {
        return 'Missing token trustline.';
    }

    if (/recipient.*not found/i.test(message)) {
        return 'Recipient was not found.';
    }

    const senderMatch = message.match(/account not found:\s*([a-zA-Z0-9]+)/i);
    if (senderMatch?.[1]) {
        return `Sender account ${senderMatch[1]} is not registered.`;
    }

    if (/sender account.*not registered/i.test(message) || /account not found/i.test(message)) {
        return 'Sender account is not registered.';
    }

    return '';
}
