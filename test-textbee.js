const TARGET_URL = 'https://pijin-api.vercel.app/api/sms/webhook?secret=my-super-secret-password-123';

async function testTextbee() {
    console.log("Firing exactly what Textbee Cloud sees to Vercel...");
    
    // This is the EXACT payload from your Textbee logs
    const textbeePayload = {
      "_id": "6a53b40e806d9579a8805e9e",
      "user": "6a1119ff9b9db0a6fe1a7d3b",
      "device": {
        "_id": "6a1139a19b9db0a6fe221a42",
        "enabled": true,
        "brand": "POCO",
        "model": "2412DPC0AG"
      },
      "message": "1:jm3JFf:2rKor5:Xpwq8:VpTV7sIJaOmCBeRfCSBWFdzNFO7gXal6W2JOI8G3Le4:uOYaqbHpr3Tf8pxUo0amUVVDWYVUBOUc/R2SRf4onHNmPorAPwXR1Gu3ghVrqTaAQIOI9YYq2Ql8ez8wt+OECQ",
      "encrypted": false,
      "type": "RECEIVED",
      "sender": "+639975598413"
    };

    try {
        const response = await fetch(TARGET_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(textbeePayload)
        });

        const text = await response.text();
        console.log(`\nVercel Response [${response.status}]:`, text);
        console.log(`\nGo check your Vercel Runtime Logs! You should see the 🚨 INCOMING PING 🚨 and then the QStash handoff.`);
    } catch (err) {
        console.error("Simulation failed:", err.message);
    }
}

testTextbee();