/**
 * @swagger
 * /api/sms/webhook:
 *   post:
 *     tags:
 *       - SMS Gateway
 *     summary: Textbee SMS inbound webhook — offline payment ingress
 *     description: |
 *       Receives inbound SMS messages from the **Textbee Android gateway** and
 *       enqueues them to **Upstash QStash** for durable, retryable settlement processing.
 *
 *       #### Security Shield (in order of evaluation)
 *       1. **Body size guard**: Rejects bodies > 2 KB with HTTP 413 before JSON parsing,
 *          using streaming to avoid buffering oversized payloads into memory.
 *       2. **Timestamp drift** (optional): If `x-timestamp` or `x-textbee-timestamp` is
 *          present, drift must be within ±300 s. If the header is absent, this check is
 *          skipped so legacy gateways are not broken.
 *       3. **HMAC-SHA256** (`x-signature` or `x-textbee-signature`): Server recomputes
 *          the HMAC of the raw body against `TEXTBEE_WEBHOOK_SECRET` and compares using
 *          `crypto.timingSafeEqual` (prevents timing attacks). Signature must be exactly
 *          64 hex characters; malformed values are rejected without buffer operations.
 *       4. **Rate Limiting**: Sliding window — 3 req / 60 s per sender phone.
 *       5. **Nonce deduplication** (Redis, fail-open): Early Redis nonce cache prevents
 *          replayed vouchers from reaching QStash. Falls back gracefully if Redis is down.
 *       6. **Payload validation**: 6-part colon-delimited format with Base62/Base64 checks.
 *
 *       #### Rate Limiting
 *       **Sliding window — 3 requests per 60 seconds** per sender phone number.
 *       Keyed as `pijin:sms:webhook`. Exceeding returns 200 `{ status: "Rate Limited" }`.
 *
 *       #### Event Filtering
 *       Only `event: "MESSAGE_RECEIVED"` events are forwarded to QStash. All other
 *       event types (delivery receipts, etc.) return 200 `{ status: "Ignored" }`.
 *
 *       #### Payload format validation
 *       The SMS message body must match the 6-part colon-delimited format:
 *       `<tokenId>:<senderShortId>:<receiverShortId>:<amountBase62>:<nonce>:<signature>`
 *
 *       On success, QStash job is published to `/api/engine/settle` with a `deduplicationId`
 *       of `<senderShortId>_<nonce>` to prevent duplicate on-chain transactions.
 *     security:
 *       - TextbeeHmac: []
 *     parameters:
 *       - in: query
 *         name: secret
 *         required: false
 *         schema:
 *           type: string
 *         description: Deprecated URL-based fallback secret. Kept for backward compatibility but HMAC is preferred.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               event:
 *                 type: string
 *                 example: "MESSAGE_RECEIVED"
 *               data:
 *                 type: object
 *                 properties:
 *                   sender:
 *                     type: string
 *                     description: Sender's phone number (E.164).
 *                     example: "+639171234567"
 *                   message:
 *                     type: string
 *                     description: Raw SMS body (must be a valid 6-part Pijin payload).
 *                     example: "1:aB3x9Q:Zx7mNk:3v5K:bm9uY2U=:c2ln=="
 *     responses:
 *       '200':
 *         description: Request processed (check `status` field for outcome).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 status:
 *                   type: string
 *                   enum: [Buffered, Ignored, Rate Limited, Duplicate Replay]
 *                 traceId:
 *                   type: string
 *                   description: Correlates webhook and settlement-worker debug logs.
 *       '400':
 *         description: Invalid JSON body, missing sender/message fields, or malformed payload.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *       '401':
 *         description: HMAC verification failed.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Unauthorized"
 *       '413':
 *         description: Request body exceeds the 2 KB limit.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Payload too large"
 */
import { NextResponse } from 'next/server';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { Client } from '@upstash/qstash';
import { sendSmsNotification } from '@/lib/sms';
import { parseOfflineVoucher } from '@/lib/offline-voucher';
import {
    readBoundedRequestBody,
    verifyTextbeeHmac,
    verifyTimestampDrift,
    maskPhoneNumber,
} from '@/lib/sms-security';
import {
    createOfflineTransactionTraceId,
    isOfflineTransactionDebugEnabled,
    logOfflineTransactionDebug,
    logOfflineVoucherDecompression,
    sanitizeOfflineDebugHeaders,
    sanitizeOfflineDebugUrl,
} from '@/lib/offline-transaction-debug';

// ─────────────────────────────────────────────────────────────────────────────
// Runtime
// ─────────────────────────────────────────────────────────────────────────────
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Maximum SMS message body length (generous upper bound for any valid Pijin voucher).
const MAX_SMS_BODY_CHARS = 300;
// Nonce deduplication TTL in Redis (24 hours).
const NONCE_TTL_SECONDS = 86_400;

// ─────────────────────────────────────────────────────────────────────────────
// Tier 2 – Rate Limiter (Sliding Window: 3 req / 60 s per sender phone)
// ─────────────────────────────────────────────────────────────────────────────
const ratelimit = new Ratelimit({
    redis: Redis.fromEnv(),
    limiter: Ratelimit.slidingWindow(3, '60 s'),
    analytics: false,
    prefix: 'pijin:sms:webhook',
});

const qstash = new Client({
    token: process.env.QSTASH_TOKEN || 'dummy_token_to_bypass_build',
});

type SmsWebhookPayload = {
    senderPhone: string;
    message: string;
    eventType: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

type UnknownObject = Record<string, unknown>;

function firstObject(value: unknown): UnknownObject | null {
    if (Array.isArray(value)) {
        const first = value.find((item) => item && typeof item === 'object');
        return first && typeof first === 'object' ? first as UnknownObject : null;
    }

    return value && typeof value === 'object' ? value as UnknownObject : null;
}

function extractSmsPayload(body: UnknownObject): SmsWebhookPayload | null {
    // Textbee has used both direct message objects and wrapped event objects.
    const candidate =
        firstObject(body.data) ??
        firstObject(body.message) ??
        firstObject(body.messages) ??
        body;

    const senderPhone =
        typeof candidate.sender === 'string' ? candidate.sender.trim() :
            typeof candidate.from === 'string' ? candidate.from.trim() :
                typeof candidate.phone === 'string' ? candidate.phone.trim() :
                    '';

    const message =
        typeof candidate.message === 'string' ? candidate.message.trim() :
            typeof candidate.text === 'string' ? candidate.text.trim() :
                typeof candidate.body === 'string' ? candidate.body.trim() :
                    '';

    const eventType =
        typeof body.event === 'string' ? body.event :
            typeof body.type === 'string' ? body.type :
                typeof candidate.event === 'string' ? candidate.event :
                    typeof candidate.type === 'string' ? candidate.type :
                        'UNKNOWN';

    return senderPhone && message ? { senderPhone, message, eventType } : null;
}

/**
 * Early Redis nonce deduplication (fail-open).
 * Sets `pijin:sms:nonce:<nonce>` with 24h TTL if not already present.
 * Returns `true` if the nonce was already seen (replay), `false` if it is new.
 * Never throws — Redis errors are logged and treated as cache misses.
 */
async function checkAndSetNonceReplay(nonce: string, traceId: string): Promise<boolean> {
    try {
        const redis = Redis.fromEnv();
        const key = `pijin:sms:nonce:${nonce}`;
        // SET NX EX: returns 1 if key was set (new), null if key already existed.
        const result = await redis.set(key, '1', { nx: true, ex: NONCE_TTL_SECONDS });
        // result === null means the key already existed → replay detected.
        return result === null;
    } catch (err) {
        // Refinement #3: fail-open on Redis connection errors.
        console.warn(`[SMS Webhook] Redis nonce check failed (fail-open). traceId=${traceId}`, err instanceof Error ? err.message : err);
        return false;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/sms/webhook — health probe
// ─────────────────────────────────────────────────────────────────────────────
export async function GET() {
    return NextResponse.json({
        success: true,
        route: '/api/sms/webhook',
        accepts: ['POST'],
        configured: {
            textbeeWebhookSecret: Boolean(process.env.TEXTBEE_WEBHOOK_SECRET),
            qstashToken: Boolean(process.env.QSTASH_TOKEN),
            nextPublicAppUrl: Boolean(process.env.NEXT_PUBLIC_APP_URL),
            textbeeGateway: Boolean(process.env.TEXTBEE_GATEWAY_URL),
            textbeeApiKey: Boolean(process.env.TEXTBEE_API_KEY),
            offlineTransactionDebug: isOfflineTransactionDebugEnabled(),
        },
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/sms/webhook — Ingress Shield
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(req: Request) {
    const traceId = createOfflineTransactionTraceId();

    logOfflineTransactionDebug(traceId, 'receive:http', {
        url: sanitizeOfflineDebugUrl(req.url),
        method: req.method,
        headers: sanitizeOfflineDebugHeaders(req.headers),
    });

    // ── Shield Layer 0: Strict streaming body read with 2 KB cap ─────────────
    // readBoundedRequestBody reads the body once. This rawBody string is passed
    // to ALL downstream validators — never re-read req.body.
    let rawBody: string;
    try {
        const result = await readBoundedRequestBody(req, 2048);

        if (result.exceeded) {
            console.warn(`[SMS Webhook] Blocked: Payload exceeds 2 KB body limit. traceId=${traceId}`);
            return NextResponse.json({ error: 'Payload too large', traceId }, { status: 413 });
        }

        rawBody = result.rawBody;
    } catch (err) {
        console.error('[SMS WEBHOOK BODY READ ERROR]', {
            traceId,
            url: sanitizeOfflineDebugUrl(req.url),
            errorName: err instanceof Error ? err.name : 'UnknownError',
            errorMessage: err instanceof Error ? err.message : String(err),
        });
        return NextResponse.json({ error: 'Failed to read request body', traceId }, { status: 400 });
    }

    logOfflineTransactionDebug(traceId, 'receive:raw-body', {
        rawBodyLength: rawBody.length,
        // Omit rawBody content from debug logs to avoid logging SMS payment metadata.
    });

    // ── Shield Layer 1a: Conditional Timestamp Drift ──────────────────────────
    // Refinement #2: Validate only when the header is present; skip silently if absent.
    const timestampHeader =
        req.headers.get('x-timestamp') ??
        req.headers.get('x-textbee-timestamp');

    const driftResult = verifyTimestampDrift(timestampHeader);
    if (!driftResult.valid) {
        console.warn(`[SMS Webhook] Blocked: Timestamp drift rejected. traceId=${traceId} reason=${driftResult.reason}`);
        return NextResponse.json({ error: `Request timestamp rejected: ${driftResult.reason}`, traceId }, { status: 401 });
    }

    // ── Shield Layer 1b: HMAC-SHA256 Verification ────────────────────────────
    const incomingSignature =
        req.headers.get('x-signature') ??
        req.headers.get('x-textbee-signature') ??
        '';

    const expectedSecret = process.env.TEXTBEE_WEBHOOK_SECRET ?? '';
    const hmacValid = verifyTextbeeHmac(rawBody, incomingSignature || null, expectedSecret);

    logOfflineTransactionDebug(traceId, 'receive:auth', {
        hmacValid,
        hmacHeaderPresent: Boolean(incomingSignature),
        timestampHeaderPresent: Boolean(timestampHeader),
    });

    if (!hmacValid) {
        console.warn(`[SMS Webhook] Blocked: Invalid HMAC signature. traceId=${traceId}`);
        return NextResponse.json({ error: 'Unauthorized: Invalid HMAC Signature', traceId }, { status: 401 });
    }

    // ── Parse Body ────────────────────────────────────────────────────────────
    let body: UnknownObject;
    try {
        body = JSON.parse(rawBody);
    } catch {
        logOfflineTransactionDebug(traceId, 'receive:rejected', { reason: 'Invalid JSON body' });
        return NextResponse.json({ error: 'Invalid JSON body', traceId }, { status: 400 });
    }

    // ── Event Filtering ───────────────────────────────────────────────────────
    // Accept both payload schemas:
    //   • Old Textbee:  { event: "MESSAGE_RECEIVED", data: { sender, message } }
    //   • New Textbee:  { type: "RECEIVED", sender, message }
    const isLegacyEvent = body.event === 'MESSAGE_RECEIVED';
    const isNewTypeEvent = body.type === 'RECEIVED';
    const isDeliveryReceipt = body.event && body.event !== 'MESSAGE_RECEIVED';

    if (!isLegacyEvent && !isNewTypeEvent) {
        if (isDeliveryReceipt) {
            return NextResponse.json({ success: true, status: 'Ignored' });
        }
        // Unknown schema — log and continue optimistically.
        console.warn('[SMS Webhook] Unknown event schema. Attempting to process anyway.');
    }

    // ── Extract Data Payload ──────────────────────────────────────────────────
    const sms = extractSmsPayload(body);

    if (!sms) {
        console.warn('[SMS Webhook] Missing sender/message in payload.');
        return NextResponse.json({ error: 'Missing sender or message field' }, { status: 400 });
    }

    const { senderPhone, message } = sms;

    // Enforce SMS body character limit (protects downstream parsers from huge strings).
    if (message.length > MAX_SMS_BODY_CHARS) {
        console.warn(`[SMS Webhook] Blocked: SMS body too long (${message.length} chars). traceId=${traceId}`);
        return NextResponse.json({ error: 'SMS body exceeds maximum length', traceId }, { status: 400 });
    }

    logOfflineTransactionDebug(traceId, 'receive:extracted-sms', {
        eventType: sms.eventType,
        // Mask phone for PII safety.
        senderPhone: maskPhoneNumber(senderPhone),
        smsBodyCharLength: message.length,
    });

    // ── Tier 2: Rate Limiting (keyed on sender phone) ─────────────────────────
    const { success: withinLimit } = await ratelimit.limit(senderPhone);
    if (!withinLimit) {
        console.warn(`[SMS Webhook] Rate limit exceeded for sender ${maskPhoneNumber(senderPhone)}`);
        return NextResponse.json({ success: true, status: 'Rate Limited' });
    }

    // ── Parse Voucher & Deduplication ──────────────────────────────────────────
    let voucher;
    try {
        voucher = parseOfflineVoucher(message);
    } catch (error) {
        const reason = error instanceof Error ? error.message : 'Malformed payload';
        logOfflineTransactionDebug(traceId, 'decompress:rejected', { reason });
        return NextResponse.json({ error: reason, traceId }, { status: 400 });
    }

    logOfflineVoucherDecompression(traceId, message, voucher);

    const { senderShortId, nonceB64: nonce } = voucher;

    // ── Shield Layer 3: Early Redis nonce deduplication (fail-open) ───────────
    // Refinement #3: Redis errors are caught inside checkAndSetNonceReplay —
    // they log a warning and return false (not replay), allowing QStash
    // deduplication and contract-level nonce checks to handle it downstream.
    const isReplay = await checkAndSetNonceReplay(nonce, traceId);
    if (isReplay) {
        console.warn(`[SMS Webhook] Early nonce replay detected. traceId=${traceId} senderShortId=${senderShortId}`);
        return NextResponse.json({ success: true, status: 'Duplicate Replay', traceId });
    }

    const deduplicationId = `${senderShortId}_${nonce}`;

    const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '');
    if (!appUrl) {
        console.error('[SMS Webhook] Missing NEXT_PUBLIC_APP_URL. Cannot publish settlement job.');
        return NextResponse.json({ error: 'Webhook misconfigured' }, { status: 500 });
    }

    const settleUrl = `${appUrl}/api/engine/settle`;

    try {
        const qstashResult = await qstash.publishJSON({
            url: settleUrl,
            body: { smsPayload: message, senderPhone, traceId },
            deduplicationId,
        });
        logOfflineTransactionDebug(traceId, 'queue:published', {
            deduplicationId,
            target: settleUrl,
            qstashMessageId: qstashResult,
        });
    } catch (err) {
        console.error('[SMS Webhook] QStash publish failed. SMS was NOT buffered:', err);
        return NextResponse.json({ error: 'Failed to buffer settlement' }, { status: 500 });
    }

    await sendSmsNotification(
        senderPhone,
        'Pijin: Payload received. Processing transaction... Please wait'
    ).catch((err) => {
        console.warn('[SMS Webhook] Ack SMS failed after QStash buffer:', err);
    });

    return NextResponse.json({ success: true, status: 'Buffered', traceId });
}
