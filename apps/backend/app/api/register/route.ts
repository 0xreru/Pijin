/**
 * @swagger
 * /api/register:
 *   post:
 *     tags:
 *       - Users & Accounts
 *     summary: Register a new Pijin account
 *     description: |
 *       Creates a new `Account` record in the Prisma/Neon database and returns the
 *       created record including the auto-generated **6-character Base62 short ID**
 *       (e.g. `aB3x9Q`) used for offline P2P payments.
 *
 *       The short ID is collision-resistant (62^6 = 56 billion combinations) and is
 *       generated with up to 15 retry attempts before failing.
 *
 *       **Idempotency:** Submitting an already-registered `stellarPublicKey` or phone returns `409 Conflict`.
 *
 *       **Security:** the account is always created with role `USER`; the PIN is
 *       stored as a scrypt hash; requests are rate-limited per IP (30 / 10 min).
 *       When `REQUIRE_OTP_TOKEN=true`, a `verificationToken` from `/api/otp/verify`
 *       bound to `phoneNumber` is mandatory. A supplied token is always validated.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [stellarPublicKey]
 *             properties:
 *               role:
 *                 type: string
 *                 description: Ignored. Public registration always creates a USER account.
 *                 example: USER
 *               verificationToken:
 *                 type: string
 *                 description: Token returned by `/api/otp/verify` for `phoneNumber`.
 *               stellarPublicKey:
 *                 type: string
 *                 pattern: '^G[A-Z2-7]{55}$'
 *                 description: The Stellar Ed25519 public key (G… address) for this account.
 *                 example: "GABC1234...XYZ"
 *               phoneNumber:
 *                 type: string
 *                 description: Phone number (digits only after sanitisation). Used for SMS notifications.
 *                 example: "09171234567"
 *               pin:
 *                 type: string
 *                 description: 4–6 digit PIN. Stored as a scrypt hash, never returned.
 *                 example: "1234"
 *               offlineDeviceKey:
 *                 type: string
 *                 description: Offline device Ed25519 public key used for SMS payment signing.
 *               firstName:
 *                 type: string
 *                 example: "Juan"
 *               lastName:
 *                 type: string
 *                 example: "dela Cruz"
 *               email:
 *                 type: string
 *                 format: email
 *                 example: "juan@pijin.ph"
 *     responses:
 *       '201':
 *         description: Account created successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   description: The created Prisma Account record.
 *                   properties:
 *                     shortId:
 *                       type: string
 *                       example: "aB3x9Q"
 *                     stellarPublicKey:
 *                       type: string
 *                     role:
 *                       type: string
 *                       example: "USER"
 *       '400':
 *         description: Validation error (missing fields, invalid key format, or invalid field values).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *               examples:
 *                 - missingFields: { error: "Missing required field: stellarPublicKey" }
 *                 - fields: { error: "Validation failed", fieldErrors: { email: "Invalid email address." } }
 *                 - badKey: { error: "Invalid Stellar Public Key format" }
 *       '401':
 *         description: Missing, invalid or expired phone `verificationToken`.
 *       '429':
 *         description: Rate limit exceeded (see `Retry-After`).
 *       '409':
 *         description: Stellar public key is already registered.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Stellar Public Key is already registered."
 *       '500':
 *         description: Internal server error or short ID generation failure.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { generateBase62Id } from '@/lib/short-id';
import { hashPin, isValidPinFormat } from "@/lib/pin";
import { isOtpTokenRequired, isPlausiblePhone, toDbPhone, verifyVerificationToken } from "@/lib/otp";
import { createLimiter, enforceLimit, getClientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

const STELLAR_KEY_PATTERN = /^G[A-Z2-7]{55}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NAME_LENGTH = 50;
const MAX_EMAIL_LENGTH = 254;
const MAX_SHORT_ID_ATTEMPTS = 5;

// Generous per-IP budget: testers may share a single venue IP.
const registerLimit = createLimiter("pijin:api:register", 30, "10 m");

type FieldErrors = Record<string, string>;

function optionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isUniqueViolation(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function uniqueTarget(error: Prisma.PrismaClientKnownRequestError): string {
  return JSON.stringify(error.meta ?? {});
}

export async function POST(req: NextRequest) {
  try {
    const limited = await enforceLimit(registerLimit, getClientIp(req));
    if (limited) return limited;

    const body: Record<string, unknown> | null = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const fieldErrors: FieldErrors = {};

    const cleanKey = optionalString(body.stellarPublicKey);
    if (!cleanKey) {
      return NextResponse.json({ error: "Missing required field: stellarPublicKey" }, { status: 400 });
    }
    if (!STELLAR_KEY_PATTERN.test(cleanKey)) {
      return NextResponse.json({ error: "Invalid Stellar Public Key format" }, { status: 400 });
    }

    const cleanOfflineDeviceKey = optionalString(body.offlineDeviceKey);
    if (cleanOfflineDeviceKey && !STELLAR_KEY_PATTERN.test(cleanOfflineDeviceKey)) {
      return NextResponse.json({ error: "Invalid offline device public key format" }, { status: 400 });
    }

    const rawPhone = optionalString(body.phoneNumber);
    if (rawPhone && !isPlausiblePhone(rawPhone)) fieldErrors.phoneNumber = "Invalid phone number.";
    const cleanPhone = rawPhone ? toDbPhone(rawPhone) : null;

    const rawPin = optionalString(body.pin);
    if (rawPin && !isValidPinFormat(rawPin)) fieldErrors.pin = "PIN must be 4 to 6 digits.";

    const cleanFirstName = optionalString(body.firstName);
    if (cleanFirstName && cleanFirstName.length > MAX_NAME_LENGTH) {
      fieldErrors.firstName = `First name must be at most ${MAX_NAME_LENGTH} characters.`;
    }
    const cleanLastName = optionalString(body.lastName);
    if (cleanLastName && cleanLastName.length > MAX_NAME_LENGTH) {
      fieldErrors.lastName = `Last name must be at most ${MAX_NAME_LENGTH} characters.`;
    }
    const cleanEmail = optionalString(body.email)?.toLowerCase() ?? null;
    if (cleanEmail && (cleanEmail.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(cleanEmail))) {
      fieldErrors.email = "Invalid email address.";
    }

    if (Object.keys(fieldErrors).length > 0) {
      return NextResponse.json({ error: "Validation failed", fieldErrors }, { status: 400 });
    }

    // Phone ownership: a token, when present, must match the phone being registered.
    // It is mandatory once REQUIRE_OTP_TOKEN=true (enable after the new APK ships).
    const verificationToken = optionalString(body.verificationToken);
    if (verificationToken || isOtpTokenRequired()) {
      if (!cleanPhone || !verificationToken || !verifyVerificationToken(verificationToken, cleanPhone)) {
        return NextResponse.json(
          { error: "Phone verification required. Please verify your number again." },
          { status: 401 },
        );
      }
    }

    // Public registration always creates USER accounts, whatever the client sends.
    const role = "USER" as const;

    const [existingKey, existingPhone] = await Promise.all([
      prisma.account.findUnique({ where: { stellarPublicKey: cleanKey }, select: { id: true } }),
      cleanPhone
        ? prisma.account.findFirst({ where: { phoneNumber: cleanPhone }, select: { id: true } })
        : null,
    ]);

    if (existingKey) {
      return NextResponse.json({ error: "Stellar Public Key is already registered." }, { status: 409 });
    }
    if (existingPhone) {
      return NextResponse.json({ error: "Phone number is already registered." }, { status: 409 });
    }

    const pinHash = rawPin ? await hashPin(rawPin) : null;

    // Insert directly and retry only on a shortId collision (1 query in the common case).
    for (let attempt = 0; attempt < MAX_SHORT_ID_ATTEMPTS; attempt++) {
      try {
        const created = await prisma.account.create({
          data: {
            shortId: generateBase62Id(),
            role,
            stellarPublicKey: cleanKey,
            offlineDeviceKey: cleanOfflineDeviceKey,
            pin: pinHash,
            phoneNumber: cleanPhone,
            firstName: cleanFirstName,
            lastName: cleanLastName,
            email: cleanEmail,
          },
        });
        // Never echo the PIN hash back to the client.
        const newAccount = { ...created, pin: undefined };
        return NextResponse.json({ success: true, data: newAccount }, { status: 201 });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        const target = uniqueTarget(error);
        if (target.includes("stellar")) {
          return NextResponse.json({ error: "Stellar Public Key is already registered." }, { status: 409 });
        }
        if (!target.includes("short")) throw error;
      }
    }

    return NextResponse.json({ error: "Failed to generate a unique short ID. Please try again." }, { status: 500 });

  } catch (error) {
    console.error("[Register API]", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
