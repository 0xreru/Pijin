// test-e2e.js
const crypto = require('crypto');

// ---------------------------------------------------------
// 1. CONFIGURATION (Change these to match your setup)
// ---------------------------------------------------------
// Your live Vercel URL
const TARGET_URL = 'https://pijin-api.vercel.app/api/sms/webhook'; 

// Must match your Vercel TEXTBEE_WEBHOOK_SECRET environment variable
const SECRET = 'my-super-secret-password-123'; 

// The 6-part payload: tokenId : sender : receiver : amountBase62 : nonce : signature
// We use fake Base64 data for the nonce and signature for this infrastructure test
const mockSmsPayload = "1:7K2p6I:UCW9EF:6laZE:FakeNonce123:FakeBase64Signature==";

// ---------------------------------------------------------
// 2. EXECUTION
// ---------------------------------------------------------
const body = JSON.stringify({
    text: mockSmsPayload,
    sender: "+639123456789" // The phone number (ignored by our new protocol)
});

const signature = crypto
    .createHmac('sha256', SECRET)
    .update(body, 'utf8')
    .digest('hex');

async function fireWebhook() {
    console.log(`🚀 Firing mock SMS to ${TARGET_URL}...`);
    
    const response = await fetch(TARGET_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-textbee-signature': `sha256=${signature}`
        },
        body: body
    });

    const data = await response.json();
    console.log(`📡 Webhook Response [${response.status}]:`, data);
    console.log(`\n✅ If status is 200 Buffered, QStash has taken over!`);
    console.log(`➡️  Now go check your Vercel Runtime Logs for /api/engine/settle`);
}

fireWebhook();