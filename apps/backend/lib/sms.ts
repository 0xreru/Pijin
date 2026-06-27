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

    // Clean any weird characters from the incoming number
    let formattedTo = to.trim().replace(/[^0-9+]/g, '');
    
    // 🔥 ARCHITECT FIX: Local Philippine Android phones / Telcos (Globe/Smart) 
    // often silently drop programmatic SMS sent to "+63". 
    // We must convert it back to the local "09" format for standard GSM delivery.
    if (formattedTo.startsWith('+63')) {
        formattedTo = '0' + formattedTo.substring(3);
    } else if (formattedTo.startsWith('63') && formattedTo.length === 12) {
        formattedTo = '0' + formattedTo.substring(2);
    }

    const response = await fetch(gatewayUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
        },
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