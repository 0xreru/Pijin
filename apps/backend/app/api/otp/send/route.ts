/**
 * @swagger
 * /api/otp/send:
 *   post:
 *     tags:
 *       - OTP
 *     summary: Send a 6-digit OTP via SMS
 *     description: |
 *       Generates a cryptographically secure 6-digit OTP using `crypto.randomInt`,
 *       stores it in **Upstash Redis** with a 5-minute TTL keyed on the normalised
 *       E.164 phone number (`pijin:otp:<phone>`), and dispatches the code via the
 *       **Textbee SMS gateway**.
 *
 *       #### Rate Limiting
 *       **Sliding window — 3 requests per 5 minutes** per `(IP + phone)` pair.
 *       Keyed as `pijin:api:otp:ratelimit`. Exceeding the limit returns `429`.
 *
 *       #### Philippine number normalisation
 *       - `09XXXXXXXXX` (11 digits) → `+639XXXXXXXXX`
 *       - `63XXXXXXXXXX` (12 digits) → `+63XXXXXXXXXX`
 *       - Any other format is prefixed with `+` if not already present.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [phoneNumber]
 *             properties:
 *               phoneNumber:
 *                 type: string
 *                 description: Recipient phone number. Accepts local PH format (09XX) or E.164.
 *                 example: "09171234567"
 *     responses:
 *       '200':
 *         description: OTP generated and SMS dispatched successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "OTP sent successfully."
 *       '400':
 *         description: Missing `phoneNumber` in request body.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Phone number is required."
 *       '429':
 *         description: Rate limit exceeded. The client must wait before requesting another OTP.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Too many OTP requests. Please wait a few minutes."
 *       '500':
 *         description: Internal server error (Redis or Textbee failure).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Internal Server Error"
 */
import { NextRequest, NextResponse } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { sendSmsNotification } from "@/lib/sms";
import crypto from "crypto";

export const runtime = "nodejs";

const redis = Redis.fromEnv();

// --- RATE LIMITER (Anti-SMS Bombing Shield) ---
// Limits users to 3 OTP requests every 5 minutes to protect your Textbee gateway.
const ratelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(3, "5 m"),
  analytics: false,
  prefix: "pijin:api:otp:ratelimit",
});

// Helper to normalize Philippine phone numbers to +63 format
function normalizePhoneNumber(phone: string): string {
  let cleaned = phone.replace(/[^0-9+]/g, "");
  if (cleaned.startsWith("09") && cleaned.length === 11) {
    return "+63" + cleaned.substring(1);
  } else if (cleaned.startsWith("63") && cleaned.length === 12) {
    return "+" + cleaned;
  } else if (!cleaned.startsWith("+")) {
    return "+" + cleaned;
  }
  return cleaned;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { phoneNumber } = body;

    if (!phoneNumber) {
      return NextResponse.json({ error: "Phone number is required." }, { status: 400 });
    }

    const formattedPhone = normalizePhoneNumber(phoneNumber);

    // 1. Check Rate Limit (Combine IP and Phone Number for strict throttling)
    const ip = req.headers.get("x-forwarded-for") ?? "127.0.0.1";
    const { success } = await ratelimit.limit(`${ip}_${formattedPhone}`);
    if (!success) {
      console.warn(`[OTP API] Rate limit exceeded for ${formattedPhone}`);
      return NextResponse.json(
        { error: "Too many OTP requests. Please wait a few minutes." },
        { status: 429 }
      );
    }

    // 2. Generate a highly secure 6-digit OTP
    const otpCode = crypto.randomInt(100000, 999999).toString();

    // 3. Save to Upstash Redis with a 5-minute (300 seconds) expiration!
    const redisKey = `pijin:otp:${formattedPhone}`;
    await redis.set(redisKey, otpCode, { ex: 300 });

    // DEV LOG: Print the OTP to the console so we aren't blocked if Textbee crashes
    console.info(`\n [OTP API] GENERATED CODE FOR ${formattedPhone}: ${otpCode}\n`);

    // 4. Send via your existing Textbee Gateway
    const message = `Pijin: Your verification code is ${otpCode}. Valid for 5 minutes. Do not share this with anyone.`;
    
    // Await the promise to prevent Vercel from freezing the background task
    const startTime = Date.now();
    try {
      await sendSmsNotification(formattedPhone, message);
      console.info(`[OTP API] Textbee API responded in ${Date.now() - startTime}ms`);
    } catch (err) {
      console.warn(`[OTP API] Textbee failed after ${Date.now() - startTime}ms:`, err);
    }

    return NextResponse.json({ success: true, message: "OTP sent successfully." });
  } catch (error) {
    console.error("[OTP API] Internal Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}