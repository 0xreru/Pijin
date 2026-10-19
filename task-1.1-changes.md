# Task 1.1 – Secure the Sign-Up Process: Change Review

> Branch: `rixdev` · Status: **uncommitted** · Source plan: [test-50users-plan.md](test-50users-plan.md) §1.1
>
> Verification: backend `npm test` 81/81 pass (10 new) · backend `tsc --noEmit` clean · eslint clean on changed files · mobile `tsc`: no errors in changed files (pre-existing `Ionicons` / other errors untouched).
> **Not yet run:** live endpoints against Redis/DB, or the flow on a device.

---

## 1. Summary

| ID | Change | Status |
|----|--------|--------|
| B1 | `/api/users/check` no longer returns `pin` (and never selects it) | ✅ |
| B2 | New `POST /api/auth/pin/verify` – server-side PIN check, 5 failures → 15-min lock (`423`) | ✅ |
| B3 | PINs hashed with Node `crypto.scrypt`; legacy plaintext accepted once and re-hashed on use | ✅ |
| B4 | Settlement receipt SMS no longer contains the PIN | ✅ |
| B5 | OTP: uniform `000000–999999`, constant-time compare, 5-attempt burn, no prod log, first-hop IP, per-phone + global limits | ✅ |
| B6 | `/api/otp/verify` returns a 30-min phone-bound `verificationToken` | ✅ |
| B7 | `/api/register`: role forced to `USER`, field validation, rate limit, phone-dup `409`, token check, single-insert shortId | ✅ |
| B8 | Rate limits on `/users/check`, `/users/lookup`, `/friendbot` | ✅ |
| M1 | Mobile SignIn uses server PIN verify instead of fetching the PIN | ✅ |
| M2 | Mobile Onboarding stores `verificationToken` and sends it to `/register` | ✅ |

**Deferred (by decision):** `@unique` on `Account.phoneNumber` migration, Zod, resumable onboarding, 6-digit PIN / biometrics.

---

## 2. Files Changed

### New files

| File | Purpose |
|------|---------|
| [apps/backend/lib/pin.ts](apps/backend/lib/pin.ts) | `hashPin`, `verifyPin` (legacy-aware), `isValidPinFormat` (4–6 digits), `constantTimeEqual` |
| [apps/backend/lib/otp.ts](apps/backend/lib/otp.ts) | `normalizePhoneNumber`, `toDbPhone`, `isPlausiblePhone`, `generateOtp`, `otpMatches`, `signVerificationToken`, `verifyVerificationToken`, `isOtpTokenRequired` |
| [apps/backend/lib/rate-limit.ts](apps/backend/lib/rate-limit.ts) | Shared Redis client, `createLimiter`, `getClientIp` (first `x-forwarded-for` hop), `enforceLimit` (429 + `Retry-After`) |
| [apps/backend/app/api/auth/pin/verify/route.ts](apps/backend/app/api/auth/pin/verify/route.ts) | New PIN verification endpoint |
| [apps/backend/lib/signup-security.test.ts](apps/backend/lib/signup-security.test.ts) | 10 unit tests for the helpers above |

### Modified files

| File | What changed |
|------|--------------|
| [apps/backend/app/api/otp/send/route.ts](apps/backend/app/api/otp/send/route.ts) | Uses shared helpers; phone format check; 3 limiters (IP+phone 3/5m, phone 5/1h, global `OTP_GLOBAL_LIMIT_PER_HOUR`/1h); resets attempt counter; OTP log only when `NODE_ENV !== "production"`. SMS sending itself unchanged (that's task 1.2). |
| [apps/backend/app/api/otp/verify/route.ts](apps/backend/app/api/otp/verify/route.ts) | Constant-time compare (zero-pad safe); attempt counter → 5th failure deletes code + `429`; `401` includes `attemptsRemaining`; issues `verificationToken` + `expiresIn`; Swagger updated. |
| [apps/backend/app/api/register/route.ts](apps/backend/app/api/register/route.ts) | Rewritten handler (see §3). Swagger updated. |
| [apps/backend/app/api/users/check/route.ts](apps/backend/app/api/users/check/route.ts) | `select: { stellarPublicKey, shortId }` only; `pin` removed from response; 60/min per IP. |
| [apps/backend/app/api/users/lookup/route.ts](apps/backend/app/api/users/lookup/route.ts) | 300/min per IP (high because the current app does one lookup per offline row). |
| [apps/backend/app/api/friendbot/route.ts](apps/backend/app/api/friendbot/route.ts) | 20/min per IP + 3/hour per public key. |
| [apps/backend/lib/settlement.ts](apps/backend/lib/settlement.ts) | Receipt is now `SUCCESS: Received X stroops.` (PIN removed). Verified nothing parses the old `PIN:` suffix. |
| [apps/backend/.env.example](apps/backend/.env.example) | Added `OTP_VERIFICATION_JWT_SECRET`, `REQUIRE_OTP_TOKEN=false`, `OTP_GLOBAL_LIMIT_PER_HOUR=300`. |
| [apps/mobile/src/services/api/accounts.ts](apps/mobile/src/services/api/accounts.ts) | Removed `pin` from response types; `registerAccount` accepts `verificationToken`; new `verifyPinWithServer(phone, pin)`. |
| [apps/mobile/src/screens/SignInScreen.tsx](apps/mobile/src/screens/SignInScreen.tsx) | Tier-3 fallback now calls `verifyPinWithServer`; on success saves PIN locally; handles `401` (shake), `423` (locked, minutes), `429`, `404`, network. |
| [apps/mobile/src/screens/OnboardingScreen.tsx](apps/mobile/src/screens/OnboardingScreen.tsx) | `verificationTokenRef` set from `/otp/verify`, sent to `/register`; `401` → "Verify your number again" → step 2; `429` → friendly alert. |

---

## 3. Behaviour Details

### `/api/register` (new flow)
1. Per-IP rate limit: 30 / 10 min → `429` + `Retry-After`.
2. Validate: `stellarPublicKey` (required, `G…` 56 chars), `offlineDeviceKey`, phone (8–15 digits), PIN (4–6 digits), first/last name ≤ 50, email format ≤ 254 (lower-cased). Field errors → `400 { error: "Validation failed", fieldErrors }`.
3. Token: if `verificationToken` is sent **or** `REQUIRE_OTP_TOKEN=true`, it must be valid, unexpired and match the phone → else `401`.
4. `role` from the client is ignored; always `USER`.
5. `409` if public key **or phone** already registered.
6. PIN stored as `scrypt$16384$8$1$<salt>$<hash>`.
7. Single `create`; retries only on shortId unique collision (max 5).
8. Response no longer includes `pin`.

### `POST /api/auth/pin/verify`
- Body: `{ phoneNumber, pin }`
- `200 { success: true }` · `400` bad input · `401 { attemptsRemaining }` · `404` no account/PIN · `423 { retryAfter }` locked · `429` IP limit (30/min).
- Failure counter in Redis `pijin:pin:fail:<digits>`, TTL 15 min; cleared on success.
- Legacy plaintext PIN → compared, then re-hashed in DB.

### Verification token
- HS256, secret `OTP_VERIFICATION_JWT_SECRET`, issuer `pijin-otp`, `sub` = digits-only phone, `purpose: "phone-verification"`, **30 min** TTL.
- If the secret is unset: no token is issued (warning logged) unless `REQUIRE_OTP_TOKEN=true`, in which case verify returns `500`.

### OTP Redis keys
- `pijin:otp:<E164>` – code (5 min)
- `pijin:otp:attempts:<E164>` – failed attempts (5 min), reset on every send

---

## 4. Deviations from the Plan (please review)

| Plan said | Done | Why |
|-----------|------|-----|
| Token TTL 10 min | **30 min** | After OTP the user still enters name, PIN and backs up 12 words; 10 min would bounce slow users. |
| Gradual rollout: remove `pin` from `/users/check` last | **Removed now** | Plaintext PIN leak is critical, and stored PINs become hashes anyway. Old APK impact: only the "PIN not stored on device" sign-in fallback breaks until users update. |
| Zod validation | Manual validation | Zod isn't a dependency; avoided adding one. |

---

## 5. Rollout Steps

1. **Vercel env:** set `OTP_VERIFICATION_JWT_SECRET` (new random value, separate from SEP-10/SEP-24 secrets); keep `REQUIRE_OTP_TOKEN=false`; optionally `OTP_GLOBAL_LIMIT_PER_HOUR`.
2. Deploy backend.
3. Build and distribute the new APK.
4. When all testers have the new APK → set `REQUIRE_OTP_TOKEN=true`.

---

## 6. Known Risks / Follow-ups

- **Shared venue IP:** all limits are per IP; 50 testers on one Wi-Fi share one IP. Limits are generous but should be validated in the load test.
- **Lockout abuse:** anyone who knows a phone number can trigger that user's 15-min PIN lock.
- **Legacy PINs:** existing plaintext PINs stay plaintext until each is verified server-side. A one-off hashing script is proposed but **not written** (needs approval).
- **Enumeration:** `/users/check` still reveals whether a phone is registered plus its public key.
- **Token not single-use:** valid for 30 min; mitigated by the new phone-duplicate `409`.
- **Phone uniqueness** is enforced in code only; DB `@unique` migration deferred until duplicates are checked.

---

## 7. Test Checklist (manual, on staging)

- [ ] `GET /api/users/check?phone=…` → no `pin` field
- [ ] New sign-up end to end with the new APK → account row has `scrypt$…` PIN, role `USER`
- [ ] `/register` with `role: "ADMIN"` → created as `USER`
- [ ] `/register` with a forged/expired token → `401`; with `REQUIRE_OTP_TOKEN=true` and no token → `401`
- [ ] OTP: 5 wrong codes → `429`, code no longer works
- [ ] OTP not visible in production logs
- [ ] PIN verify: 5 wrong → `423`; correct after lock expires → `200`
- [ ] Legacy plaintext account: sign in via server verify → row re-hashed
- [ ] Settlement receipt SMS has no PIN
- [ ] Old APK: sign-up and normal sign-in still work while `REQUIRE_OTP_TOKEN=false`

---

## Appendix: Full Diff

<details><summary>Modified files</summary>

```diff
diff --git a/apps/backend/.env.example b/apps/backend/.env.example
index 2d6fbf2..4a3acba 100644
--- a/apps/backend/.env.example
+++ b/apps/backend/.env.example
@@ -81,6 +81,16 @@ QSTASH_NEXT_SIGNING_KEY="sig_..."
 UPSTASH_REDIS_REST_URL="https://your-redis-instance.upstash.io"
 UPSTASH_REDIS_REST_TOKEN="your-redis-token"
 
+# ==============================================================================
+# Sign-up Security (OTP verification token)
+# ==============================================================================
+# HS256 secret for the 30-minute phone-verification token issued by /api/otp/verify.
+OTP_VERIFICATION_JWT_SECRET="your-separate-otp-jwt-secret"
+# Set to "true" only after the APK that sends verificationToken is installed by all testers.
+REQUIRE_OTP_TOKEN=false
+# Global cap on OTP SMS per hour (protects the TextBee SIM quota).
+OTP_GLOBAL_LIMIT_PER_HOUR=300
+
 # ==============================================================================
 # SEP-10: Stellar Web Authentication
 # ==============================================================================
diff --git a/apps/backend/app/api/friendbot/route.ts b/apps/backend/app/api/friendbot/route.ts
index 42607a2..cafdd30 100644
--- a/apps/backend/app/api/friendbot/route.ts
+++ b/apps/backend/app/api/friendbot/route.ts
@@ -1,10 +1,14 @@
 import { StrKey } from "@stellar/stellar-sdk";
 import { NextRequest, NextResponse } from "next/server";
+import { createLimiter, enforceLimit, getClientIp } from "@/lib/rate-limit";
 
 export const runtime = "nodejs";
 
 const FRIENDBOT_URL = "https://friendbot.stellar.org";
 
+const ipLimit = createLimiter("pijin:api:friendbot:ip", 20, "1 m");
+const keyLimit = createLimiter("pijin:api:friendbot:key", 3, "1 h");
+
 export async function POST(req: NextRequest) {
   try {
     const body = await req.json().catch(() => null);
@@ -18,6 +22,11 @@ export async function POST(req: NextRequest) {
       return NextResponse.json({ error: "Invalid Stellar public key." }, { status: 400 });
     }
 
+    const limited =
+      (await enforceLimit(ipLimit, getClientIp(req))) ??
+      (await enforceLimit(keyLimit, publicKey));
+    if (limited) return limited;
+
     const response = await fetch(`${FRIENDBOT_URL}?addr=${encodeURIComponent(publicKey)}`, {
       method: "GET",
       cache: "no-store",
diff --git a/apps/backend/app/api/otp/send/route.ts b/apps/backend/app/api/otp/send/route.ts
index 3837309..d598664 100644
--- a/apps/backend/app/api/otp/send/route.ts
+++ b/apps/backend/app/api/otp/send/route.ts
@@ -77,72 +77,66 @@
  *                   example: "Internal Server Error"
  */
 import { NextRequest, NextResponse } from "next/server";
-import { Ratelimit } from "@upstash/ratelimit";
-import { Redis } from "@upstash/redis";
 import { sendSmsNotification } from "@/lib/sms";
-import crypto from "crypto";
+import { createLimiter, enforceLimit, getClientIp, getRedis } from "@/lib/rate-limit";
+import { OTP_TTL_SECONDS, generateOtp, isPlausiblePhone, normalizePhoneNumber } from "@/lib/otp";
 
 export const runtime = "nodejs";
 
-const redis = Redis.fromEnv();
-
-// --- RATE LIMITER (Anti-SMS Bombing Shield) ---
-// Limits users to 3 OTP requests every 5 minutes to protect your Textbee gateway.
-const ratelimit = new Ratelimit({
-  redis,
-  limiter: Ratelimit.slidingWindow(3, "5 m"),
-  analytics: false,
-  prefix: "pijin:api:otp:ratelimit",
-});
-
-// Helper to normalize Philippine phone numbers to +63 format
-function normalizePhoneNumber(phone: string): string {
-  let cleaned = phone.replace(/[^0-9+]/g, "");
-  if (cleaned.startsWith("09") && cleaned.length === 11) {
-    return "+63" + cleaned.substring(1);
-  } else if (cleaned.startsWith("63") && cleaned.length === 12) {
-    return "+" + cleaned;
-  } else if (!cleaned.startsWith("+")) {
-    return "+" + cleaned;
-  }
-  return cleaned;
-}
+// --- RATE LIMITERS (Anti-SMS Bombing Shield) ---
+// 3 per 5 min per (IP + phone), 5 per hour per phone regardless of IP,
+// and a global hourly ceiling to protect the TextBee SIM quota.
+const ipPhoneLimit = createLimiter("pijin:api:otp:ratelimit", 3, "5 m");
+const phoneLimit = createLimiter("pijin:api:otp:phone", 5, "1 h");
+const globalLimit = createLimiter(
+  "pijin:api:otp:global",
+  Number(process.env.OTP_GLOBAL_LIMIT_PER_HOUR ?? 300),
+  "1 h",
+);
 
 export async function POST(req: NextRequest) {
   try {
-    const body = await req.json();
-    const { phoneNumber } = body;
+    const body = await req.json().catch(() => null);
+    const phoneNumber = typeof body?.phoneNumber === "string" ? body.phoneNumber : "";
 
     if (!phoneNumber) {
       return NextResponse.json({ error: "Phone number is required." }, { status: 400 });
     }
+    if (!isPlausiblePhone(phoneNumber)) {
+      return NextResponse.json({ error: "Invalid phone number format." }, { status: 400 });
+    }
 
     const formattedPhone = normalizePhoneNumber(phoneNumber);
 
-    // 1. Check Rate Limit (Combine IP and Phone Number for strict throttling)
-    const ip = req.headers.get("x-forwarded-for") ?? "127.0.0.1";
-    const { success } = await ratelimit.limit(`${ip}_${formattedPhone}`);
-    if (!success) {
+    // 1. Check Rate Limits
+    const ip = getClientIp(req);
+    const limited =
+      (await enforceLimit(ipPhoneLimit, `${ip}_${formattedPhone}`)) ??
+      (await enforceLimit(phoneLimit, formattedPhone)) ??
+      (await enforceLimit(globalLimit, "all"));
+    if (limited) {
       console.warn(`[OTP API] Rate limit exceeded for ${formattedPhone}`);
       return NextResponse.json(
         { error: "Too many OTP requests. Please wait a few minutes." },
-        { status: 429 }
+        { status: 429, headers: limited.headers },
       );
     }
 
-    // 2. Generate a highly secure 6-digit OTP
-    const otpCode = crypto.randomInt(100000, 999999).toString();
+    // 2. Generate a uniform 6-digit OTP
+    const otpCode = generateOtp();
 
-    // 3. Save to Upstash Redis with a 5-minute (300 seconds) expiration!
-    const redisKey = `pijin:otp:${formattedPhone}`;
-    await redis.set(redisKey, otpCode, { ex: 300 });
+    // 3. Save to Redis with a 5-minute expiration and reset the attempt counter
+    const redis = getRedis();
+    await redis.set(`pijin:otp:${formattedPhone}`, otpCode, { ex: OTP_TTL_SECONDS });
+    await redis.del(`pijin:otp:attempts:${formattedPhone}`);
 
-    // DEV LOG: Print the OTP to the console so we aren't blocked if Textbee crashes
-    console.info(`\n [OTP API] GENERATED CODE FOR ${formattedPhone}: ${otpCode}\n`);
+    if (process.env.NODE_ENV !== "production") {
+      console.info(`\n [OTP API] GENERATED CODE FOR ${formattedPhone}: ${otpCode}\n`);
+    }
 
     // 4. Send via your existing Textbee Gateway
     const message = `Pijin: Your verification code is ${otpCode}. Valid for 5 minutes. Do not share this with anyone.`;
-    
+
     // Await the promise to prevent Vercel from freezing the background task
     const startTime = Date.now();
     try {
diff --git a/apps/backend/app/api/otp/verify/route.ts b/apps/backend/app/api/otp/verify/route.ts
index f09105c..96b09c4 100644
--- a/apps/backend/app/api/otp/verify/route.ts
+++ b/apps/backend/app/api/otp/verify/route.ts
@@ -45,6 +45,16 @@
  *                 message:
  *                   type: string
  *                   example: "Phone number verified."
+ *                 verificationToken:
+ *                   type: string
+ *                   description: |
+ *                     30-minute HS256 JWT bound to the verified phone. Pass it to
+ *                     `/api/register`. Omitted if `OTP_VERIFICATION_JWT_SECRET` is unset.
+ *                 expiresIn:
+ *                   type: integer
+ *                   example: 1800
+ *       '429':
+ *         description: 5 incorrect attempts; the code is invalidated and a new one must be requested.
  *       '400':
  *         description: Missing fields, or OTP has expired / was never sent.
  *         content:
@@ -79,29 +89,24 @@
  *                   example: "Internal Server Error"
  */
 import { NextRequest, NextResponse } from "next/server";
-import { Redis } from "@upstash/redis";
+import { getRedis } from "@/lib/rate-limit";
+import {
+  OTP_MAX_ATTEMPTS,
+  OTP_TTL_SECONDS,
+  VERIFICATION_TOKEN_TTL_SECONDS,
+  isOtpTokenRequired,
+  normalizePhoneNumber,
+  otpMatches,
+  signVerificationToken,
+} from "@/lib/otp";
 
 export const runtime = "nodejs";
 
-const redis = Redis.fromEnv();
-
-// Re-use the same normalizer so the Redis keys match perfectly
-function normalizePhoneNumber(phone: string): string {
-  let cleaned = phone.replace(/[^0-9+]/g, "");
-  if (cleaned.startsWith("09") && cleaned.length === 11) {
-    return "+63" + cleaned.substring(1);
-  } else if (cleaned.startsWith("63") && cleaned.length === 12) {
-    return "+" + cleaned;
-  } else if (!cleaned.startsWith("+")) {
-    return "+" + cleaned;
-  }
-  return cleaned;
-}
-
 export async function POST(req: NextRequest) {
   try {
-    const body = await req.json();
-    const { phoneNumber, code } = body;
+    const body = await req.json().catch(() => null);
+    const phoneNumber = typeof body?.phoneNumber === "string" ? body.phoneNumber : "";
+    const code = typeof body?.code === "string" ? body.code : "";
 
     if (!phoneNumber || !code) {
       return NextResponse.json(
@@ -112,33 +117,60 @@ export async function POST(req: NextRequest) {
 
     const formattedPhone = normalizePhoneNumber(phoneNumber);
     const redisKey = `pijin:otp:${formattedPhone}`;
+    const attemptsKey = `pijin:otp:attempts:${formattedPhone}`;
+    const redis = getRedis();
 
     // 1. Fetch the stored OTP from Upstash Redis
     // Upstash automatically parses numeric strings into actual Numbers!
     const storedOtp = await redis.get<string | number>(redisKey);
 
     // 2. Validate it
-    if (!storedOtp) {
+    if (storedOtp === null || storedOtp === undefined) {
       return NextResponse.json(
         { error: "OTP has expired or was never sent. Please request a new one." },
         { status: 400 }
       );
     }
 
-    // 🔥 ARCHITECT FIX: Force `storedOtp` into a string to safely compare with `code.trim()`
-    if (String(storedOtp) !== code.trim()) {
+    if (!otpMatches(storedOtp, code)) {
+      // Count failures; burn the code once the limit is hit so it can't be brute-forced.
+      const attempts = await redis.incr(attemptsKey);
+      if (attempts === 1) await redis.expire(attemptsKey, OTP_TTL_SECONDS);
+      if (attempts >= OTP_MAX_ATTEMPTS) {
+        await redis.del(redisKey, attemptsKey);
+        return NextResponse.json(
+          { error: "Too many incorrect attempts. Please request a new code." },
+          { status: 429 }
+        );
+      }
       return NextResponse.json(
-        { error: "Invalid verification code." },
+        { error: "Invalid verification code.", attemptsRemaining: OTP_MAX_ATTEMPTS - attempts },
         { status: 401 }
       );
     }
 
     // 3. Success! Delete the OTP from Redis so it cannot be used twice (Replay Protection)
-    await redis.del(redisKey);
+    await redis.del(redisKey, attemptsKey);
+
+    const verificationToken = signVerificationToken(formattedPhone);
+    if (!verificationToken) {
+      if (isOtpTokenRequired()) {
+        console.error("[OTP Verify API] OTP_VERIFICATION_JWT_SECRET is not configured");
+        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
+      }
+      console.warn("[OTP Verify API] OTP_VERIFICATION_JWT_SECRET missing; no verificationToken issued");
+    }
 
     console.info(`[OTP API] Successfully verified ${formattedPhone}`);
 
-    return NextResponse.json({ success: true, message: "Phone number verified." });
+    return NextResponse.json({
+      success: true,
+      message: "Phone number verified.",
+      ...(verificationToken && {
+        verificationToken,
+        expiresIn: VERIFICATION_TOKEN_TTL_SECONDS,
+      }),
+    });
   } catch (error) {
     console.error("[OTP Verify API] Internal Error:", error);
     return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
diff --git a/apps/backend/app/api/register/route.ts b/apps/backend/app/api/register/route.ts
index 2c7b1d4..d59e74b 100644
--- a/apps/backend/app/api/register/route.ts
+++ b/apps/backend/app/api/register/route.ts
@@ -13,20 +13,27 @@
  *       The short ID is collision-resistant (62^6 = 56 billion combinations) and is
  *       generated with up to 15 retry attempts before failing.
  *
- *       **Idempotency:** Submitting the same `stellarPublicKey` twice returns `409 Conflict`.
+ *       **Idempotency:** Submitting an already-registered `stellarPublicKey` or phone returns `409 Conflict`.
+ *
+ *       **Security:** the account is always created with role `USER`; the PIN is
+ *       stored as a scrypt hash; requests are rate-limited per IP (30 / 10 min).
+ *       When `REQUIRE_OTP_TOKEN=true`, a `verificationToken` from `/api/otp/verify`
+ *       bound to `phoneNumber` is mandatory. A supplied token is always validated.
  *     requestBody:
  *       required: true
  *       content:
  *         application/json:
  *           schema:
  *             type: object
- *             required: [role, stellarPublicKey]
+ *             required: [stellarPublicKey]
  *             properties:
  *               role:
  *                 type: string
- *                 enum: [USER, ADMIN]
- *                 description: Account role (case-insensitive).
+ *                 description: Ignored. Public registration always creates a USER account.
  *                 example: USER
+ *               verificationToken:
+ *                 type: string
+ *                 description: Token returned by `/api/otp/verify` for `phoneNumber`.
  *               stellarPublicKey:
  *                 type: string
  *                 pattern: '^G[A-Z2-7]{55}$'
@@ -38,8 +45,8 @@
  *                 example: "09171234567"
  *               pin:
  *                 type: string
- *                 description: User PIN (stored as-is; hash before storing in production).
- *                 example: "123456"
+ *                 description: 4–6 digit PIN. Stored as a scrypt hash, never returned.
+ *                 example: "1234"
  *               offlineDeviceKey:
  *                 type: string
  *                 description: Offline device Ed25519 public key used for SMS payment signing.
@@ -77,7 +84,7 @@
  *                       type: string
  *                       example: "USER"
  *       '400':
- *         description: Validation error (missing fields, invalid key format, or bad role).
+ *         description: Validation error (missing fields, invalid key format, or invalid field values).
  *         content:
  *           application/json:
  *             schema:
@@ -86,9 +93,13 @@
  *                 error:
  *                   type: string
  *               examples:
- *                 - missingFields: { error: "Missing required fields: role and stellarPublicKey" }
- *                 - badRole: { error: "Role must be either 'USER' or 'ADMIN'" }
+ *                 - missingFields: { error: "Missing required field: stellarPublicKey" }
+ *                 - fields: { error: "Validation failed", fieldErrors: { email: "Invalid email address." } }
  *                 - badKey: { error: "Invalid Stellar Public Key format" }
+ *       '401':
+ *         description: Missing, invalid or expired phone `verificationToken`.
+ *       '429':
+ *         description: Rate limit exceeded (see `Retry-After`).
  *       '409':
  *         description: Stellar public key is already registered.
  *         content:
@@ -110,88 +121,150 @@
  *                   type: string
  */
 import { NextRequest, NextResponse } from "next/server";
+import { Prisma } from "@prisma/client";
 import { prisma } from "@/lib/prisma";
 import { generateBase62Id } from '@/lib/short-id';
+import { hashPin, isValidPinFormat } from "@/lib/pin";
+import { isOtpTokenRequired, isPlausiblePhone, toDbPhone, verifyVerificationToken } from "@/lib/otp";
+import { createLimiter, enforceLimit, getClientIp } from "@/lib/rate-limit";
+
+export const runtime = "nodejs";
+
+const STELLAR_KEY_PATTERN = /^G[A-Z2-7]{55}$/;
+const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
+const MAX_NAME_LENGTH = 50;
+const MAX_EMAIL_LENGTH = 254;
+const MAX_SHORT_ID_ATTEMPTS = 5;
+
+// Generous per-IP budget: testers may share a single venue IP.
+const registerLimit = createLimiter("pijin:api:register", 30, "10 m");
+
+type FieldErrors = Record<string, string>;
+
+function optionalString(value: unknown): string | null {
+  if (typeof value !== "string") return null;
+  const trimmed = value.trim();
+  return trimmed.length > 0 ? trimmed : null;
+}
+
+function isUniqueViolation(error: unknown): error is Prisma.PrismaClientKnownRequestError {
+  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
+}
+
+function uniqueTarget(error: Prisma.PrismaClientKnownRequestError): string {
+  return JSON.stringify(error.meta ?? {});
+}
 
 export async function POST(req: NextRequest) {
   try {
-    let body: any;
-    try {
-      body = await req.json();
-    } catch (error) {
+    const limited = await enforceLimit(registerLimit, getClientIp(req));
+    if (limited) return limited;
+
+    const body: Record<string, unknown> | null = await req.json().catch(() => null);
+    if (!body || typeof body !== "object") {
       return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
     }
 
-    const { role, stellarPublicKey, pin, phoneNumber, offlineDeviceKey, firstName, lastName, email } = body;
+    const fieldErrors: FieldErrors = {};
 
-    if (!role || !stellarPublicKey) {
-      return NextResponse.json({ error: "Missing required fields: role and stellarPublicKey" }, { status: 400 });
+    const cleanKey = optionalString(body.stellarPublicKey);
+    if (!cleanKey) {
+      return NextResponse.json({ error: "Missing required field: stellarPublicKey" }, { status: 400 });
+    }
+    if (!STELLAR_KEY_PATTERN.test(cleanKey)) {
+      return NextResponse.json({ error: "Invalid Stellar Public Key format" }, { status: 400 });
     }
 
-    const uppercaseRole = role.toUpperCase();
-    if (uppercaseRole !== "USER" && uppercaseRole !== "ADMIN") {
-      return NextResponse.json({ error: "Role must be either 'USER' or 'ADMIN'" }, { status: 400 });
+    const cleanOfflineDeviceKey = optionalString(body.offlineDeviceKey);
+    if (cleanOfflineDeviceKey && !STELLAR_KEY_PATTERN.test(cleanOfflineDeviceKey)) {
+      return NextResponse.json({ error: "Invalid offline device public key format" }, { status: 400 });
     }
 
-    if (!/^G[A-Z2-7]{55}$/.test(stellarPublicKey)) {
-      return NextResponse.json({ error: "Invalid Stellar Public Key format" }, { status: 400 });
+    const rawPhone = optionalString(body.phoneNumber);
+    if (rawPhone && !isPlausiblePhone(rawPhone)) fieldErrors.phoneNumber = "Invalid phone number.";
+    const cleanPhone = rawPhone ? toDbPhone(rawPhone) : null;
+
+    const rawPin = optionalString(body.pin);
+    if (rawPin && !isValidPinFormat(rawPin)) fieldErrors.pin = "PIN must be 4 to 6 digits.";
+
+    const cleanFirstName = optionalString(body.firstName);
+    if (cleanFirstName && cleanFirstName.length > MAX_NAME_LENGTH) {
+      fieldErrors.firstName = `First name must be at most ${MAX_NAME_LENGTH} characters.`;
+    }
+    const cleanLastName = optionalString(body.lastName);
+    if (cleanLastName && cleanLastName.length > MAX_NAME_LENGTH) {
+      fieldErrors.lastName = `Last name must be at most ${MAX_NAME_LENGTH} characters.`;
+    }
+    const cleanEmail = optionalString(body.email)?.toLowerCase() ?? null;
+    if (cleanEmail && (cleanEmail.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(cleanEmail))) {
+      fieldErrors.email = "Invalid email address.";
     }
 
-    const cleanKey = stellarPublicKey.trim();
-    const cleanPhone = phoneNumber ? phoneNumber.replace(/\D/g, "") : null;
-    const cleanPin = pin ? pin.trim() : null;
-    const cleanOfflineDeviceKey = offlineDeviceKey ? offlineDeviceKey.trim() : null;
-    if (cleanOfflineDeviceKey && !/^G[A-Z2-7]{55}$/.test(cleanOfflineDeviceKey)) {
-      return NextResponse.json({ error: "Invalid offline device public key format" }, { status: 400 });
+    if (Object.keys(fieldErrors).length > 0) {
+      return NextResponse.json({ error: "Validation failed", fieldErrors }, { status: 400 });
     }
-    const cleanFirstName = firstName ? firstName.trim() : null;
-    const cleanLastName = lastName ? lastName.trim() : null;
-    const cleanEmail = email ? email.trim() : null;
 
-    const existingKey = await prisma.account.findUnique({
-      where: { stellarPublicKey: cleanKey },
-    });
+    // Phone ownership: a token, when present, must match the phone being registered.
+    // It is mandatory once REQUIRE_OTP_TOKEN=true (enable after the new APK ships).
+    const verificationToken = optionalString(body.verificationToken);
+    if (verificationToken || isOtpTokenRequired()) {
+      if (!cleanPhone || !verificationToken || !verifyVerificationToken(verificationToken, cleanPhone)) {
+        return NextResponse.json(
+          { error: "Phone verification required. Please verify your number again." },
+          { status: 401 },
+        );
+      }
+    }
+
+    // Public registration always creates USER accounts, whatever the client sends.
+    const role = "USER" as const;
+
+    const [existingKey, existingPhone] = await Promise.all([
+      prisma.account.findUnique({ where: { stellarPublicKey: cleanKey }, select: { id: true } }),
+      cleanPhone
+        ? prisma.account.findFirst({ where: { phoneNumber: cleanPhone }, select: { id: true } })
+        : null,
+    ]);
 
     if (existingKey) {
       return NextResponse.json({ error: "Stellar Public Key is already registered." }, { status: 409 });
     }
+    if (existingPhone) {
+      return NextResponse.json({ error: "Phone number is already registered." }, { status: 409 });
+    }
+
+    const pinHash = rawPin ? await hashPin(rawPin) : null;
 
-    let shortId = "";
-    let isUnique = false;
-    let attempts = 0;
-    const maxAttempts = 15;
-
-    while (!isUnique && attempts < maxAttempts) {
-      shortId = generateBase62Id(); 
-      
-      const existingAccount = await prisma.account.findUnique({
-        where: { shortId },
-      });
-      if (!existingAccount) {
-        isUnique = true;
+    // Insert directly and retry only on a shortId collision (1 query in the common case).
+    for (let attempt = 0; attempt < MAX_SHORT_ID_ATTEMPTS; attempt++) {
+      try {
+        const created = await prisma.account.create({
+          data: {
+            shortId: generateBase62Id(),
+            role,
+            stellarPublicKey: cleanKey,
+            offlineDeviceKey: cleanOfflineDeviceKey,
+            pin: pinHash,
+            phoneNumber: cleanPhone,
+            firstName: cleanFirstName,
+            lastName: cleanLastName,
+            email: cleanEmail,
+          },
+        });
+        // Never echo the PIN hash back to the client.
+        const newAccount = { ...created, pin: undefined };
+        return NextResponse.json({ success: true, data: newAccount }, { status: 201 });
+      } catch (error) {
+        if (!isUniqueViolation(error)) throw error;
+        const target = uniqueTarget(error);
+        if (target.includes("stellar")) {
+          return NextResponse.json({ error: "Stellar Public Key is already registered." }, { status: 409 });
+        }
+        if (!target.includes("short")) throw error;
       }
-      attempts++;
     }
 
-    if (!isUnique) {
-      return NextResponse.json({ error: "Failed to generate a unique short ID. Please try again." }, { status: 500 });
-    }
-    
-    const newAccount = await prisma.account.create({
-      data: {
-        shortId,
-        role: uppercaseRole,
-        stellarPublicKey: cleanKey,
-        offlineDeviceKey: cleanOfflineDeviceKey,
-        pin: cleanPin,
-        phoneNumber: cleanPhone,
-        firstName: cleanFirstName,
-        lastName: cleanLastName,
-        email: cleanEmail,
-      },
-    });
-
-    return NextResponse.json({ success: true, data: newAccount }, { status: 201 });
+    return NextResponse.json({ error: "Failed to generate a unique short ID. Please try again." }, { status: 500 });
 
   } catch (error) {
     console.error("[Register API]", error);
diff --git a/apps/backend/app/api/users/check/route.ts b/apps/backend/app/api/users/check/route.ts
index 9995bc6..bf1bb49 100644
--- a/apps/backend/app/api/users/check/route.ts
+++ b/apps/backend/app/api/users/check/route.ts
@@ -57,6 +57,8 @@
  *               examples:
  *                 missing: { value: { error: "Missing required parameter: phone" } }
  *                 invalid: { value: { error: "Invalid phone number format" } }
+ *       '429':
+ *         description: Rate limit exceeded (60 / min per IP).
  *       '500':
  *         description: Internal server error.
  *         content:
@@ -69,11 +71,17 @@
  */
 import { NextRequest, NextResponse } from "next/server";
 import { prisma } from "@/lib/prisma";
+import { createLimiter, enforceLimit, getClientIp } from "@/lib/rate-limit";
 
 export const dynamic = "force-dynamic";
 
+const checkLimit = createLimiter("pijin:api:users:check", 60, "1 m");
+
 export async function GET(req: NextRequest) {
   try {
+    const limited = await enforceLimit(checkLimit, getClientIp(req));
+    if (limited) return limited;
+
     const { searchParams } = new URL(req.url);
     const phone = searchParams.get("phone");
 
@@ -88,10 +96,12 @@ export async function GET(req: NextRequest) {
       return NextResponse.json({ error: "Invalid phone number format" }, { status: 400 });
     }
 
+    // Never select the PIN here; PIN checks go through POST /api/auth/pin/verify.
     const account = await prisma.account.findFirst({
       where: {
         phoneNumber: cleanPhone,
       },
+      select: { stellarPublicKey: true, shortId: true },
     });
 
     if (account) {
@@ -99,7 +109,6 @@ export async function GET(req: NextRequest) {
         exists: true,
         stellarPublicKey: account.stellarPublicKey,
         shortId: account.shortId,
-        pin: account.pin,
       }, { status: 200 });
     }
 
diff --git a/apps/backend/app/api/users/lookup/route.ts b/apps/backend/app/api/users/lookup/route.ts
index 870a475..3261cee 100644
--- a/apps/backend/app/api/users/lookup/route.ts
+++ b/apps/backend/app/api/users/lookup/route.ts
@@ -57,11 +57,18 @@
  */
 import { NextRequest, NextResponse } from 'next/server';
 import { prisma } from '@/lib/prisma';
+import { createLimiter, enforceLimit, getClientIp } from '@/lib/rate-limit';
 
 export const dynamic = 'force-dynamic';
 
+// High ceiling: the current app resolves names with one lookup per offline row.
+const lookupLimit = createLimiter('pijin:api:users:lookup', 300, '1 m');
+
 export async function GET(req: NextRequest) {
   try {
+    const limited = await enforceLimit(lookupLimit, getClientIp(req));
+    if (limited) return limited;
+
     const { searchParams } = new URL(req.url);
     const shortId = searchParams.get('shortId')?.trim();
     const phone = searchParams.get('phone')?.trim();
diff --git a/apps/backend/lib/settlement.ts b/apps/backend/lib/settlement.ts
index 583df1c..b77e121 100644
--- a/apps/backend/lib/settlement.ts
+++ b/apps/backend/lib/settlement.ts
@@ -164,8 +164,8 @@ export async function processOfflineSettlement(
     },
   });
 
-  // Send SMS receipt to receiver (merchant) using pin/phoneNumber fields
-  const receiptMsg = `SUCCESS: Received ${amountStroops} stroops. PIN:${receiverAccount.pin ?? "0000"}`;
+  // Send SMS receipt to receiver (merchant). Never include the PIN.
+  const receiptMsg = `SUCCESS: Received ${amountStroops} stroops.`;
   const receiptPhone = normalizePhone(receiverAccount.phoneNumber);
   if (receiptPhone) {
     void sendSmsReceipt(receiptPhone, receiptMsg).then((result) => {
diff --git a/apps/mobile/src/screens/OnboardingScreen.tsx b/apps/mobile/src/screens/OnboardingScreen.tsx
index 8b74bfe..b292882 100644
--- a/apps/mobile/src/screens/OnboardingScreen.tsx
+++ b/apps/mobile/src/screens/OnboardingScreen.tsx
@@ -36,6 +36,7 @@ import {
   saveMainWalletSecret,
 } from '../services/storage/onboardingStorage';
 import { checkUserExists, registerAccount } from '../services/api/accounts';
+import { ApiError } from '../services/api/client';
 import { getOrGenerateDeviceKeypair } from '../services/wallet/deviceKeyStore';
 import { synchronizeOfflineDeviceKey } from '../services/wallet/offlineKeySync';
 import { synchronizeRecipientRegistry } from '../services/wallet/recipientRegistrySync';
@@ -109,6 +110,8 @@ export function OnboardingScreen() {
 
   // OTP
   const [otp, setOtp] = useState('');
+  // Proof of phone ownership from /api/otp/verify, required by /api/register.
+  const verificationTokenRef = useRef<string | null>(null);
 
   // Name & Info (new users only)
   const [firstName, setFirstName] = useState('');
@@ -280,6 +283,8 @@ export function OnboardingScreen() {
       if (!response.ok || !json.success) {
         throw new Error(json.error ?? 'Invalid OTP. Please try again.');
       }
+      verificationTokenRef.current =
+        typeof json.verificationToken === 'string' ? json.verificationToken : null;
       // OTP verified — proceed based on user flow
       if (userFlowType === 'returning') {
         navigation.replace('SignIn');
@@ -440,6 +445,7 @@ export function OnboardingScreen() {
         firstName,
         lastName,
         email,
+        verificationToken: verificationTokenRef.current ?? undefined,
       };
       const account = await registerAccount(registrationPayload);
 
@@ -467,6 +473,20 @@ export function OnboardingScreen() {
       });
     } catch (e) {
       console.error('[Onboarding Register Error]', e);
+      if (e instanceof ApiError && e.status === 401) {
+        // Verification token missing or expired — the phone must be re-verified.
+        verificationTokenRef.current = null;
+        Alert.alert(
+          'Verify Your Number Again',
+          'Your phone verification has expired. Please request a new code to continue.',
+          [{ text: 'OK', onPress: () => navigateToStep(2) }],
+        );
+        return;
+      }
+      if (e instanceof ApiError && e.status === 429) {
+        Alert.alert('Too Many Attempts', 'Please wait a few minutes and try again.');
+        return;
+      }
       const errorMessage = e instanceof Error ? e.message : 'Please check your connection and try again.';
       Alert.alert('Registration Failed', errorMessage);
     } finally {
diff --git a/apps/mobile/src/screens/SignInScreen.tsx b/apps/mobile/src/screens/SignInScreen.tsx
index 95047d5..9743e89 100644
--- a/apps/mobile/src/screens/SignInScreen.tsx
+++ b/apps/mobile/src/screens/SignInScreen.tsx
@@ -23,7 +23,8 @@ import {
   saveUserPinSecure,
   setOnboardingComplete,
 } from '../services/storage/onboardingStorage';
-import { checkUserExists } from '../services/api/accounts';
+import { checkUserExists, verifyPinWithServer } from '../services/api/accounts';
+import { ApiError } from '../services/api/client';
 import { getSep10Token, Keypair as StellarKeypair } from '../services/stellar/anchorService';
 import { useAuth } from '../context/AuthContext';
 import { loadStoredAccount } from '../services/storage/accountStorage';
@@ -88,36 +89,49 @@ export function SignInScreen() {
         pinToCompare = await getUserPinSecure();
       }
 
-      // ── Tier 3: Backend DB (ultimate fallback — requires network)
+      // ── Tier 3: Backend verification (requires network). The server never
+      // returns the PIN; it only confirms a match and enforces lockout.
       // Read phone directly from storage in case the state hasn't populated yet.
       if (!pinToCompare) {
         const phoneForQuery = phoneNumber || (await getUserPhone());
-        if (phoneForQuery) {
-          try {
-            const checkRes = await checkUserExists(phoneForQuery);
-            if (checkRes.exists && checkRes.pin) {
-              pinToCompare = checkRes.pin;
-              // Restore both local stores so future logins are offline-capable.
-              await saveUserPin(pinToCompare);
-              await saveUserPinSecure(pinToCompare);
-            }
-          } catch (networkErr) {
-            console.warn('[SignIn] Could not fetch PIN from backend:', networkErr);
+        if (!phoneForQuery) {
+          triggerShake();
+          Alert.alert('Cannot Verify PIN', 'No phone number is linked to this device. Please sign in again.');
+          setIsValidating(false);
+          return;
+        }
+        try {
+          await verifyPinWithServer(phoneForQuery, enteredPin);
+          // Restore both local stores so future logins are offline-capable.
+          await saveUserPin(enteredPin);
+          await saveUserPinSecure(enteredPin);
+          pinToCompare = enteredPin;
+        } catch (err) {
+          triggerShake();
+          if (err instanceof ApiError && err.status === 401) {
+            // Wrong PIN — the shake is the feedback, same as a local mismatch.
+          } else if (err instanceof ApiError && err.status === 423) {
+            const retryAfter = Number((err.body as { retryAfter?: number } | null)?.retryAfter ?? 900);
+            Alert.alert(
+              'Too Many Attempts',
+              `Your account is temporarily locked. Please try again in ${Math.ceil(retryAfter / 60)} minutes.`,
+            );
+          } else if (err instanceof ApiError && err.status === 429) {
+            Alert.alert('Too Many Attempts', 'Please wait a moment and try again.');
+          } else if (err instanceof ApiError && err.status === 404) {
+            Alert.alert('Account Not Found', 'This phone number is not registered on the network.');
+          } else {
+            console.warn('[SignIn] Could not verify PIN with backend:', err);
+            Alert.alert(
+              'Cannot Verify PIN',
+              'Your PIN could not be verified. Please ensure you are connected to the internet, then try again.',
+            );
           }
+          setIsValidating(false);
+          return;
         }
       }
 
-      if (!pinToCompare) {
-        // All three tiers exhausted — cannot verify without a known PIN.
-        triggerShake();
-        Alert.alert(
-          'Cannot Verify PIN',
-          'Your PIN could not be retrieved. Please ensure you are connected to the internet, then try again.',
-        );
-        setIsValidating(false);
-        return;
-      }
-
       if (enteredPin !== pinToCompare) {
         triggerShake();
         setIsValidating(false);
diff --git a/apps/mobile/src/services/api/accounts.ts b/apps/mobile/src/services/api/accounts.ts
index 5efb418..4e9aabc 100644
--- a/apps/mobile/src/services/api/accounts.ts
+++ b/apps/mobile/src/services/api/accounts.ts
@@ -6,7 +6,6 @@ export type RegisteredAccount = {
   role: string;
   stellarPublicKey: string;
   offlineDeviceKey: string | null;
-  pin: string | null;
   phoneNumber: string | null;
   firstName: string | null;
   lastName: string | null;
@@ -27,6 +26,8 @@ export async function registerAccount(input: {
   firstName?: string;
   lastName?: string;
   email?: string;
+  /** Token from /api/otp/verify proving ownership of phoneNumber. */
+  verificationToken?: string;
 }): Promise<RegisteredAccount> {
   const body: Record<string, string> = {
     role: 'USER', // Mobile always registers as USER role
@@ -51,6 +52,9 @@ export async function registerAccount(input: {
   if (input.email) {
     body.email = input.email;
   }
+  if (input.verificationToken) {
+    body.verificationToken = input.verificationToken;
+  }
 
   const result = await apiRequest<RegisterResponse>('/api/register', {
     method: 'POST',
@@ -64,7 +68,6 @@ type CheckUserResponse = {
   exists: boolean;
   stellarPublicKey?: string;
   shortId?: string;
-  pin?: string | null;
 };
 
 /**
@@ -77,6 +80,18 @@ export async function checkUserExists(phone: string): Promise<CheckUserResponse>
   return apiRequest<CheckUserResponse>(`/api/users/check?phone=${encodeURIComponent(phone)}`);
 }
 
+/**
+ * Verifies a PIN server-side. Resolves on success; otherwise throws ApiError:
+ * 401 wrong PIN (body.attemptsRemaining), 404 no account, 423 locked
+ * (body.retryAfter seconds), 429 rate limited.
+ */
+export async function verifyPinWithServer(phone: string, pin: string): Promise<void> {
+  await apiRequest<{ success: boolean }>('/api/auth/pin/verify', {
+    method: 'POST',
+    body: JSON.stringify({ phoneNumber: phone, pin }),
+  });
+}
+
 type LookupUserResponse = {
   found: boolean;
   shortId?: string;
```

</details>

<details><summary>New files</summary>

```diff
diff --git a/apps/backend/lib/pin.ts b/apps/backend/lib/pin.ts
new file mode 100644
index 0000000..7acf786
--- /dev/null
+++ b/apps/backend/lib/pin.ts
@@ -0,0 +1,70 @@
+/**
+ * @file lib/pin.ts
+ *
+ * PIN hashing and verification.
+ *  - New PINs are stored as `scrypt$<N>$<r>$<p>$<saltB64>$<hashB64>`.
+ *  - Rows created before hashing hold the plaintext PIN; `verifyPin` still
+ *    accepts them and reports `needsRehash` so the caller can upgrade the row.
+ */
+
+import crypto from "node:crypto";
+
+const SCRYPT_N = 16384;
+const SCRYPT_R = 8;
+const SCRYPT_P = 1;
+const KEY_LEN = 32;
+const SALT_LEN = 16;
+const PREFIX = "scrypt$";
+
+export const PIN_PATTERN = /^\d{4,6}$/;
+
+export function isValidPinFormat(pin: unknown): pin is string {
+  return typeof pin === "string" && PIN_PATTERN.test(pin);
+}
+
+export function isHashedPin(stored: string): boolean {
+  return stored.startsWith(PREFIX);
+}
+
+function scrypt(pin: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
+  return new Promise((resolve, reject) => {
+    crypto.scrypt(pin, salt, KEY_LEN, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (err, key) => {
+      if (err) reject(err);
+      else resolve(key);
+    });
+  });
+}
+
+export async function hashPin(pin: string): Promise<string> {
+  const salt = crypto.randomBytes(SALT_LEN);
+  const key = await scrypt(pin, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P);
+  return `${PREFIX}${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("base64")}$${key.toString("base64")}`;
+}
+
+export function constantTimeEqual(a: string, b: string): boolean {
+  const bufA = Buffer.from(a, "utf8");
+  const bufB = Buffer.from(b, "utf8");
+  if (bufA.length !== bufB.length) {
+    // Still burn a comparison so length mismatches don't return faster.
+    crypto.timingSafeEqual(bufA, bufA);
+    return false;
+  }
+  return crypto.timingSafeEqual(bufA, bufB);
+}
+
+export async function verifyPin(
+  pin: string,
+  stored: string,
+): Promise<{ ok: boolean; needsRehash: boolean }> {
+  if (!isHashedPin(stored)) {
+    return { ok: constantTimeEqual(pin, stored), needsRehash: true };
+  }
+
+  const parts = stored.split("$");
+  if (parts.length !== 6) return { ok: false, needsRehash: false };
+  const [, nStr, rStr, pStr, saltB64, hashB64] = parts;
+  const expected = Buffer.from(hashB64, "base64");
+  const actual = await scrypt(pin, Buffer.from(saltB64, "base64"), Number(nStr), Number(rStr), Number(pStr));
+  const ok = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
+  return { ok, needsRehash: ok && Number(nStr) !== SCRYPT_N };
+}
diff --git a/apps/backend/lib/otp.ts b/apps/backend/lib/otp.ts
new file mode 100644
index 0000000..8525c56
--- /dev/null
+++ b/apps/backend/lib/otp.ts
@@ -0,0 +1,89 @@
+/**
+ * @file lib/otp.ts
+ *
+ * OTP generation/comparison, phone normalisation and the short-lived
+ * phone-verification token that `/api/otp/verify` issues and `/api/register`
+ * consumes.
+ */
+
+import crypto from "node:crypto";
+import jwt from "jsonwebtoken";
+import { constantTimeEqual } from "./pin";
+
+export const OTP_TTL_SECONDS = 300;
+export const OTP_MAX_ATTEMPTS = 5;
+// Covers the post-OTP steps (name, PIN, seed-phrase backup) before /api/register.
+export const VERIFICATION_TOKEN_TTL_SECONDS = 30 * 60;
+
+const TOKEN_ISSUER = "pijin-otp";
+const TOKEN_PURPOSE = "phone-verification";
+
+/** Normalises a phone number to E.164 (PH local formats → +63). */
+export function normalizePhoneNumber(phone: string): string {
+  const cleaned = phone.replace(/[^0-9+]/g, "");
+  if (cleaned.startsWith("09") && cleaned.length === 11) {
+    return "+63" + cleaned.substring(1);
+  } else if (cleaned.startsWith("63") && cleaned.length === 12) {
+    return "+" + cleaned;
+  } else if (!cleaned.startsWith("+")) {
+    return "+" + cleaned;
+  }
+  return cleaned;
+}
+
+/** The digits-only form stored in `Account.phoneNumber`. */
+export function toDbPhone(phone: string): string {
+  return normalizePhoneNumber(phone).replace(/\D/g, "");
+}
+
+/** E.164 allows at most 15 digits; 8 is a safe lower bound. */
+export function isPlausiblePhone(phone: string): boolean {
+  const digits = toDbPhone(phone);
+  return digits.length >= 8 && digits.length <= 15;
+}
+
+/** Uniform 6-digit code, zero-padded (000000–999999). */
+export function generateOtp(): string {
+  return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
+}
+
+export function otpMatches(stored: string | number, provided: string): boolean {
+  // Upstash auto-parses numeric strings, which drops leading zeros.
+  const expected = String(stored).padStart(6, "0");
+  return constantTimeEqual(expected, provided.trim());
+}
+
+function getTokenSecret(): string | null {
+  return process.env.OTP_VERIFICATION_JWT_SECRET || null;
+}
+
+export function isOtpTokenRequired(): boolean {
+  return process.env.REQUIRE_OTP_TOKEN === "true";
+}
+
+/** Returns null when no signing secret is configured. */
+export function signVerificationToken(phone: string): string | null {
+  const secret = getTokenSecret();
+  if (!secret) return null;
+  return jwt.sign({ purpose: TOKEN_PURPOSE }, secret, {
+    algorithm: "HS256",
+    subject: toDbPhone(phone),
+    issuer: TOKEN_ISSUER,
+    expiresIn: VERIFICATION_TOKEN_TTL_SECONDS,
+  });
+}
+
+/** True only if the token is valid, unexpired and bound to `phone`. */
+export function verifyVerificationToken(token: string, phone: string): boolean {
+  const secret = getTokenSecret();
+  if (!secret) return false;
+  try {
+    const payload = jwt.verify(token, secret, {
+      algorithms: ["HS256"],
+      issuer: TOKEN_ISSUER,
+    }) as jwt.JwtPayload;
+    return payload.purpose === TOKEN_PURPOSE && payload.sub === toDbPhone(phone);
+  } catch {
+    return false;
+  }
+}
diff --git a/apps/backend/lib/rate-limit.ts b/apps/backend/lib/rate-limit.ts
new file mode 100644
index 0000000..1ff575b
--- /dev/null
+++ b/apps/backend/lib/rate-limit.ts
@@ -0,0 +1,48 @@
+/**
+ * @file lib/rate-limit.ts
+ *
+ * Shared Upstash limiter factory and client-IP extraction.
+ *
+ * NOTE: limits are per IP. Testers on the same venue Wi-Fi share one public IP,
+ * so per-IP budgets here are intentionally generous.
+ */
+
+import { NextRequest, NextResponse } from "next/server";
+import { Ratelimit } from "@upstash/ratelimit";
+import { Redis } from "@upstash/redis";
+
+type Window = Parameters<typeof Ratelimit.slidingWindow>[1];
+
+let redisClient: Redis | null = null;
+
+export function getRedis(): Redis {
+  if (!redisClient) redisClient = Redis.fromEnv();
+  return redisClient;
+}
+
+export function createLimiter(prefix: string, tokens: number, window: Window): Ratelimit {
+  return new Ratelimit({
+    redis: getRedis(),
+    limiter: Ratelimit.slidingWindow(tokens, window),
+    analytics: false,
+    prefix,
+  });
+}
+
+/** First hop of `x-forwarded-for` (the client), falling back to `x-real-ip`. */
+export function getClientIp(req: NextRequest): string {
+  const forwarded = req.headers.get("x-forwarded-for");
+  const first = forwarded?.split(",")[0]?.trim();
+  return first || req.headers.get("x-real-ip")?.trim() || "127.0.0.1";
+}
+
+/** Returns a 429 response when the limit is exceeded, otherwise null. */
+export async function enforceLimit(limiter: Ratelimit, key: string): Promise<NextResponse | null> {
+  const { success, reset } = await limiter.limit(key);
+  if (success) return null;
+  const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
+  return NextResponse.json(
+    { error: "Too many requests. Please try again later." },
+    { status: 429, headers: { "Retry-After": String(retryAfter) } },
+  );
+}
diff --git a/apps/backend/app/api/auth/pin/verify/route.ts b/apps/backend/app/api/auth/pin/verify/route.ts
new file mode 100644
index 0000000..b81dc23
--- /dev/null
+++ b/apps/backend/app/api/auth/pin/verify/route.ts
@@ -0,0 +1,132 @@
+/**
+ * @swagger
+ * /api/auth/pin/verify:
+ *   post:
+ *     tags:
+ *       - Users & Accounts
+ *     summary: Verify a user's PIN server-side
+ *     description: |
+ *       Compares the supplied PIN against the stored scrypt hash for the account
+ *       registered to `phoneNumber`. The PIN itself is never returned by any endpoint.
+ *
+ *       #### Lockout
+ *       After **5** incorrect attempts the phone is locked for **15 minutes** (`423`).
+ *       A correct PIN clears the counter.
+ *
+ *       Legacy plaintext PINs are accepted once and transparently re-hashed.
+ *     requestBody:
+ *       required: true
+ *       content:
+ *         application/json:
+ *           schema:
+ *             type: object
+ *             required: [phoneNumber, pin]
+ *             properties:
+ *               phoneNumber:
+ *                 type: string
+ *                 example: "+639171234567"
+ *               pin:
+ *                 type: string
+ *                 example: "1234"
+ *     responses:
+ *       '200':
+ *         description: PIN is correct.
+ *         content:
+ *           application/json:
+ *             schema:
+ *               type: object
+ *               properties:
+ *                 success:
+ *                   type: boolean
+ *                   example: true
+ *       '400':
+ *         description: Missing or malformed `phoneNumber` / `pin`.
+ *       '401':
+ *         description: Incorrect PIN. Body includes `attemptsRemaining`.
+ *       '404':
+ *         description: No account (or no PIN) for this phone number.
+ *       '423':
+ *         description: Locked after too many failures. Body includes `retryAfter` (seconds).
+ *       '429':
+ *         description: Rate limit exceeded.
+ */
+import { NextRequest, NextResponse } from "next/server";
+import { prisma } from "@/lib/prisma";
+import { hashPin, isValidPinFormat, verifyPin } from "@/lib/pin";
+import { isPlausiblePhone, toDbPhone } from "@/lib/otp";
+import { createLimiter, enforceLimit, getClientIp, getRedis } from "@/lib/rate-limit";
+
+export const runtime = "nodejs";
+export const dynamic = "force-dynamic";
+
+const MAX_FAILURES = 5;
+const LOCKOUT_SECONDS = 15 * 60;
+
+const ipLimit = createLimiter("pijin:api:pin:verify", 30, "1 m");
+
+export async function POST(req: NextRequest) {
+  try {
+    const limited = await enforceLimit(ipLimit, getClientIp(req));
+    if (limited) return limited;
+
+    const body = await req.json().catch(() => null);
+    const phoneNumber = typeof body?.phoneNumber === "string" ? body.phoneNumber : "";
+    const pin = typeof body?.pin === "string" ? body.pin.trim() : "";
+
+    if (!phoneNumber || !isPlausiblePhone(phoneNumber) || !isValidPinFormat(pin)) {
+      return NextResponse.json({ error: "A valid phone number and PIN are required." }, { status: 400 });
+    }
+
+    const dbPhone = toDbPhone(phoneNumber);
+    const failKey = `pijin:pin:fail:${dbPhone}`;
+    const redis = getRedis();
+
+    const failures = Number((await redis.get<number>(failKey)) ?? 0);
+    if (failures >= MAX_FAILURES) {
+      const ttl = await redis.ttl(failKey);
+      const retryAfter = ttl > 0 ? ttl : LOCKOUT_SECONDS;
+      return NextResponse.json(
+        { error: "Too many incorrect PIN attempts. Please try again later.", retryAfter },
+        { status: 423, headers: { "Retry-After": String(retryAfter) } },
+      );
+    }
+
+    const account = await prisma.account.findFirst({
+      where: { phoneNumber: dbPhone },
+      orderBy: { createdAt: "desc" },
+      select: { id: true, pin: true },
+    });
+
+    if (!account || !account.pin) {
+      return NextResponse.json({ error: "Account not found." }, { status: 404 });
+    }
+
+    const { ok, needsRehash } = await verifyPin(pin, account.pin);
+
+    if (!ok) {
+      const count = await redis.incr(failKey);
+      if (count === 1 || count >= MAX_FAILURES) await redis.expire(failKey, LOCKOUT_SECONDS);
+      if (count >= MAX_FAILURES) {
+        return NextResponse.json(
+          { error: "Too many incorrect PIN attempts. Please try again later.", retryAfter: LOCKOUT_SECONDS },
+          { status: 423, headers: { "Retry-After": String(LOCKOUT_SECONDS) } },
+        );
+      }
+      return NextResponse.json(
+        { error: "Incorrect PIN.", attemptsRemaining: MAX_FAILURES - count },
+        { status: 401 },
+      );
+    }
+
+    await redis.del(failKey);
+
+    if (needsRehash) {
+      await prisma.account.update({ where: { id: account.id }, data: { pin: await hashPin(pin) } });
+    }
+
+    return NextResponse.json({ success: true });
+  } catch (error) {
+    console.error("[PIN Verify API]", error);
+    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
+  }
+}
diff --git a/apps/backend/lib/signup-security.test.ts b/apps/backend/lib/signup-security.test.ts
new file mode 100644
index 0000000..82bf929
--- /dev/null
+++ b/apps/backend/lib/signup-security.test.ts
@@ -0,0 +1,121 @@
+/**
+ * @file lib/signup-security.test.ts
+ *
+ * Test suite for sign-up hardening:
+ *  - PIN hashing, legacy plaintext acceptance and format checks
+ *  - OTP generation, zero-padded comparison and phone normalisation
+ *  - Phone-verification token binding and expiry
+ */
+
+import assert from 'node:assert/strict';
+import test from 'node:test';
+import jwt from 'jsonwebtoken';
+import { hashPin, isHashedPin, isValidPinFormat, verifyPin } from './pin';
+import {
+    generateOtp,
+    isPlausiblePhone,
+    normalizePhoneNumber,
+    otpMatches,
+    signVerificationToken,
+    toDbPhone,
+    verifyVerificationToken,
+} from './otp';
+
+// ─────────────────────────────────────────────────────────────────────────────
+// PIN Tests
+// ─────────────────────────────────────────────────────────────────────────────
+
+test('hashPin: produces a salted scrypt hash that verifies', async () => {
+    const a = await hashPin('1234');
+    const b = await hashPin('1234');
+    assert.ok(isHashedPin(a));
+    assert.notEqual(a, b, 'salt must make hashes differ');
+    assert.ok(!a.includes('1234'));
+    assert.deepEqual(await verifyPin('1234', a), { ok: true, needsRehash: false });
+    assert.equal((await verifyPin('4321', a)).ok, false);
+});
+
+test('verifyPin: accepts legacy plaintext and flags it for rehash', async () => {
+    assert.deepEqual(await verifyPin('1234', '1234'), { ok: true, needsRehash: true });
+    assert.equal((await verifyPin('1235', '1234')).ok, false);
+    assert.equal((await verifyPin('12345', '1234')).ok, false);
+});
+
+test('verifyPin: rejects malformed stored hashes', async () => {
+    assert.equal((await verifyPin('1234', 'scrypt$broken')).ok, false);
+});
+
+test('isValidPinFormat: 4–6 digits only', () => {
+    assert.equal(isValidPinFormat('1234'), true);
+    assert.equal(isValidPinFormat('123456'), true);
+    assert.equal(isValidPinFormat('123'), false);
+    assert.equal(isValidPinFormat('1234567'), false);
+    assert.equal(isValidPinFormat('12a4'), false);
+    assert.equal(isValidPinFormat(1234), false);
+});
+
+// ─────────────────────────────────────────────────────────────────────────────
+// OTP Tests
+// ─────────────────────────────────────────────────────────────────────────────
+
+test('generateOtp: always 6 digits', () => {
+    for (let i = 0; i < 500; i++) {
+        assert.match(generateOtp(), /^\d{6}$/);
+    }
+});
+
+test('otpMatches: handles Upstash numeric parsing of leading zeros', () => {
+    assert.equal(otpMatches(42, '000042'), true);
+    assert.equal(otpMatches('000042', ' 000042 '), true);
+    assert.equal(otpMatches(42, '42'), false);
+    assert.equal(otpMatches('123456', '123457'), false);
+});
+
+test('normalizePhoneNumber / toDbPhone: PH formats converge', () => {
+    assert.equal(normalizePhoneNumber('09171234567'), '+639171234567');
+    assert.equal(normalizePhoneNumber('639171234567'), '+639171234567');
+    assert.equal(normalizePhoneNumber('+63 917 123 4567'), '+639171234567');
+    assert.equal(toDbPhone('09171234567'), '639171234567');
+    assert.equal(toDbPhone('+639171234567'), '639171234567');
+    assert.equal(isPlausiblePhone('123'), false);
+    assert.equal(isPlausiblePhone('+639171234567'), true);
+});
+
+// ─────────────────────────────────────────────────────────────────────────────
+// Verification Token Tests
+// ─────────────────────────────────────────────────────────────────────────────
+
+test('verification token: bound to phone, any input format', () => {
+    process.env.OTP_VERIFICATION_JWT_SECRET = 'test-otp-secret';
+    const token = signVerificationToken('+639171234567');
+    assert.ok(token);
+    assert.equal(verifyVerificationToken(token!, '639171234567'), true);
+    assert.equal(verifyVerificationToken(token!, '09171234567'), true);
+    assert.equal(verifyVerificationToken(token!, '+639999999999'), false);
+});
+
+test('verification token: rejects wrong secret, wrong purpose and expiry', () => {
+    process.env.OTP_VERIFICATION_JWT_SECRET = 'test-otp-secret';
+    const forged = jwt.sign({ purpose: 'phone-verification' }, 'other-secret', {
+        subject: '639171234567', issuer: 'pijin-otp',
+    });
+    assert.equal(verifyVerificationToken(forged, '639171234567'), false);
+
+    const wrongPurpose = jwt.sign({ purpose: 'sep10' }, 'test-otp-secret', {
+        subject: '639171234567', issuer: 'pijin-otp',
+    });
+    assert.equal(verifyVerificationToken(wrongPurpose, '639171234567'), false);
+
+    const expired = jwt.sign(
+        { purpose: 'phone-verification', exp: Math.floor(Date.now() / 1000) - 10 },
+        'test-otp-secret',
+        { subject: '639171234567', issuer: 'pijin-otp' },
+    );
+    assert.equal(verifyVerificationToken(expired, '639171234567'), false);
+});
+
+test('verification token: not issued without a secret', () => {
+    delete process.env.OTP_VERIFICATION_JWT_SECRET;
+    assert.equal(signVerificationToken('+639171234567'), null);
+    assert.equal(verifyVerificationToken('anything', '639171234567'), false);
+});
```

</details>
