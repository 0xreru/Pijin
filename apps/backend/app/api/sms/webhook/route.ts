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
    prefix: 'omnifi:sms:webhook',
});

const qstash = new Client({
    token: process.env.QSTASH_TOKEN || 'dummy_token_to_bypass_build',
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tier 1 – HMAC-SHA256 Signature Verification (Matched to Textbee Docs)
 */
function verifyHmacSignature(rawBody: string, incomingSignature: string): boolean {
    const secret = process.env.TEXTBEE_WEBHOOK_SECRET;
    if (!secret) {
        console.error('[SMS Webhook] Missing TEXTBEE_WEBHOOK_SECRET env var!');
        return false;
    }

    try {
        // Textbee docs suggest they might hash the stringified parsed payload
        // We will try hashing the raw text first, and if that fails, try 
        // hashing the re-stringified payload to be safe against formatting drift.
        const expectedRaw = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
        
        let expectedParsed = '';
        try {
            expectedParsed = crypto.createHmac('sha256', secret).update(JSON.stringify(JSON.parse(rawBody)), 'utf8').digest('hex');
        } catch { /* ignore parse error here */ }

        const incomingBuf = Buffer.from(incomingSignature, 'hex');
        const expectedRawBuf = Buffer.from(expectedRaw, 'hex');
        const expectedParsedBuf = Buffer.from(expectedParsed, 'hex');

        if (incomingBuf.length === expectedRawBuf.length && crypto.timingSafeEqual(incomingBuf, expectedRawBuf)) return true;
        if (incomingBuf.length === expectedParsedBuf.length && crypto.timingSafeEqual(incomingBuf, expectedParsedBuf)) return true;

        return false;
    } catch (err) {
        console.error('[SMS Webhook] Crypto verification error:', err);
        return false;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/sms/webhook  – Ingress Shield
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(req: Request) {
    const rawBody = await req.text();

    // ── Tier 1: HMAC Signature Verification (Using Textbee's exact header) ────
    const incomingSignature = req.headers.get('x-signature') ?? '';
    
    if (!incomingSignature || !verifyHmacSignature(rawBody, incomingSignature)) {
        console.warn('[SMS Webhook] Tier 1 FAIL – invalid HMAC signature');
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
    // Textbee sends multiple events (MESSAGE_SENT, MESSAGE_DELIVERED). 
    // We ONLY care about incoming texts!
    if (body.event && body.event !== 'MESSAGE_RECEIVED') {
        console.log(`[SMS Webhook] Ignoring non-inbound event: ${body.event}`);
        return NextResponse.json({ success: true, status: 'Ignored' });
    }

    // ── Extract Data Payload ──────────────────────────────────────────────────
    // Textbee nests the actual SMS info inside the "data" object
    const data = body.data || body;

    const senderPhone = typeof data.sender === 'string' ? data.sender.trim() : '';
    const message = typeof data.message === 'string' ? data.message.trim() : '';

    if (!senderPhone || !message) {
        return NextResponse.json({ error: 'Missing sender or message field' }, { status: 400 });
    }

    // ── Tier 2: Rate Limiting (keyed on sender phone) ─────────────────────────
    const { success: withinLimit } = await ratelimit.limit(senderPhone);
    if (!withinLimit) {
        console.warn(`[SMS Webhook] Tier 2 FAIL – rate limit exceeded for sender ${senderPhone}`);
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

    // ── Fast Acknowledgement SMS ──────────────────────────────────────────────
    sendSmsNotification(
        senderPhone,
        'Payload received. Processing transaction... Please wait'
    ).catch(console.error);

    // ── QStash Publish ────────────────────────────────────────────────────────
    const settleUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/engine/settle`;

    await qstash.publishJSON({
        url: settleUrl,
        body: { smsPayload: message, senderPhone },
        deduplicationId,
    });

    console.log(
        `[SMS Webhook] Buffered → QStash | deduplicationId=${deduplicationId} | sender=${senderPhone} | target=${settleUrl}`
    );

    return NextResponse.json({ success: true, status: 'Buffered' });
}