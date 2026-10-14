import 'dotenv/config';
import crypto from 'crypto';

// 1. Configuration
const WEBHOOK_URL = 'https://preview-pijin.vercel.app/api/sms/webhook'; // Update to your exact preview URL if needed
const WEBHOOK_SECRET = process.env.TEXTBEE_WEBHOOK_SECRET;

if (!WEBHOOK_SECRET) {
  throw new Error('Missing TEXTBEE_WEBHOOK_SECRET in your .env file');
}

// 2. The compressed SMS payload
const smsPayload = '';
const mockSenderPhone = '+1234567890'; // Replace with a mock sender phone number

// 3. Construct the Textbee JSON body
const textbeeBody = {
  event: 'MESSAGE_RECEIVED',
  data: {
    sender: mockSenderPhone,
    message: smsPayload,
  },
  sender: mockSenderPhone,
  message: smsPayload,
  device: 'manual-test-script',
};

const rawBody = JSON.stringify(textbeeBody);

// 4. Compute HMAC-SHA256 signature
const hmacSignature = crypto
  .createHmac('sha256', WEBHOOK_SECRET)
  .update(rawBody)
  .digest('hex');

const timestamp = Math.floor(Date.now() / 1000).toString();

// 5. Execute the Request
async function testWebhook() {
  console.log(`🚀 Sending payload to: ${WEBHOOK_URL}`);
  console.log(`🔐 Computed HMAC: ${hmacSignature}`);

  try {
    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-signature': hmacSignature,
        'x-textbee-signature': hmacSignature,
        'x-timestamp': timestamp,
      },
      body: rawBody,
    });

    const responseBody = await response.json().catch(() => null);
    
    console.log(`\nHTTP Status: [${response.status}] ${response.statusText}`);
    console.log('Response Body:', JSON.stringify(responseBody, null, 2));

    if (response.ok && responseBody?.status === 'Buffered') {
      console.log('\nSUCCESS: Webhook accepted the offline voucher and buffered it for settlement!');
    } else {
      console.warn('\nFAILED: Webhook rejected or ignored the payload. Check your Vercel logs.');
    }
  } catch (error) {
    console.error('\nRequest failed:', error);
  }
}

testWebhook();