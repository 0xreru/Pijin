/**
 * @file lib/sms-security.ts
 *
 * Shared ingress-hardening utilities for the SMS webhook pipeline.
 *
 * Design principles:
 *  - Single-stream ingestion: `readBoundedRequestBody` reads the body once and
 *    returns the raw string. All downstream validators (HMAC, JSON parse, nonce
 *    dedup) receive that same string — never re-read `req.body`.
 *  - Fail-closed on HMAC and timestamp drift; fail-open on Redis nonce check.
 *  - No plaintext PII in logs: phone numbers are masked, Stellar seeds and
 *    signing keys are redacted automatically.
 */

import crypto from 'node:crypto';

// ─────────────────────────────────────────────────────────────────────────────
// Body ingestion
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reads the request body as UTF-8 text, aborting the stream the instant the
 * accumulated byte count exceeds `maxBytes`.
 *
 * Pre-checks `Content-Length` so oversized bodies are rejected before the first
 * chunk is buffered.  Returns `{ rawBody, exceeded }` — the caller is
 * responsible for returning a 413 response when `exceeded` is true.
 *
 * The returned `rawBody` string is the single canonical body for this request.
 * Pass it (never re-read) to HMAC validators, JSON.parse, and QStash receivers.
 */
export async function readBoundedRequestBody(
    req: Request,
    maxBytes = 2048,
): Promise<{ rawBody: string; exceeded: boolean }> {
    // Fast path: honour the advisory Content-Length header if present.
    const contentLengthHeader = req.headers.get('content-length');
    if (contentLengthHeader !== null) {
        const contentLength = Number.parseInt(contentLengthHeader, 10);
        if (!Number.isNaN(contentLength) && contentLength > maxBytes) {
            // Consume and discard the body so the underlying connection is not
            // left in a half-read state by the platform.
            req.body?.cancel?.().catch(() => { /* ignore */ });
            return { rawBody: '', exceeded: true };
        }
    }

    // Streaming path: accumulate chunks, bail early if limit is hit.
    if (!req.body) {
        return { rawBody: '', exceeded: false };
    }

    const reader = req.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            totalBytes += value.byteLength;
            if (totalBytes > maxBytes) {
                reader.cancel().catch(() => { /* ignore */ });
                return { rawBody: '', exceeded: true };
            }
            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }

    const rawBody = Buffer.concat(chunks).toString('utf8');
    return { rawBody, exceeded: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// HMAC verification
// ─────────────────────────────────────────────────────────────────────────────

const HEX_64_PATTERN = /^[0-9a-fA-F]{64}$/;

/**
 * Verifies a Textbee HMAC-SHA256 signature against the raw request body.
 *
 * Accepts an optional `sha256=` prefix (some gateway versions include it).
 * Rejects any signature that is not a well-formed 64-hex-character string so
 * that `Buffer.from(..., 'hex')` cannot silently produce a mismatched buffer.
 * Comparison is always done with `crypto.timingSafeEqual` to prevent timing
 * side-channel attacks.
 *
 * Returns `false` (not throws) on any validation failure so callers can return
 * a structured HTTP 401 response.
 */
export function verifyTextbeeHmac(
    rawBody: string,
    signatureHeader: string | null,
    secret: string,
): boolean {
    if (!signatureHeader || !secret) return false;

    try {
        // Strip the optional "sha256=" prefix.
        const cleanSig = signatureHeader.replace(/^sha256=/i, '');

        // Reject malformed signatures before any buffer operations.
        if (!HEX_64_PATTERN.test(cleanSig)) return false;

        const expectedHex = crypto
            .createHmac('sha256', secret)
            .update(rawBody, 'utf8')
            .digest('hex');

        const incomingBuf = Buffer.from(cleanSig, 'hex');
        const expectedBuf = Buffer.from(expectedHex, 'hex');

        // Buffers must be the same length for timingSafeEqual.
        if (incomingBuf.length !== expectedBuf.length) return false;

        return crypto.timingSafeEqual(incomingBuf, expectedBuf);
    } catch {
        return false;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Timestamp drift validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates the `x-timestamp` / `x-textbee-timestamp` header against the
 * server's wall clock within a configurable tolerance window.
 *
 * Refinement: the header is **optional**.  If `timestampHeader` is null/empty,
 * the function returns `{ valid: true }` so that Textbee gateways that do not
 * send the header are not rejected.  When the header IS present it is strictly
 * validated, closing the window for request replay via stale HMAC tokens.
 *
 * Accepts Unix timestamps in **seconds** (10 digits) or **milliseconds**
 * (13 digits).
 */
export function verifyTimestampDrift(
    timestampHeader: string | null | undefined,
    maxDriftSec = 300,
): { valid: boolean; reason?: string } {
    // Header absent → conditionally pass (see refinement #2).
    if (timestampHeader === null || timestampHeader === undefined || timestampHeader.trim() === '') {
        return { valid: true };
    }

    const raw = timestampHeader.trim();
    const parsed = Number(raw);

    if (!Number.isFinite(parsed) || parsed <= 0) {
        return { valid: false, reason: `Unparseable timestamp: "${raw}"` };
    }

    // Normalise to seconds — timestamps with 13+ digits are in milliseconds.
    const timestampSec = raw.length >= 13 ? parsed / 1000 : parsed;
    const nowSec = Date.now() / 1000;
    const driftSec = Math.abs(nowSec - timestampSec);

    if (driftSec > maxDriftSec) {
        return {
            valid: false,
            reason: `Timestamp drift ${driftSec.toFixed(1)}s exceeds ±${maxDriftSec}s tolerance`,
        };
    }

    return { valid: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// PII / secret sanitisation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Masks all but the country code + last 4 digits of an E.164-ish phone number.
 *
 * "+639171234567" → "+639****4567"
 * "09171234567"   → "091****4567"
 *
 * If the input is not a phone-like string, returns a fully redacted placeholder.
 */
export function maskPhoneNumber(phone: string): string {
    const digits = phone.replace(/[^\d+]/g, '');
    if (digits.length < 7) return '[REDACTED]';

    const prefix = digits.startsWith('+')
        ? digits.slice(0, digits.length > 11 ? 4 : 3)
        : digits.slice(0, 3);
    const suffix = digits.slice(-4);
    const maskLen = digits.length - prefix.length - 4;
    if (maskLen <= 0) return `${prefix}${suffix}`;
    return `${prefix}${'*'.repeat(maskLen)}${suffix}`;
}

// Patterns that identify secrets that must never appear in logs.
const SECRET_PATTERNS: RegExp[] = [
    /S[A-Za-z0-9]{55}/g,   // Stellar secret seed (starts with S, 56 chars total)
    /sig_[A-Za-z0-9_-]+/g, // QStash signing keys
    /Bearer [A-Za-z0-9._-]+/g, // Bearer tokens
];

/**
 * Redacts known secret patterns from a plain-text string value.
 */
function redactSecretString(value: string): string {
    let result = value;
    for (const pattern of SECRET_PATTERNS) {
        result = result.replace(pattern, '[REDACTED]');
    }
    return result;
}

/**
 * Recursively sanitises a log-data object:
 *  - Redacts known secret patterns in string values.
 *  - Leaves non-string primitives and nested objects intact (recursion applied).
 *
 * This is a best-effort guard, not an exhaustive DLP solution.  Do not rely on
 * it as the only mechanism for keeping secrets out of logs — env var discipline
 * is the primary defence.
 */
export function sanitizeLogData(
    data: Record<string, unknown>,
): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(data)) {
        if (typeof value === 'string') {
            result[key] = redactSecretString(value);
        } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            result[key] = sanitizeLogData(value as Record<string, unknown>);
        } else if (Array.isArray(value)) {
            result[key] = value.map((item) =>
                typeof item === 'string'
                    ? redactSecretString(item)
                    : item !== null && typeof item === 'object'
                        ? sanitizeLogData(item as Record<string, unknown>)
                        : item,
            );
        } else {
            result[key] = value;
        }
    }

    return result;
}
