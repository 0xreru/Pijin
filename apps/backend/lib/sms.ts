/**
 * Unified TextBee SMS sender.
 *
 * Every outbound SMS goes through `deliverSms`:
 *  - recipient normalised to E.164 (PH local formats → +63)
 *  - per-attempt timeout plus an overall deadline (keeps Vercel functions in budget)
 *  - retries only on network errors / timeouts / 408 / 429 / 5xx — never on other 4xx
 *  - optional SIM selection and an optional fallback device
 *
 * Environment variables:
 * TEXTBEE_GATEWAY_URL           - Full primary device endpoint (or derive from TEXTBEE_DEVICE_ID)
 * TEXTBEE_DEVICE_ID             - Primary device id
 * TEXTBEE_API_KEY               - API key sent in the x-api-key header
 * TEXTBEE_SIM_SUBSCRIPTION_ID   - Optional SIM slot on the primary device
 * TEXTBEE_TIMEOUT_MS            - Per-attempt timeout (default 4500)
 * TEXTBEE_RETRIES               - Retries per device (default 2)
 * TEXTBEE_FALLBACK_GATEWAY_URL / TEXTBEE_FALLBACK_DEVICE_ID / TEXTBEE_FALLBACK_API_KEY /
 * TEXTBEE_FALLBACK_SIM_SUBSCRIPTION_ID - Optional second device, tried when the primary fails.
 */

const TEXTBEE_API_BASE = 'https://api.textbee.dev/api/v1/gateway/devices';
const DEFAULT_DEADLINE_MS = 15_000;
const MIN_ATTEMPT_MS = 500;

export type SmsGateway = {
    name: 'primary' | 'fallback';
    url: string;
    apiKey: string;
    simSubscriptionId?: number;
};

export type SendSmsOptions = {
    /** Retries per device after the first attempt. */
    retries?: number;
    /** Per-attempt timeout. */
    timeoutMs?: number;
    /** Overall budget across all attempts and devices. */
    deadlineMs?: number;
};

export type SmsResult =
    | { success: true; gateway: SmsGateway['name']; attempts: number; data?: unknown }
    | { success: false; error: string; attempts: number; retryable: boolean };

export function normalizeSmsRecipient(to: string): string | null {
    const compact = to.trim().replace(/[\s().-]/g, '');

    let normalized = compact;
    if (/^09\d{9}$/.test(normalized)) {
        normalized = `+63${normalized.slice(1)}`;
    } else if (/^63\d{10}$/.test(normalized)) {
        normalized = `+${normalized}`;
    }

    return /^\+[1-9]\d{7,14}$/.test(normalized) ? normalized : null;
}

export function isRetryableStatus(status: number): boolean {
    return status === 408 || status === 429 || status >= 500;
}

function parseSimId(raw: string | undefined): number | undefined {
    if (!raw || raw.trim().length === 0) return undefined;
    const value = Number.parseInt(raw, 10);
    return Number.isInteger(value) ? value : undefined;
}

function resolveUrl(explicit: string | undefined, deviceId: string | undefined): string | undefined {
    if (explicit?.trim()) return explicit.trim();
    if (deviceId?.trim()) return `${TEXTBEE_API_BASE}/${deviceId.trim()}/send-sms`;
    return undefined;
}

export function getSmsGateways(env: Record<string, string | undefined> = process.env): SmsGateway[] {
    const gateways: SmsGateway[] = [];
    const apiKey = env.TEXTBEE_API_KEY;

    const primaryUrl = resolveUrl(env.TEXTBEE_GATEWAY_URL, env.TEXTBEE_DEVICE_ID) ?? env.TEXTBEE_TAILSCALE_URL;
    if (primaryUrl && apiKey) {
        gateways.push({
            name: 'primary',
            url: primaryUrl,
            apiKey,
            simSubscriptionId: parseSimId(env.TEXTBEE_SIM_SUBSCRIPTION_ID),
        });
    }

    const fallbackUrl = resolveUrl(env.TEXTBEE_FALLBACK_GATEWAY_URL, env.TEXTBEE_FALLBACK_DEVICE_ID);
    const fallbackKey = env.TEXTBEE_FALLBACK_API_KEY || apiKey;
    if (fallbackUrl && fallbackKey && fallbackUrl !== primaryUrl) {
        gateways.push({
            name: 'fallback',
            url: fallbackUrl,
            apiKey: fallbackKey,
            simSubscriptionId: parseSimId(env.TEXTBEE_FALLBACK_SIM_SUBSCRIPTION_ID),
        });
    }

    return gateways;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function sendViaGateway(
    gateway: SmsGateway,
    recipient: string,
    message: string,
    retries: number,
    timeoutMs: number,
    deadline: number,
): Promise<SmsResult> {
    const body = JSON.stringify({
        recipients: [recipient],
        message,
        ...(gateway.simSubscriptionId !== undefined ? { simSubscriptionId: gateway.simSubscriptionId } : {}),
    });

    let attempts = 0;
    let lastError = 'No attempt made (deadline exhausted)';

    for (let attempt = 1; attempt <= retries + 1; attempt++) {
        const remaining = deadline - Date.now();
        if (remaining < MIN_ATTEMPT_MS) break;
        attempts = attempt;

        let response: Response;
        try {
            response = await fetch(gateway.url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-api-key': gateway.apiKey },
                body,
                signal: AbortSignal.timeout(Math.min(timeoutMs, remaining)),
            });
        } catch (err) {
            const e = err as { message?: string; cause?: { code?: string } };
            lastError = `${e?.message || 'Gateway unreachable'}${e?.cause?.code ? ` (${e.cause.code})` : ''}`;
            console.warn(`[SMS] ${gateway.name} network error, attempt ${attempt}/${retries + 1}: ${lastError}`);
            if (attempt <= retries) await sleep(Math.min(400 * attempt + Math.random() * 200, Math.max(0, deadline - Date.now())));
            continue;
        }

        if (response.ok) {
            const data = await response.json().catch(() => null);
            return { success: true, gateway: gateway.name, attempts, data };
        }

        const errorText = await response.text().catch(() => '');
        lastError = `HTTP ${response.status}: ${errorText || 'Unknown gateway error'}`;
        console.warn(`[SMS] ${gateway.name} ${lastError}, attempt ${attempt}/${retries + 1}`);

        if (!isRetryableStatus(response.status)) {
            return { success: false, error: lastError, attempts, retryable: false };
        }
        if (attempt <= retries) await sleep(Math.min(400 * attempt + Math.random() * 200, Math.max(0, deadline - Date.now())));
    }

    return { success: false, error: lastError, attempts, retryable: true };
}

/** Sends one SMS. Never throws. */
export async function deliverSms(to: string, message: string, options: SendSmsOptions = {}): Promise<SmsResult> {
    const recipient = normalizeSmsRecipient(to);
    if (!recipient) {
        return { success: false, error: `Invalid phone recipient: "${to}"`, attempts: 0, retryable: false };
    }

    const gateways = getSmsGateways();
    if (gateways.length === 0) {
        return {
            success: false,
            error: 'Missing TextBee config (TEXTBEE_GATEWAY_URL or TEXTBEE_DEVICE_ID, and TEXTBEE_API_KEY)',
            attempts: 0,
            retryable: false,
        };
    }

    const retries = options.retries ?? Number.parseInt(process.env.TEXTBEE_RETRIES ?? '2', 10);
    const timeoutMs = options.timeoutMs ?? Number.parseInt(process.env.TEXTBEE_TIMEOUT_MS ?? '4500', 10);
    const deadline = Date.now() + (options.deadlineMs ?? DEFAULT_DEADLINE_MS);

    let attempts = 0;
    let last: SmsResult = { success: false, error: 'No gateway attempted', attempts: 0, retryable: true };
    for (const gateway of gateways) {
        // Any primary failure (including 4xx such as a disabled device) is worth one try on the fallback.
        const result = await sendViaGateway(gateway, recipient, message, retries, timeoutMs, deadline);
        attempts += result.attempts;
        if (result.success) return { ...result, attempts };
        last = result;
    }
    return { ...last, attempts };
}

/** Throwing wrapper kept for existing callers. */
export async function sendSmsNotification(to: string, message: string, options?: SendSmsOptions): Promise<void> {
    const result = await deliverSms(to, message, options);
    if (!result.success) {
        throw new Error(`[SMS] ${result.error}`);
    }
}

export const sendSms = sendSmsNotification;
