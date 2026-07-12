const TARGET_URL = 'https://pijin-api.vercel.app/api/sms/webhook?secret=my-super-secret-password-123';

async function testTextbee() {
    console.log("🚀 Firing exactly what Textbee Cloud sees to Vercel...");
    
    // This is the EXACT payload from your Textbee logs
    const textbeePayload = {
      "_id": "6a537b1d806d9579a85f758a",
      "user": "6a1119ff9b9db0a6fe1a7d3b",
      "device": {
        "_id": "6a1139a19b9db0a6fe221a42",
        "enabled": true,
        "brand": "POCO",
        "model": "2412DPC0AG"
      },
      "message": "1:0fDy1v:jm3JFf:A9Nqq:bxjOl3zPeFjv5Gj8S2S7HsRdj6D1Rxi7vmF9kaFozMo:iKqQAtUDPEIpvKY6Lo3SQyQebW9ZXHk6KczV38L88nMMyVlr9D0o2nAbtsZqs6TSJLUdeIhqxBNh6d6HK4j5Cw",
      "encrypted": false,
      "type": "RECEIVED",
      "sender": "+639943440309"
    };

    try {
        const response = await fetch(TARGET_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(textbeePayload)
        });

        const text = await response.text();
        console.log(`\n📡 Vercel Response [${response.status}]:`, text);
        console.log(`\n✅ Go check your Vercel Runtime Logs! You should see the 🚨 INCOMING PING 🚨 and then the QStash handoff.`);
    } catch (err) {
        console.error("❌ Simulation failed:", err.message);
    }
}

testTextbee();