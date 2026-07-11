/**
 * @swagger
 * /api/otp/verify:
 *   post:
 *     tags:
 *       - OTP
 *     summary: Verify a 6-digit OTP code
 *     description: |
 *       Fetches the stored OTP from **Upstash Redis** for the given phone number
 *       and compares it (string-safe, handling Upstash's numeric auto-parsing) against
 *       the provided `code`.
 *
 *       On success the OTP is **immediately deleted** from Redis (`DEL key`) to
 *       prevent replay attacks — each code can only be used once.
 *
 *       Returns `400` if the OTP has expired (TTL elapsed) or was never sent.
 *       Returns `401` if the code is present but incorrect.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [phoneNumber, code]
 *             properties:
 *               phoneNumber:
 *                 type: string
 *                 description: The phone number the OTP was sent to. Accepts local PH or E.164 format.
 *                 example: "09171234567"
 *               code:
 *                 type: string
 *                 description: The 6-digit OTP the user entered.
 *                 example: "482931"
 *     responses:
 *       '200':
 *         description: OTP verified successfully. Code is consumed and deleted.
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
 *                   example: "Phone number verified."
 *       '400':
 *         description: Missing fields, or OTP has expired / was never sent.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *               examples:
 *                 - missing: { error: "Phone number and code are required." }
 *                 - expired: { error: "OTP has expired or was never sent. Please request a new one." }
 *       '401':
 *         description: Incorrect OTP code.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Invalid verification code."
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
import { Redis } from "@upstash/redis";

export const runtime = "nodejs";

const redis = Redis.fromEnv();

// Re-use the same normalizer so the Redis keys match perfectly
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
    const { phoneNumber, code } = body;

    if (!phoneNumber || !code) {
      return NextResponse.json(
        { error: "Phone number and code are required." },
        { status: 400 }
      );
    }

    const formattedPhone = normalizePhoneNumber(phoneNumber);
    const redisKey = `pijin:otp:${formattedPhone}`;

    // 1. Fetch the stored OTP from Upstash Redis
    // Upstash automatically parses numeric strings into actual Numbers!
    const storedOtp = await redis.get<string | number>(redisKey);

    // 2. Validate it
    if (!storedOtp) {
      return NextResponse.json(
        { error: "OTP has expired or was never sent. Please request a new one." },
        { status: 400 }
      );
    }

    // 🔥 ARCHITECT FIX: Force `storedOtp` into a string to safely compare with `code.trim()`
    if (String(storedOtp) !== code.trim()) {
      return NextResponse.json(
        { error: "Invalid verification code." },
        { status: 401 }
      );
    }

    // 3. Success! Delete the OTP from Redis so it cannot be used twice (Replay Protection)
    await redis.del(redisKey);

    console.info(`[OTP API] Successfully verified ${formattedPhone}`);

    return NextResponse.json({ success: true, message: "Phone number verified." });
  } catch (error) {
    console.error("[OTP Verify API] Internal Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}