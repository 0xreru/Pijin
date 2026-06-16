import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { Client } from '@upstash/qstash';

// ─────────────────────────────────────────────────────────────────────────────
// Runtime
// ─────────────────────────────────────────────────────────────────────────────
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// ─────────────────────────────────────────────────────────────────────────────
// Tier 2 – Rate Limiter (Sliding Window: 20 req / 60 s per IP)
// Initialized once at module level to reuse the Redis connection.
// ─────────────────────────────────────────────────────────────────────────────
const ratelimit = new Ratelimit({
    redis: Redis.fromEnv(),
    limiter: Ratelimit.slidingWindow(20, '60 s'),
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

    // ── Tier 2: Rate Limiting ─────────────────────────────────────────────────
    const ip =
        req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? '127.0.0.1';

    const { success: withinLimit } = await ratelimit.limit(ip);
    if (!withinLimit) {
        console.warn(`[SMS Webhook] Tier 2 FAIL – rate limit exceeded for IP ${ip}`);
        return NextResponse.json({ error: 'Too Many Requests' }, { status: 429 });
    }

    // ── Parse Body ────────────────────────────────────────────────────────────
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
    // Expected SMS format: sender:receiver:amount:nonce:signature
    const parts = message.split(':');

    if (parts.length < 6) {
        return NextResponse.json({ error: 'Malformed payload' }, { status: 400 });
    }

    const [tokenId, sender, receiver, amount, nonce, signature] = parts;

    if (!sender || !nonce) {
        return NextResponse.json({ error: 'Malformed payload' }, { status: 400 });
    }

    const deduplicationId = `${sender}_${nonce}`;

    // ── QStash Publish ────────────────────────────────────────────────────────
    const settleUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/engine/settle`;

    await qstash.publishJSON({
        url: settleUrl,
        body: { smsPayload: message },
        deduplicationId,
    });

    console.log(
        `[SMS Webhook] Buffered → QStash | deduplicationId=${deduplicationId} | target=${settleUrl}`
    );

    // ── Fast Ack ──────────────────────────────────────────────────────────────
    return NextResponse.json({ success: true, status: 'Buffered' });
}
