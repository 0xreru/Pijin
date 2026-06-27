/**
 * Shared SMS notification utility.
 *
 * Sends a single SMS via the Textbee Android Gateway. This is intentionally
 * kept simple and fire-and-forget — callers should catch errors themselves.
 *
 * Required env vars:
 * TEXTBEE_GATEWAY_URL  – Full Textbee device endpoint URL
 * TEXTBEE_API_KEY      – API key sent in x-api-key header
 */
export async function sendSmsNotification(to: string, message: string): Promise<void> {
    const gatewayUrl = process.env.TEXTBEE_GATEWAY_URL;
    const apiKey = process.env.TEXTBEE_API_KEY;

    if (!gatewayUrl || !apiKey) {
        console.error('[SMS] Missing Textbee config (TEXTBEE_GATEWAY_URL / TEXTBEE_API_KEY)');
        return;
    }

    // Robust E.164 formatting: remove spaces and normalize PH 09 prefix
    let formattedTo = to.trim().replace(/\s+/g, '');
    if (formattedTo.startsWith('09') && formattedTo.length === 11) {
        formattedTo = '+63' + formattedTo.substring(1);
    } else if (!formattedTo.startsWith('+')) {
        // Fallback: forcefully prepend + if missing to satisfy strict gateway regex
        formattedTo = '+' + formattedTo;
    }

    const response = await fetch(gatewayUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
        },
        // 🔥 ARCHITECT FIX: Textbee requires EXACTLY 'recipients' and 'message' in the body.
        // deviceId is omitted because it is already embedded in the REST URL.
        body: JSON.stringify({ 
            recipients: [formattedTo], 
            message 
        }),
    });

    if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(`[SMS] Textbee responded ${response.status}: ${errText}`);
    }

    console.log(`[SMS] Notification sent to ${formattedTo}`);
}