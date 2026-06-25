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
// Strict limit to prevent SMS Pumping attacks draining Textbee credits.
// Initialized once at module level to reuse the Redis connection.
// ─────────────────────────────────────────────────────────────────────────────
const ratelimit = new Ratelimit({
    redis: Redis.fromEnv(),
    limiter: Ratelimit.slidingWindow(3, '60 s'),
    analytics: false,
    prefix: 'omnifi:sms:webhook',
});

// ─────────────────────────────────────────────────────────────────────────────
// QStash Publisher
// ─────────────────────────────────────────────────────────────────────────────
const qstash = new Client({
    token: process.env.QSTASH_TOKEN || 'dummy_token_to_bypass_build',
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tier 1 – HMAC-SHA256 Signature Verification
 * Uses timingSafeEqual to prevent timing-attack leaks.
 */
function verifyHmacSignature(rawBody: string, incomingSignature: string): boolean {
    const secret = process.env.TEXTBEE_WEBHOOK_SECRET;
    if (!secret) return false;

    const expected = crypto
        .createHmac('sha256', secret)
        .update(rawBody, 'utf8')
        .digest('hex');

    // Normalise to Buffer of equal length before constant-time comparison.
    const expectedBuf = Buffer.from(expected, 'hex');
    const incomingBuf = Buffer.from(incomingSignature.replace(/^sha256=/, ''), 'hex');

    if (expectedBuf.length !== incomingBuf.length) return false;
    return crypto.timingSafeEqual(expectedBuf, incomingBuf);
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/sms/webhook  – Ingress Shield
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(req: Request) {
    // ── Tier 1: HMAC Signature Verification ───────────────────────────────────
    const rawBody = await req.text();

    const incomingSignature = req.headers.get('x-textbee-signature') ?? '';
    if (!incomingSignature || !verifyHmacSignature(rawBody, incomingSignature)) {
        console.warn('[SMS Webhook] Tier 1 FAIL – invalid HMAC signature');
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // ── Parse Body ────────────────────────────────────────────────────────────
    // Parsed BEFORE rate-limiting so we can key the limiter on the sender phone.
    let body: unknown;
    try {
        body = JSON.parse(rawBody);
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    if (!body || typeof body !== 'object') {
        return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }

    const parsed = body as { text?: unknown; message?: unknown; sender?: unknown };

    // Extract the sender's phone number for rate-limiting.
    const senderPhone =
        typeof parsed.sender === 'string' ? parsed.sender.trim() : '';

    if (!senderPhone) {
        return NextResponse.json({ error: 'Missing sender field' }, { status: 400 });
    }

    // ── Tier 2: Rate Limiting (keyed on sender phone, not IP) ─────────────────
    // Silent-drop on exceed: return 200 so Textbee does NOT retry, but we
    // waste zero SMS credits replying to the spammer.
    const { success: withinLimit } = await ratelimit.limit(senderPhone);
    if (!withinLimit) {
        console.warn(`[SMS Webhook] Tier 2 FAIL – rate limit exceeded for sender ${senderPhone}`);
        return NextResponse.json({ success: true, status: 'Rate Limited' });
    }

    // ── Extract SMS content ───────────────────────────────────────────────────
    const rawSmsContent =
        typeof parsed.text === 'string' ? parsed.text : parsed.message;
    const message =
        typeof rawSmsContent === 'string' ? rawSmsContent.trim() : '';

    if (!message) {
        return NextResponse.json(
            { error: 'Missing text/message field' },
            { status: 400 }
        );
    }

    // ── Deduplication via Nonce ────────────────────────────────────────────────
    // Expected SMS format: tokenId:senderShortId:receiverShortId:amountBase62:nonce:signature
    const parts = message.split(':');

    if (parts.length < 6) {
        return NextResponse.json({ error: 'Malformed payload' }, { status: 400 });
    }

    const [, sender, , , nonce] = parts;

    if (!sender || !nonce) {
        return NextResponse.json({ error: 'Malformed payload' }, { status: 400 });
    }

    const deduplicationId = `${sender}_${nonce}`;

    // ── Fast Acknowledgement SMS ──────────────────────────────────────────────
    // Fire-and-forget: do NOT await so the 200 fast-ack is not delayed.
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

    // ── Fast Ack ──────────────────────────────────────────────────────────────
    return NextResponse.json({ success: true, status: 'Buffered' });
}
