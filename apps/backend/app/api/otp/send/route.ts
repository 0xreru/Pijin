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
 *       '502':
 *         description: SMS delivery failed (`code: "SMS_FAILED"`). No code is stored; the client may resend.
 *       '500':
 *         description: Internal server error.
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
import { deliverSms } from "@/lib/sms";
import { createLimiter, enforceLimit, getClientIp, getRedis } from "@/lib/rate-limit";
import { OTP_TTL_SECONDS, generateOtp, getTestOtpCode, isPlausiblePhone, normalizePhoneNumber } from "@/lib/otp";

export const runtime = "nodejs";

// --- RATE LIMITERS (Anti-SMS Bombing Shield) ---
// 3 per 5 min per (IP + phone), 5 per hour per phone regardless of IP,
// and a global hourly ceiling to protect the TextBee SIM quota.
const ipPhoneLimit = createLimiter("pijin:api:otp:ratelimit", 3, "5 m");
const phoneLimit = createLimiter("pijin:api:otp:phone", 5, "1 h");
const globalLimit = createLimiter(
  "pijin:api:otp:global",
  Number(process.env.OTP_GLOBAL_LIMIT_PER_HOUR ?? 300),
  "1 h",
);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const phoneNumber = typeof body?.phoneNumber === "string" ? body.phoneNumber : "";

    if (!phoneNumber) {
      return NextResponse.json({ error: "Phone number is required." }, { status: 400 });
    }
    if (!isPlausiblePhone(phoneNumber)) {
      return NextResponse.json({ error: "Invalid phone number format." }, { status: 400 });
    }

    const formattedPhone = normalizePhoneNumber(phoneNumber);

    // 1. Check Rate Limits
    const ip = getClientIp(req);
    const limited =
      (await enforceLimit(ipPhoneLimit, `${ip}_${formattedPhone}`)) ??
      (await enforceLimit(phoneLimit, formattedPhone)) ??
      (await enforceLimit(globalLimit, "all"));
    if (limited) {
      console.warn(`[OTP API] Rate limit exceeded for ${formattedPhone}`);
      return NextResponse.json(
        { error: "Too many OTP requests. Please wait a few minutes." },
        { status: 429, headers: limited.headers },
      );
    }

    // 2. Generate a uniform 6-digit OTP (or the fixed tester code when OTP_TEST_MODE is on)
    const testCode = getTestOtpCode(formattedPhone);
    const otpCode = testCode ?? generateOtp();

    // 3. Save to Redis with a 5-minute expiration and reset the attempt counter
    const redis = getRedis();
    await redis.set(`pijin:otp:${formattedPhone}`, otpCode, { ex: OTP_TTL_SECONDS });
    await redis.del(`pijin:otp:attempts:${formattedPhone}`);

    if (testCode) {
      console.warn(`[OTP API] OTP_TEST_MODE: fixed code issued to allow-listed ${formattedPhone}; SMS skipped`);
      return NextResponse.json({ success: true, message: "OTP sent successfully." });
    }

    if (process.env.NODE_ENV !== "production") {
      console.info(`\n [OTP API] GENERATED CODE FOR ${formattedPhone}: ${otpCode}\n`);
    }

    // 4. Send inline (OTP is the priority path; receipts go through the throttled queue).
    // Tight budget keeps the function well under Vercel's 10s limit.
    const message = `Pijin: Your verification code is ${otpCode}. Valid for 5 minutes. Do not share this with anyone.`;
    const startTime = Date.now();
    const result = await deliverSms(formattedPhone, message, { retries: 1, timeoutMs: 4000, deadlineMs: 8000 });

    if (!result.success) {
      console.error(`[OTP API] SMS failed after ${Date.now() - startTime}ms (${result.attempts} attempts): ${result.error}`);
      // Don't leave a code the user never received.
      await redis.del(`pijin:otp:${formattedPhone}`);
      return NextResponse.json(
        { error: "We couldn't send the SMS. Please try again.", code: "SMS_FAILED" },
        { status: 502 },
      );
    }

    console.info(`[OTP API] SMS sent via ${result.gateway} in ${Date.now() - startTime}ms`);
    return NextResponse.json({ success: true, message: "OTP sent successfully." });
  } catch (error) {
    console.error("[OTP API] Internal Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
