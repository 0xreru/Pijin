import crypto from 'crypto';

// Configuration (Match .env values)
const WEBHOOK_SECRET = process.env.SMS_GATEWAY_WEBHOOK_SECRET || 'your_local_secret';
// NOTE!! If testing locally, we MUST use an ngrok URL so QStash can reach /api/engine/settle route.
const WEBHOOK_URL = 'http://localhost:3000/api/sms/webhook'; 

async function runSimulation() {
  console.log(`Simulating Textbee Webhook to: ${WEBHOOK_URL}`);

  // Craft a standard Base62/Base64 Pijin offline voucher payload
  // Format: AMOUNT:TOLL:NONCE:RECEIVER:GATEWAY:TOKEN:SIGNATURE
  const mockSmsBody = "10000000:5000000:mockNonceBase64=:aB3x9Q:mockGateway:mockToken:mockSignatureBase64=";
  const mockSender = "+639171234567";

  // Construct the exact JSON Textbee sends
  const payload = {
    message: mockSmsBody,
    sender: mockSender,
    device: process.env.TEXTBEE_DEVICE_ID || 'demo-device-id',
  };

  const rawBody = JSON.stringify(payload);

  // Generate the HMAC-SHA256 Signature
  const signature = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');

  // Fire the request with the optional timestamp to trigger the drift check
  const timestamp = Math.floor(Date.now() / 1000).toString();

  try {
    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-textbee-signature': signature,
        'x-timestamp': timestamp,
      },
      body: rawBody,
    });

    const result = await response.json().catch(() => null);
    
    console.log(`\n Webhook Response: \({response.status}\){response.statusText}`);
    console.log('Body:', result);

    if (response.ok) {
      console.log(`\nSuccess! The webhook accepted the HMAC and published to QStash.`);
      console.log(`Check Upstash QStash dashboard to watch it hit /api/engine/settle!`);
    } else {
      console.log(`\nFailed. The webhook rejected the payload.`);
    }
  } catch (error) {
    console.error(`\nNetwork Error:`, error);
  }
}

runSimulation();