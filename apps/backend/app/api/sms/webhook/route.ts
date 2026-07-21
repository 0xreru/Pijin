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
 *       #### Dual-Layer Authentication Shield
 *       Every request must pass **at least one** of:
 *       1. **Layer A — HMAC-SHA256** (`x-signature` or `x-textbee-signature` header):
 *          Server recomputes the HMAC of the raw body against `TEXTBEE_WEBHOOK_SECRET`
 *          and compares using `crypto.timingSafeEqual` (prevents timing attacks).
 *       2. **Layer B — URL Secret** (`?secret=<TEXTBEE_WEBHOOK_SECRET>` query param):
 *          Fallback for Android SMS apps that may alter whitespace/encoding in the body.
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
 *         description: URL-based fallback secret (equals `TEXTBEE_WEBHOOK_SECRET`). Used when HMAC header is unavailable.
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
 *                   enum: [Buffered, Ignored, Rate Limited]
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
 *         description: Both HMAC verification and URL secret check failed.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Unauthorized"
 */
import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { Client } from '@upstash/qstash';
import { sendSmsNotification } from '@/lib/sms';
import { parseOfflineVoucher } from '@/lib/offline-voucher';
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

/**
 * Tier 1 – HMAC-SHA256 Signature Verification
 */
function verifyHmacSignature(rawBody: string, incomingSignature: string): boolean {
    const secret = process.env.TEXTBEE_WEBHOOK_SECRET;
    if (!secret) return false;

    try {
        const expectedRaw = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
        
        // Strip any "sha256=" prefix if it exists to normalize the hex string
        const cleanIncomingSig = incomingSignature.replace(/^sha256=/, '');
        const incomingBuf = Buffer.from(cleanIncomingSig, 'hex');
        const expectedRawBuf = Buffer.from(expectedRaw, 'hex');

        if (incomingBuf.length === expectedRawBuf.length && crypto.timingSafeEqual(incomingBuf, expectedRawBuf)) return true;
        
        // Attempt parsing fallback just in case Android added invisible spaces
        let expectedParsed = '';
        try {
            expectedParsed = crypto.createHmac('sha256', secret).update(JSON.stringify(JSON.parse(rawBody)), 'utf8').digest('hex');
            const expectedParsedBuf = Buffer.from(expectedParsed, 'hex');
            if (incomingBuf.length === expectedParsedBuf.length && crypto.timingSafeEqual(incomingBuf, expectedParsedBuf)) return true;
        } catch { }

        return false;
    } catch {
        return false;
    }
}

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

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/sms/webhook  – Ingress Shield
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

export async function POST(req: Request) {
    const traceId = createOfflineTransactionTraceId();

    logOfflineTransactionDebug(traceId, 'receive:http', {
        url: sanitizeOfflineDebugUrl(req.url),
        method: req.method,
        headers: sanitizeOfflineDebugHeaders(req.headers),
    });

    let rawBody = '';
    try {
        rawBody = await req.text();
    } catch (err) {
        console.error('############################################################');
        console.error('### SMS WEBHOOK BODY READ FAILED - REQUEST DID HIT VERCEL ###');
        console.error('############################################################');
        console.error('[SMS WEBHOOK BODY READ ERROR]', {
            traceId,
            url: sanitizeOfflineDebugUrl(req.url),
            method: req.method,
            errorName: err instanceof Error ? err.name : 'UnknownError',
            errorMessage: err instanceof Error ? err.message : String(err),
            errorStack: err instanceof Error ? err.stack : undefined,
        });
        return NextResponse.json({ error: 'Failed to read request body', traceId }, { status: 400 });
    }

    logOfflineTransactionDebug(traceId, 'receive:raw-body', {
        rawBody,
        rawBodyLength: rawBody.length,
    });

    // ── Tier 1: Dual-Layer Ingress Shield ─────────────────────────────────────
    const incomingSignature = req.headers.get('x-signature') || req.headers.get('x-textbee-signature') || '';
    
    // Extract the secret from the URL query params (e.g. ?secret=...)
    const url = new URL(req.url);
    const incomingSecretUrl = url.searchParams.get('secret');
    const expectedSecret = process.env.TEXTBEE_WEBHOOK_SECRET;

    let isAuthorized = false;
    let authorizationMethod = 'none';

    // Shield Layer A: Check HMAC Math
    if (incomingSignature && verifyHmacSignature(rawBody, incomingSignature)) {
        isAuthorized = true;
        authorizationMethod = 'hmac-sha256';
    } 
    // Shield Layer B: Fallback to HTTPS URL Secret
    else if (incomingSecretUrl && incomingSecretUrl === expectedSecret) {
        console.log('[SMS Webhook] Authorized via URL Secret.');
        isAuthorized = true;
        authorizationMethod = 'url-secret';
    }

    logOfflineTransactionDebug(traceId, 'receive:auth', {
        authorized: isAuthorized,
        authorizationMethod,
        hmacHeaderPresent: Boolean(incomingSignature),
        urlSecretPresent: Boolean(incomingSecretUrl),
    });

    if (!isAuthorized) {
        console.warn(`[SMS Webhook] Blocked: Invalid HMAC and missing URL secret. traceId=${traceId}`);
        return NextResponse.json({ error: 'Unauthorized', traceId }, { status: 401 });
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
    //   • New Textbee:  { type: "RECEIVED", sender, message }  ← confirmed from live payload
    const isLegacyEvent = body.event === 'MESSAGE_RECEIVED';
    const isNewTypeEvent = body.type === 'RECEIVED';
    const isDeliveryReceipt = body.event && body.event !== 'MESSAGE_RECEIVED';

    if (!isLegacyEvent && !isNewTypeEvent) {
        // Only reject if we can positively identify a non-inbound event type
        if (isDeliveryReceipt) {
            console.log(`[SMS Webhook] Ignored event type: ${body.event}`);
            return NextResponse.json({ success: true, status: 'Ignored' });
        }
        // Unknown schema — log it and continue optimistically
        console.warn('[SMS Webhook] Unknown event schema. Attempting to process anyway:', JSON.stringify(body));
    }

    // ── Extract Data Payload ──────────────────────────────────────────────────
    const sms = extractSmsPayload(body);

    if (!sms) {
        console.warn('[SMS Webhook] Missing sender/message in payload:', JSON.stringify(body));
        return NextResponse.json({ error: 'Missing sender or message field' }, { status: 400 });
    }

    const { senderPhone, message } = sms;

    logOfflineTransactionDebug(traceId, 'receive:extracted-sms', {
        eventType: sms.eventType,
        senderPhone,
        smsBody: message,
        smsBodyCharLength: message.length,
    });

    // ── Tier 2: Rate Limiting (keyed on sender phone) ─────────────────────────
    const { success: withinLimit } = await ratelimit.limit(senderPhone);
    if (!withinLimit) {
        console.warn(`[SMS Webhook] Rate limit exceeded for sender ${senderPhone}`);
        return NextResponse.json({ success: true, status: 'Rate Limited' });
    }

    // ── Deduplication via Nonce ────────────────────────────────────────────────
    let voucher;
    try {
        voucher = parseOfflineVoucher(message);
    } catch (error) {
        const reason = error instanceof Error ? error.message : 'Malformed payload';
        logOfflineTransactionDebug(traceId, 'decompress:rejected', {
            smsBody: message,
            reason,
        });
        return NextResponse.json({ error: reason, traceId }, { status: 400 });
    }

    logOfflineVoucherDecompression(traceId, message, voucher);

    const { senderShortId, nonceB64: nonce } = voucher;

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
            qstashResult,
        });
        console.log('[SMS Webhook] QStash accepted settlement job:', JSON.stringify(qstashResult));
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

    console.log(
        `[SMS Webhook] Buffered → QStash | deduplicationId=${deduplicationId} | target=${settleUrl}`
    );

    return NextResponse.json({ success: true, status: 'Buffered', traceId });
}
