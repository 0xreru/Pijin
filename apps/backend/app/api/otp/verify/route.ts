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
    const storedOtp = await redis.get<string>(redisKey);

    // 2. Validate it
    if (!storedOtp) {
      return NextResponse.json(
        { error: "OTP has expired or was never sent. Please request a new one." },
        { status: 400 }
      );
    }

    if (storedOtp !== code.trim()) {
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