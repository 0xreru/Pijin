/**
 * Shared SMS notification utility.
 *
 * Required environment variables:
 * TEXTBEE_GATEWAY_URL - Full Textbee device endpoint URL
 * TEXTBEE_API_KEY     - API key sent in the x-api-key header
 */

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

export async function sendSmsNotification(to: string, message: string): Promise<void> {
    const formattedTo = normalizeSmsRecipient(to);
    if (!formattedTo) {
        console.info('[SMS] Skipped notification for non-phone recipient');
        return;
    }

    const gatewayUrl = process.env.TEXTBEE_GATEWAY_URL;
    const apiKey = process.env.TEXTBEE_API_KEY;

    if (!gatewayUrl || !apiKey) {
        console.error('[SMS] Missing Textbee config (TEXTBEE_GATEWAY_URL / TEXTBEE_API_KEY)');
        return;
    }

    const response = await fetch(gatewayUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
        },
        body: JSON.stringify({
            recipients: [formattedTo],
            message,
        }),
    });

    if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(`[SMS] Textbee responded ${response.status}: ${errText}`);
    }

    console.log(`[SMS] Notification sent to ${formattedTo}`);
}
