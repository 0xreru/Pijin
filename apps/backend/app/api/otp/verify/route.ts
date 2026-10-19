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
 *                 verificationToken:
 *                   type: string
 *                   description: |
 *                     30-minute HS256 JWT bound to the verified phone. Pass it to
 *                     `/api/register`. Omitted if `OTP_VERIFICATION_JWT_SECRET` is unset.
 *                 expiresIn:
 *                   type: integer
 *                   example: 1800
 *       '429':
 *         description: 5 incorrect attempts; the code is invalidated and a new one must be requested.
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
import { getRedis } from "@/lib/rate-limit";
import {
  OTP_MAX_ATTEMPTS,
  OTP_TTL_SECONDS,
  VERIFICATION_TOKEN_TTL_SECONDS,
  isOtpTokenRequired,
  normalizePhoneNumber,
  otpMatches,
  signVerificationToken,
} from "@/lib/otp";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const phoneNumber = typeof body?.phoneNumber === "string" ? body.phoneNumber : "";
    const code = typeof body?.code === "string" ? body.code : "";

    if (!phoneNumber || !code) {
      return NextResponse.json(
        { error: "Phone number and code are required." },
        { status: 400 }
      );
    }

    const formattedPhone = normalizePhoneNumber(phoneNumber);
    const redisKey = `pijin:otp:${formattedPhone}`;
    const attemptsKey = `pijin:otp:attempts:${formattedPhone}`;
    const redis = getRedis();

    // 1. Fetch the stored OTP from Upstash Redis
    // Upstash automatically parses numeric strings into actual Numbers!
    const storedOtp = await redis.get<string | number>(redisKey);

    // 2. Validate it
    if (storedOtp === null || storedOtp === undefined) {
      return NextResponse.json(
        { error: "OTP has expired or was never sent. Please request a new one." },
        { status: 400 }
      );
    }

    if (!otpMatches(storedOtp, code)) {
      // Count failures; burn the code once the limit is hit so it can't be brute-forced.
      const attempts = await redis.incr(attemptsKey);
      if (attempts === 1) await redis.expire(attemptsKey, OTP_TTL_SECONDS);
      if (attempts >= OTP_MAX_ATTEMPTS) {
        await redis.del(redisKey, attemptsKey);
        return NextResponse.json(
          { error: "Too many incorrect attempts. Please request a new code." },
          { status: 429 }
        );
      }
      return NextResponse.json(
        { error: "Invalid verification code.", attemptsRemaining: OTP_MAX_ATTEMPTS - attempts },
        { status: 401 }
      );
    }

    // 3. Success! Delete the OTP from Redis so it cannot be used twice (Replay Protection)
    await redis.del(redisKey, attemptsKey);

    const verificationToken = signVerificationToken(formattedPhone);
    if (!verificationToken) {
      if (isOtpTokenRequired()) {
        console.error("[OTP Verify API] OTP_VERIFICATION_JWT_SECRET is not configured");
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
      }
      console.warn("[OTP Verify API] OTP_VERIFICATION_JWT_SECRET missing; no verificationToken issued");
    }

    console.info(`[OTP API] Successfully verified ${formattedPhone}`);

    return NextResponse.json({
      success: true,
      message: "Phone number verified.",
      ...(verificationToken && {
        verificationToken,
        expiresIn: VERIFICATION_TOKEN_TTL_SECONDS,
      }),
    });
  } catch (error) {
    console.error("[OTP Verify API] Internal Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
