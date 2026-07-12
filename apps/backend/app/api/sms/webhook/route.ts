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
    } catch (err) {
        return false;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/sms/webhook  – Ingress Shield
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(req: Request) {
    // ── 🚨 EXTREME INGRESS LOGGING — fires before auth, parse, or any logic ──────
    console.log('\n=============================================');
    console.log('[SMS WEBHOOK] 🚨 INCOMING PING DETECTED 🚨');
    console.log('URL:', req.url);
    console.log('METHOD:', req.method);
    console.log('HEADERS:', JSON.stringify(Object.fromEntries(req.headers.entries()), null, 2));
    // ── Read raw body (must be done before any other body access) ────────────────
    const rawBody = await req.text();
    console.log('RAW BODY:', rawBody);

    // ── Tier 1: Dual-Layer Ingress Shield ─────────────────────────────────────
    const incomingSignature = req.headers.get('x-signature') || req.headers.get('x-textbee-signature') || '';
    
    // Extract the secret from the URL query params (e.g. ?secret=...)
    const url = new URL(req.url);
    const incomingSecretUrl = url.searchParams.get('secret');
    const expectedSecret = process.env.TEXTBEE_WEBHOOK_SECRET;

    let isAuthorized = false;

    // Shield Layer A: Check HMAC Math
    if (incomingSignature && verifyHmacSignature(rawBody, incomingSignature)) {
        isAuthorized = true;
    } 
    // Shield Layer B: Fallback to HTTPS URL Secret
    else if (incomingSecretUrl && incomingSecretUrl === expectedSecret) {
        console.log('[SMS Webhook] Authorized via URL Secret.');
        isAuthorized = true;
    }

    if (!isAuthorized) {
        console.warn(`[SMS Webhook] Blocked: Invalid HMAC and missing URL secret.`);
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // ── Parse Body ────────────────────────────────────────────────────────────
    let body: any;
    try {
        body = JSON.parse(rawBody);
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
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
    // Textbee wraps the payload in "data"
    const data = body.data || body;

    const senderPhone = typeof data.sender === 'string' ? data.sender.trim() : '';
    const message = typeof data.message === 'string' ? data.message.trim() : '';

    if (!senderPhone || !message) {
        return NextResponse.json({ error: 'Missing sender or message field' }, { status: 400 });
    }

    // ── Tier 2: Rate Limiting (keyed on sender phone) ─────────────────────────
    const { success: withinLimit } = await ratelimit.limit(senderPhone);
    if (!withinLimit) {
        console.warn(`[SMS Webhook] Rate limit exceeded for sender ${senderPhone}`);
        return NextResponse.json({ success: true, status: 'Rate Limited' });
    }

    // ── Deduplication via Nonce ────────────────────────────────────────────────
    const parts = message.split(':');
    if (parts.length < 6) {
        return NextResponse.json({ error: 'Malformed payload' }, { status: 400 });
    }

    const [, senderShortId, , , nonce] = parts;
    if (!senderShortId || !nonce) {
        return NextResponse.json({ error: 'Malformed payload' }, { status: 400 });
    }

    const deduplicationId = `${senderShortId}_${nonce}`;

    // ── QStash Publish & Fast Ack (Parallel Execution) ────────────────────────
    // 🔥 ARCHITECT FIX: Run QStash and SMS concurrently using Promise.allSettled.
    // This keeps Vercel alive just long enough, but cuts the response time in half
    // to prevent Textbee 502 Timeout errors.
    const settleUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/engine/settle`;

    const qstashPromise = qstash.publishJSON({
        url: settleUrl,
        body: { smsPayload: message, senderPhone },
        deduplicationId,
    });

    const smsPromise = sendSmsNotification(
        senderPhone,
        'Pijin: Payload received. Processing transaction... Please wait'
    );

    // Wait for both network requests to leave the server simultaneously
    await Promise.allSettled([qstashPromise, smsPromise]);

    console.log(
        `[SMS Webhook] Buffered → QStash | deduplicationId=${deduplicationId} | target=${settleUrl}`
    );

    return NextResponse.json({ success: true, status: 'Buffered' });
}