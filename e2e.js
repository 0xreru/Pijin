const crypto = require('crypto');
const { Keypair, Address, xdr, nativeToScVal } = require('@stellar/stellar-sdk');

// ---------------------------------------------------------
// 1. CONFIGURATION
// ---------------------------------------------------------
const TARGET_URL = 'https://pijin-api.vercel.app/api/sms/webhook'; 
const SECRET = 'my-super-secret-password-123'; 

// Using your actual DB records
const SENDER_SHORT_ID = "7K2p6I"; // Carl
const RECEIVER_SHORT_ID = "UCW9EF"; // Mark
const TOKEN_ID_STR = "1";
const GATEWAY_PUBKEY = "GDTDK62M4ZJU6QPCEFUSQWOPYED4I4GPHLB4ZZTMBZZL2AO2VK63VQUH"; // From your .env
const TOKEN_CONTRACT_ID = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"; // Testnet XLM

const AMOUNT_PHP = 10; // 10 XLM
const AMOUNT_STROOPS = BigInt(AMOUNT_PHP * 10000000);

// Using Carl's Secret Key (He signs the transaction)
const SENDER_KEYPAIR = Keypair.fromSecret("SC7IAFJLP5UHCZFFZ5U52CITOM5M64STO3QGUB7TLDLM5HXDTHL5QAQ3");

// Using Mark's Public Key (Where the money is going)
const RECEIVER_PUBKEY = "GAIBOSYCM2ELCQYM5SBABR5NJRAW2LDWL32V74W7CHPNP224YHGLCJS5";

// ---------------------------------------------------------
// 2. CRYPTO HELPERS (Mirrors crypto.ts)
// ---------------------------------------------------------
function encodeBase62(num) {
    if (num === 0n) return '0';
    const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    const BASE62 = 62n;
    let result = '';
    let n = num;
    while (n > 0n) {
        result = ALPHABET[Number(n % BASE62)] + result;
        n = n / BASE62;
    }
    return result;
}

function stripBase64Padding(b64) {
    return b64.replace(/=+$/, '');
}

// ---------------------------------------------------------
// 3. GENERATE REAL PAYLOAD
// ---------------------------------------------------------
console.log(`\n=== 🔑 GENERATING XDR CRYPTOGRAPHY ===`);

// a. 32-byte Nonce
const nonce32 = crypto.randomBytes(32);

// b. Build XDR Tuple
const amountScVal = nativeToScVal(AMOUNT_STROOPS, { type: 'i128' });
const tollScVal = nativeToScVal(0n, { type: 'i128' });
const nonceScVal = xdr.ScVal.scvBytes(nonce32);
const receiverScVal = Address.fromString(RECEIVER_PUBKEY).toScVal();
const gatewayScVal = Address.fromString(GATEWAY_PUBKEY).toScVal();
const tokenScVal = Address.fromString(TOKEN_CONTRACT_ID).toScVal();

const xdrTuple = xdr.ScVal.scvVec([
    amountScVal, tollScVal, nonceScVal, receiverScVal, gatewayScVal, tokenScVal
]);

// c. Sign the XDR
const xdrBuffer = xdrTuple.toXDR();
const signatureBytes = SENDER_KEYPAIR.sign(xdrBuffer);

// d. Format for SMS
const amountBase62 = encodeBase62(AMOUNT_STROOPS);
const nonceB64 = stripBase64Padding(nonce32.toString('base64'));
const signatureB64 = stripBase64Padding(signatureBytes.toString('base64'));

const realSmsPayload = `${TOKEN_ID_STR}:${SENDER_SHORT_ID}:${RECEIVER_SHORT_ID}:${amountBase62}:${nonceB64}:${signatureB64}`;

console.log(`✅ Valid Payload Generated!`);
console.log(`\nPayload String:\n${realSmsPayload}\n`);

// ---------------------------------------------------------
// 4. INSTRUCTIONS & EXECUTION
// ---------------------------------------------------------
async function fireWebhook() {
    console.log(`=== 🚀 DIRECT WEBHOOK TEST ===`);
    console.log(`Firing mock SMS to ${TARGET_URL}...`);
    
    // 🔥 ARCHITECT FIX 1: Match the exact JSON structure Textbee uses!
    const reqBody = JSON.stringify({
        event: "MESSAGE_RECEIVED",
        data: {
            message: realSmsPayload,
            sender: "+639975598413" // Represents the physical phone number
        }
    });

    // 🔥 ARCHITECT FIX 2: Textbee does not prepend "sha256=", it just sends the raw hex!
    const hmacSig = crypto.createHmac('sha256', SECRET).update(reqBody, 'utf8').digest('hex');

    try {
        const response = await fetch(TARGET_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                // 🔥 ARCHITECT FIX 3: Use the official header name from their docs!
                'x-signature': hmacSig 
            },
            body: reqBody
        });

        const data = await response.json();
        console.log(`📡 Webhook Response [${response.status}]:`, data);
        console.log(`✅ Check Vercel Logs & Stellar Expert! The payload is in the queue.`);
    } catch (err) {
        console.error(`❌ Webhook Failed:`, err.message);
    }
}

// Automatically fires the webhook when the script runs!
//fireWebhook();