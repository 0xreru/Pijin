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
    
    // Textbee strictly requires E.164 format (+639...) to deliver via local cell towers.
    // If the number starts with '09' (local PH format), convert it to '+639'.
    // If it starts with '63' (missing the '+'), prepend the '+'.
    if (formattedTo.startsWith('09') && formattedTo.length === 11) {
        formattedTo = '+63' + formattedTo.substring(1);
    } else if (formattedTo.startsWith('63') && formattedTo.length === 12) {
        formattedTo = '+' + formattedTo;
    } else if (!formattedTo.startsWith('+')) {
         // Fallback just in case
         formattedTo = '+' + formattedTo;
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