/**
 * @swagger
 * /api/auth/pin/verify:
 *   post:
 *     tags:
 *       - Users & Accounts
 *     summary: Verify a user's PIN server-side
 *     description: |
 *       Compares the supplied PIN against the stored scrypt hash for the account
 *       registered to `phoneNumber`. The PIN itself is never returned by any endpoint.
 *
 *       #### Lockout
 *       After **5** incorrect attempts the phone is locked for **15 minutes** (`423`).
 *       A correct PIN clears the counter.
 *
 *       Legacy plaintext PINs are accepted once and transparently re-hashed.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [phoneNumber, pin]
 *             properties:
 *               phoneNumber:
 *                 type: string
 *                 example: "+639171234567"
 *               pin:
 *                 type: string
 *                 example: "1234"
 *     responses:
 *       '200':
 *         description: PIN is correct.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *       '400':
 *         description: Missing or malformed `phoneNumber` / `pin`.
 *       '401':
 *         description: Incorrect PIN. Body includes `attemptsRemaining`.
 *       '404':
 *         description: No account (or no PIN) for this phone number.
 *       '423':
 *         description: Locked after too many failures. Body includes `retryAfter` (seconds).
 *       '429':
 *         description: Rate limit exceeded.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPin, isValidPinFormat, verifyPin } from "@/lib/pin";
import { isPlausiblePhone, toDbPhone } from "@/lib/otp";
import { createLimiter, enforceLimit, getClientIp, getRedis } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FAILURES = 5;
const LOCKOUT_SECONDS = 15 * 60;

const ipLimit = createLimiter("pijin:api:pin:verify", 30, "1 m");

export async function POST(req: NextRequest) {
  try {
    const limited = await enforceLimit(ipLimit, getClientIp(req));
    if (limited) return limited;

    const body = await req.json().catch(() => null);
    const phoneNumber = typeof body?.phoneNumber === "string" ? body.phoneNumber : "";
    const pin = typeof body?.pin === "string" ? body.pin.trim() : "";

    if (!phoneNumber || !isPlausiblePhone(phoneNumber) || !isValidPinFormat(pin)) {
      return NextResponse.json({ error: "A valid phone number and PIN are required." }, { status: 400 });
    }

    const dbPhone = toDbPhone(phoneNumber);
    const failKey = `pijin:pin:fail:${dbPhone}`;
    const redis = getRedis();

    const failures = Number((await redis.get<number>(failKey)) ?? 0);
    if (failures >= MAX_FAILURES) {
      const ttl = await redis.ttl(failKey);
      const retryAfter = ttl > 0 ? ttl : LOCKOUT_SECONDS;
      return NextResponse.json(
        { error: "Too many incorrect PIN attempts. Please try again later.", retryAfter },
        { status: 423, headers: { "Retry-After": String(retryAfter) } },
      );
    }

    const account = await prisma.account.findFirst({
      where: { phoneNumber: dbPhone },
      orderBy: { createdAt: "desc" },
      select: { id: true, pin: true },
    });

    if (!account || !account.pin) {
      return NextResponse.json({ error: "Account not found." }, { status: 404 });
    }

    const { ok, needsRehash } = await verifyPin(pin, account.pin);

    if (!ok) {
      const count = await redis.incr(failKey);
      if (count === 1 || count >= MAX_FAILURES) await redis.expire(failKey, LOCKOUT_SECONDS);
      if (count >= MAX_FAILURES) {
        return NextResponse.json(
          { error: "Too many incorrect PIN attempts. Please try again later.", retryAfter: LOCKOUT_SECONDS },
          { status: 423, headers: { "Retry-After": String(LOCKOUT_SECONDS) } },
        );
      }
      return NextResponse.json(
        { error: "Incorrect PIN.", attemptsRemaining: MAX_FAILURES - count },
        { status: 401 },
      );
    }

    await redis.del(failKey);

    if (needsRehash) {
      await prisma.account.update({ where: { id: account.id }, data: { pin: await hashPin(pin) } });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[PIN Verify API]", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
