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
    const rawBody = await req.text();

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
        console.log('[SMS Webhook] HMAC mismatched (Android encoding drift), but URL Secret matched perfectly. Fallback Authorized.');
        isAuthorized = true;
    }

    if (!isAuthorized) {
        console.warn(`[SMS Webhook] Tier 1 FAIL – Invalid HMAC and missing/invalid URL secret.`);
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
    // We only care about incoming text messages
    if (body.event && body.event !== 'MESSAGE_RECEIVED') {
        console.log(`[SMS Webhook] Ignoring non-inbound event: ${body.event}`);
        return NextResponse.json({ success: true, status: 'Ignored' });
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