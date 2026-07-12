import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type TextbeeMessage = {
    _id?: string;
    id?: string;
    message?: string;
    sender?: string;
    type?: string;
    status?: string;
    receivedAt?: string;
    createdAt?: string;
};

const redis = Redis.fromEnv();

function getBearerToken(req: Request): string {
    const authorization = req.headers.get('authorization') ?? '';
    return authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : '';
}

function isAuthorized(req: Request): boolean {
    const url = new URL(req.url);
    const expectedSecret = process.env.CRON_SECRET || process.env.TEXTBEE_WEBHOOK_SECRET;
    const incomingSecret =
        url.searchParams.get('secret') ||
        req.headers.get('x-cron-secret') ||
        getBearerToken(req);

    return Boolean(expectedSecret && incomingSecret && incomingSecret === expectedSecret);
}

function textbeeMessagesUrl(): string | null {
    if (process.env.TEXTBEE_MESSAGES_URL) {
        return process.env.TEXTBEE_MESSAGES_URL;
    }

    const deviceId = process.env.TEXTBEE_DEVICE_ID?.trim();
    if (!deviceId) return null;

    return `https://api.textbee.dev/api/v1/gateway/devices/${deviceId}/messages`;
}

function normalizeMessageId(message: TextbeeMessage): string | null {
    return message._id ?? message.id ?? null;
}

function isInboundMessage(message: TextbeeMessage): boolean {
    return message.type === 'RECEIVED' || message.status === 'received';
}

async function forwardToWebhook(message: TextbeeMessage): Promise<Response> {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '');
    const secret = process.env.TEXTBEE_WEBHOOK_SECRET;

    if (!appUrl || !secret) {
        throw new Error('Missing NEXT_PUBLIC_APP_URL or TEXTBEE_WEBHOOK_SECRET');
    }

    return fetch(`${appUrl}/api/sms/webhook?secret=${encodeURIComponent(secret)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
    });
}

export async function GET(req: Request) {
    if (!isAuthorized(req)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const apiKey = process.env.TEXTBEE_API_KEY;
    const messagesUrl = textbeeMessagesUrl();

    if (!apiKey || !messagesUrl) {
        return NextResponse.json(
            { error: 'Missing TEXTBEE_API_KEY or TextBee messages URL config' },
            { status: 500 },
        );
    }

    const url = new URL(req.url);
    const limit = url.searchParams.get('limit') ?? '10';
    const since = url.searchParams.get('since');
    const textbeeUrl = new URL(messagesUrl);
    textbeeUrl.searchParams.set('limit', limit);
    textbeeUrl.searchParams.set('page', url.searchParams.get('page') ?? '1');
    if (since) textbeeUrl.searchParams.set('since', since);

    const response = await fetch(textbeeUrl, {
        headers: { 'x-api-key': apiKey },
        cache: 'no-store',
    });

    if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        console.error(`[SMS Poll] TextBee fetch failed ${response.status}:`, errorText);
        return NextResponse.json(
            { error: 'TextBee fetch failed', status: response.status, details: errorText.slice(0, 500) },
            { status: 502 },
        );
    }

    const payload = await response.json();
    const messages = Array.isArray(payload?.data) ? payload.data as TextbeeMessage[] : [];
    const inboundMessages = messages.filter(isInboundMessage);
    const results: Array<{ id: string; status: string; webhookStatus?: number }> = [];

    for (const message of inboundMessages) {
        const id = normalizeMessageId(message);
        if (!id) {
            results.push({ id: 'unknown', status: 'missing_id' });
            continue;
        }

        const dedupeKey = `pijin:sms:textbee-message:${id}`;
        const claimed = await redis.set(dedupeKey, '1', { nx: true, ex: 60 * 60 * 24 * 7 });
        if (claimed !== 'OK') {
            results.push({ id, status: 'already_seen' });
            continue;
        }

        if (!message.sender || !message.message) {
            results.push({ id, status: 'missing_sender_or_message' });
            continue;
        }

        try {
            const webhookResponse = await forwardToWebhook(message);
            const webhookPayload = await webhookResponse.json().catch(() => null);
            const buffered = webhookResponse.ok && webhookPayload?.status === 'Buffered';
            if (!buffered) {
                await redis.del(dedupeKey).catch(() => undefined);
            }

            results.push({
                id,
                status: buffered ? 'forwarded' : 'webhook_failed',
                webhookStatus: webhookResponse.status,
            });
        } catch (err) {
            await redis.del(dedupeKey).catch(() => undefined);
            console.error(`[SMS Poll] Forward failed for TextBee message ${id}:`, err);
            results.push({ id, status: 'forward_failed' });
        }
    }

    return NextResponse.json({
        success: true,
        fetched: messages.length,
        inbound: inboundMessages.length,
        results,
    });
}

export const POST = GET;
