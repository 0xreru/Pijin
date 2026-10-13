/**
 * @file lib/otp.ts
 *
 * OTP generation/comparison, phone normalisation and the short-lived
 * phone-verification token that `/api/otp/verify` issues and `/api/register`
 * consumes.
 */

import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { constantTimeEqual } from "./pin";

export const OTP_TTL_SECONDS = 300;
export const OTP_MAX_ATTEMPTS = 5;
// Covers the post-OTP steps (name, PIN, seed-phrase backup) before /api/register.
export const VERIFICATION_TOKEN_TTL_SECONDS = 30 * 60;

const TOKEN_ISSUER = "pijin-otp";
const TOKEN_PURPOSE = "phone-verification";

/** Normalises a phone number to E.164 (PH local formats → +63). */
export function normalizePhoneNumber(phone: string): string {
  const cleaned = phone.replace(/[^0-9+]/g, "");
  if (cleaned.startsWith("09") && cleaned.length === 11) {
    return "+63" + cleaned.substring(1);
  } else if (cleaned.startsWith("63") && cleaned.length === 12) {
    return "+" + cleaned;
  } else if (!cleaned.startsWith("+")) {
    return "+" + cleaned;
  }
  return cleaned;
}

/** The digits-only form stored in `Account.phoneNumber`. */
export function toDbPhone(phone: string): string {
  return normalizePhoneNumber(phone).replace(/\D/g, "");
}

/** E.164 allows at most 15 digits; 8 is a safe lower bound. */
export function isPlausiblePhone(phone: string): boolean {
  const digits = toDbPhone(phone);
  return digits.length >= 8 && digits.length <= 15;
}

/** Uniform 6-digit code, zero-padded (000000–999999). */
export function generateOtp(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function otpMatches(stored: string | number, provided: string): boolean {
  // Upstash auto-parses numeric strings, which drops leading zeros.
  const expected = String(stored).padStart(6, "0");
  return constantTimeEqual(expected, provided.trim());
}

/**
 * Tester fallback for SMS outages: when OTP_TEST_MODE=true, allow-listed numbers
 * (OTP_TEST_NUMBERS, comma-separated, any format) receive the fixed OTP_TEST_CODE
 * and no SMS is sent. Off by default; returns null unless every setting is valid.
 */
export function getTestOtpCode(phone: string, env: Record<string, string | undefined> = process.env): string | null {
  if (env.OTP_TEST_MODE !== "true") return null;
  const code = env.OTP_TEST_CODE?.trim() ?? "";
  if (!/^\d{6}$/.test(code)) return null;
  const allowList = (env.OTP_TEST_NUMBERS ?? "")
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean)
    .map(toDbPhone);
  return allowList.includes(toDbPhone(phone)) ? code : null;
}

function getTokenSecret(): string | null {
  return process.env.OTP_VERIFICATION_JWT_SECRET || null;
}

export function isOtpTokenRequired(): boolean {
  return process.env.REQUIRE_OTP_TOKEN === "true";
}

/** Returns null when no signing secret is configured. */
export function signVerificationToken(phone: string): string | null {
  const secret = getTokenSecret();
  if (!secret) return null;
  return jwt.sign({ purpose: TOKEN_PURPOSE }, secret, {
    algorithm: "HS256",
    subject: toDbPhone(phone),
    issuer: TOKEN_ISSUER,
    expiresIn: VERIFICATION_TOKEN_TTL_SECONDS,
  });
}

/** True only if the token is valid, unexpired and bound to `phone`. */
export function verifyVerificationToken(token: string, phone: string): boolean {
  const secret = getTokenSecret();
  if (!secret) return false;
  try {
    const payload = jwt.verify(token, secret, {
      algorithms: ["HS256"],
      issuer: TOKEN_ISSUER,
    }) as jwt.JwtPayload;
    return payload.purpose === TOKEN_PURPOSE && payload.sub === toDbPhone(phone);
  } catch {
    return false;
  }
}
