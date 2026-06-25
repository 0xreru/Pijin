/**
 * Shared SMS notification utility.
 *
 * Sends a single SMS via the Textbee Android Gateway. This is intentionally
 * kept simple and fire-and-forget — callers should catch errors themselves.
 *
 * Required env vars:
 *   TEXTBEE_GATEWAY_URL  – Full Textbee device endpoint URL
 *   TEXTBEE_API_KEY      – API key sent in x-api-key header
 *   TEXTBEE_DEVICE_ID    – Device ID included in the JSON body
 */
export async function sendSmsNotification(to: string, message: string): Promise<void> {
    const gatewayUrl = process.env.TEXTBEE_GATEWAY_URL;
    const apiKey = process.env.TEXTBEE_API_KEY;
    const deviceId = process.env.TEXTBEE_DEVICE_ID;

    if (!gatewayUrl || !apiKey || !deviceId) {
        console.error('[SMS] Missing Textbee config (TEXTBEE_GATEWAY_URL / TEXTBEE_API_KEY / TEXTBEE_DEVICE_ID)');
        return;
    }

    const response = await fetch(gatewayUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
        },
        body: JSON.stringify({ deviceId, to, message }),
    });

    if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(`[SMS] Textbee responded ${response.status}: ${errText}`);
    }

    console.log(`[SMS] Notification sent to ${to}`);
}
