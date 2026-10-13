# Task 1.2 – Optimize TextBee: Change Review

> Branch: `rixdev` · Status: **uncommitted** · Source plan: [test-50users-plan.md](test-50users-plan.md) §1.2 · Builds on [task-1.1-changes.md](task-1.1-changes.md)
>
> Verification: backend `npm test` 93/93 pass (12 new) · backend `tsc --noEmit` clean · eslint clean on changed files · mobile `tsc`: no errors in changed files (pre-existing errors elsewhere untouched).
> **Not yet run:** real TextBee gateway, real QStash delivery, or the flow on a device.

---

## 1. Summary

| ID | Change | Status |
|----|--------|--------|
| T1 | One SMS sender (`deliverSms`): E.164 normalisation, per-attempt timeout + overall deadline, retry only on network / 408 / 429 / 5xx, SIM selection, optional fallback device | ✅ |
| T2 | `/api/otp/send` returns `502 { code: "SMS_FAILED" }` when the SMS fails and deletes the unsent code; 8s budget | ✅ |
| T3 | Receipts and settlement notices queued on QStash → `POST /api/sms/dispatch`, throttled 10/min, parallelism 1, 3 retries, dead-letter; direct send if QStash is unavailable | ✅ |
| T4 | `/api/health` adds `features.smsOtp`; `?deep=1` adds TextBee device status (30s Redis cache) and `status: "degraded"` | ✅ |
| T5 | Tester fallback OTP: `OTP_TEST_MODE` + allow-listed numbers get a fixed code, no SMS. Off by default | ✅ |
| — | Webhook secret: verified it already fails closed when `TEXTBEE_WEBHOOK_SECRET` is missing | ✅ no change |
| M1 | Mobile: 60s resend countdown, `429` follows `Retry-After`, `502` shows a clear message and unlocks resend | ✅ |

**Design decision:** the plan asked for OTP to both return a real result and return immediately via QStash; those conflict. OTP stays **inline** (real `502`), and every other SMS is queued and throttled, which is what gives OTP priority on the single SIM.

**Not code:** test-day device prep (battery saver off, charger, SIM credit, provisioning the second device) remains a manual checklist item.

---

## 2. Files Changed

### New files

| File | Purpose |
|------|---------|
| [apps/backend/lib/sms-queue.ts](apps/backend/lib/sms-queue.ts) | `enqueueSms(to, message, { req, traceId, dedupKey })` – publishes to QStash with `flowControl`; falls back to direct delivery; never throws |
| [apps/backend/app/api/sms/dispatch/route.ts](apps/backend/app/api/sms/dispatch/route.ts) | QStash worker: verifies signature, delivers, `500` on transient failure (QStash retries), `200` on permanent failure (no retry) |
| [apps/backend/lib/sms-health.ts](apps/backend/lib/sms-health.ts) | `getTextbeeStatus()` / `classifyDevice()` for primary and fallback devices |
| [apps/backend/lib/sms-delivery.test.ts](apps/backend/lib/sms-delivery.test.ts) | 12 tests: retry classes, fallback device, SIM id, deadline, config errors, tester gate, device classification |

### Modified files

| File | What changed |
|------|--------------|
| [apps/backend/lib/sms.ts](apps/backend/lib/sms.ts) | Rewritten as the single sender: `deliverSms` (returns a result, never throws), `getSmsGateways`, `isRetryableStatus`. `sendSmsNotification` / `sendSms` kept as throwing wrappers. |
| [apps/backend/lib/textbee.ts](apps/backend/lib/textbee.ts) | `sendSmsReceipt` is now a thin wrapper over `deliverSms` (same return shape). |
| [apps/backend/app/api/otp/send/route.ts](apps/backend/app/api/otp/send/route.ts) | Uses `deliverSms` with `{ retries: 1, timeoutMs: 4000, deadlineMs: 8000 }`; `502` on failure; tester code path; Swagger `502`. |
| [apps/backend/lib/otp.ts](apps/backend/lib/otp.ts) | Added `getTestOtpCode(phone, env)`. |
| [apps/backend/app/api/engine/settle/route.ts](apps/backend/app/api/engine/settle/route.ts) | All 13 SMS sends → `enqueueSms`. Failure notices keyed `settle-fail-<traceId>`, success receipts `settle-ok-<settlementId>-<sender/receiver>` so QStash retries of settle don't double-send. |
| [apps/backend/lib/settlement.ts](apps/backend/lib/settlement.ts) | Receipt → `await enqueueSms(...)` (was a dangling `void` promise that Vercel can freeze). |
| [apps/backend/app/api/health/route.ts](apps/backend/app/api/health/route.ts) | `features.smsOtp`, `?deep=1` device status, `degraded` state, error now logged. |
| [apps/backend/.env.example](apps/backend/.env.example) | `TEXTBEE_FALLBACK_DEVICE_ID / _GATEWAY_URL / _API_KEY / _SIM_SUBSCRIPTION_ID`, `OTP_TEST_MODE / _NUMBERS / _CODE`. |
| [apps/mobile/src/screens/OnboardingScreen.tsx](apps/mobile/src/screens/OnboardingScreen.tsx) | `resendCooldown` state + 1s tick; Resend shows "Resend in 0:45" while disabled; `429` / `502` handling; accessibility role, state and label on the Resend control. |
| [test-50users-plan.md](test-50users-plan.md) | §1.2 and related items marked done / partial. |

---

## 3. Behaviour Details

### Retry policy (`deliverSms`)
| Outcome | Retried on same device? | Tries fallback device? |
|---|---|---|
| 2xx | – (success) | – |
| Network error / timeout | yes, up to `retries` | yes |
| 408, 429, 5xx | yes, up to `retries` | yes |
| Other 4xx | **no** | yes (e.g. primary device disabled) |
| Invalid recipient / missing config | no | no |

Backoff: `400ms × attempt + 0–200ms jitter`, always bounded by the overall deadline (default 15s).

### Budgets per caller
| Caller | retries | per-attempt timeout | overall deadline |
|---|---|---|---|
| `/api/otp/send` | 1 | 4s | 8s (under Vercel's 10s) |
| `/api/sms/dispatch` | 0 (QStash retries) | env default 4.5s | 9s |
| direct fallback in `enqueueSms` | env (2) | env (4.5s) | 15s |

### Queue
- Flow-control key `pijin-sms-notifications`: **10 per minute, 1 at a time**, 3 QStash retries, then the QStash dead-letter queue.
- Target URL uses the request host (same rule as the SMS webhook); without a request it uses `NEXT_PUBLIC_APP_URL`. If neither is available, or publishing fails, the SMS is sent directly.
- Worker returns `200` for permanent failures (e.g. invalid number) so QStash doesn't retry them.

### `/api/health`
```json
{ "status": "healthy", "uptime": 12.3, "timestamp": "…", "features": { "smsOtp": true },
  "sms": [ { "role": "primary", "status": "online", "lastHeartbeat": "…" },
           { "role": "fallback", "status": "unconfigured" } ] }
```
`sms` only appears with `?deep=1`. Device ids are never returned. `status` is `degraded` when SMS is configured, no device is online, and at least one is known offline or disabled.

### Tester fallback OTP
Requires **all** of: `OTP_TEST_MODE=true`, a 6-digit `OTP_TEST_CODE`, and the phone in `OTP_TEST_NUMBERS`. Rate limits still apply. Each use logs a warning.

### Mobile
- After a successful send: Resend disabled for 60s with a visible countdown.
- `429`: countdown set from `Retry-After`; alert says how long to wait.
- `502`: alert "We couldn't send the SMS…", Resend available immediately.

---

## 4. Rollout Steps

1. **Vercel env:** confirm `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY` and `NEXT_PUBLIC_APP_URL` are set. Optionally set `TEXTBEE_FALLBACK_*` once a second device exists. Leave `OTP_TEST_MODE=false`.
2. Deploy backend. Call `/api/health?deep=1` and check the device shows `online`.
3. Trigger one settlement and confirm the receipt arrives via `/api/sms/dispatch` (QStash console → Logs).
4. Ship the new APK (also needed for task 1.1).
5. Test day: if TextBee goes down, set `OTP_TEST_MODE=true` with the testers' numbers and a code shared privately.

---

## 5. Known Risks / Follow-ups

- **Receipts can lag** during peaks: at 10/min, 50 simultaneous settlements (100 receipts) take about 10 minutes to drain. Raise the rate in `lib/sms-queue.ts` if the SIM handles more.
- **TextBee device API shape is assumed** (`data[]` with `_id`, `enabled`, `lastHeartbeat` / `updatedAt`). Unknown shapes report `unknown` rather than failing; verify against the live account.
- **Fixed-code risk:** while `OTP_TEST_MODE=true`, anyone with an allow-listed number and the code can pass OTP. Keep it off except during an outage.
- **Dedup window:** QStash deduplication covers retries within its window; much later re-runs of settle could still send a second receipt.
- OTP is still awaited inline (up to 8s). Under heavy concurrency this holds a function per request; acceptable at 50 users.

---

## 6. Test Checklist (manual, on staging)

- [ ] OTP happy path: SMS arrives, Resend counts down from 1:00
- [ ] Gateway down (wrong `TEXTBEE_API_KEY`): `/otp/send` → `502`, app shows message, Resend unlocked, old code invalid
- [ ] 4 sends in 5 min → `429` with `Retry-After`; app countdown matches
- [ ] Fallback device configured + primary disabled → SMS sent via fallback (logs show `via fallback`)
- [ ] Settlement → receipts appear in QStash logs under `/api/sms/dispatch` and arrive by SMS
- [ ] 20 quick settlements → receipts arrive at ~10/min; OTPs during that time are not delayed
- [ ] `/api/sms/dispatch` without a QStash signature → `401`
- [ ] `/api/health?deep=1` shows device status; turning the phone off → `offline` / `degraded` within ~10 min
- [ ] `OTP_TEST_MODE=true` + allow-listed number → fixed code works, no SMS sent; non-listed number unaffected

---

## Appendix: Full Diff

<details><summary>Modified files</summary>

```diff
diff --git a/apps/backend/app/api/engine/settle/route.ts b/apps/backend/app/api/engine/settle/route.ts
index 7f37d60..40ae1b6 100644
--- a/apps/backend/app/api/engine/settle/route.ts
+++ b/apps/backend/app/api/engine/settle/route.ts
@@ -92,7 +92,7 @@ import {
     maskPhoneNumber,
 } from '@/lib/sms-security';
 import { contractConfig, pijinContract, sorobanRpcServer } from '@/lib/pijin-contract';
-import { sendSmsNotification, sendSms } from '@/lib/sms';
+import { enqueueSms } from '@/lib/sms-queue';
 import { Horizon, rpc } from '@stellar/stellar-sdk';
 import { executeTwoPhaseSettlement } from '@/lib/stellar-transaction-manager';
 import {
@@ -243,10 +243,7 @@ export async function POST(req: Request, params?: unknown): Promise<Response> {
             reason,
         });
         if (senderPhone) {
-            await sendSms(
-                senderPhone,
-                `Pijin: Transaction failed. Malformed payment payload.`
-            ).catch((err) => console.error('[Settle] Failed to send error SMS:', err));
+            await enqueueSms(senderPhone, `Pijin: Transaction failed. Malformed payment payload.`, { req, traceId, dedupKey: `settle-fail-${traceId}` }).catch((err) => console.error('[Settle] Failed to send error SMS:', err));
         }
         return NextResponse.json({ success: false, status: 'FAILED', error: reason, traceId }, { status: 200 });
     }
@@ -440,10 +437,7 @@ export async function POST(req: Request, params?: unknown): Promise<Response> {
         });
         logOfflineTransactionDebug(traceId, 'db:failed', { settlementId, status: 'FAILED', failReason });
         if (senderPhone) {
-            await sendSms(
-                senderPhone,
-                `Pijin: Transaction failed. Unsupported token.`
-            ).catch((err) => console.error('[Settle] Failed to send error SMS:', err));
+            await enqueueSms(senderPhone, `Pijin: Transaction failed. Unsupported token.`, { req, traceId, dedupKey: `settle-fail-${traceId}` }).catch((err) => console.error('[Settle] Failed to send error SMS:', err));
         }
         return NextResponse.json({ success: false, status: 'FAILED', reason: failReason, traceId }, { status: 200 });
     }
@@ -457,10 +451,7 @@ export async function POST(req: Request, params?: unknown): Promise<Response> {
         });
         logOfflineTransactionDebug(traceId, 'db:failed', { settlementId, status: 'FAILED', failReason });
         if (senderPhone) {
-            await sendSms(
-                senderPhone,
-                `Pijin: Transaction failed. Token is inactive.`
-            ).catch((err) => console.error('[Settle] Failed to send error SMS:', err));
+            await enqueueSms(senderPhone, `Pijin: Transaction failed. Token is inactive.`, { req, traceId, dedupKey: `settle-fail-${traceId}` }).catch((err) => console.error('[Settle] Failed to send error SMS:', err));
         }
         return NextResponse.json({ success: false, status: 'FAILED', reason: failReason, traceId }, { status: 200 });
     }
@@ -477,10 +468,7 @@ export async function POST(req: Request, params?: unknown): Promise<Response> {
         logOfflineTransactionDebug(traceId, 'db:failed', { settlementId, status: 'FAILED', failReason });
 
         if (senderPhone) {
-            await sendSms(
-                senderPhone,
-                `Pijin: Transaction failed. Recipient ID ${receiverShortId} was not found.`
-            ).catch((err) => console.error('[Settle] Failed to send recipient not found SMS:', err));
+            await enqueueSms(senderPhone, `Pijin: Transaction failed. Recipient ID ${receiverShortId} was not found.`, { req, traceId, dedupKey: `settle-fail-${traceId}` }).catch((err) => console.error('[Settle] Failed to send recipient not found SMS:', err));
         }
 
         return NextResponse.json(
@@ -500,10 +488,7 @@ export async function POST(req: Request, params?: unknown): Promise<Response> {
 
         if (senderPhone) {
             console.log(`[Settle] Attempting to send unregistered sender SMS to: ${maskPhoneNumber(senderPhone)}`);
-            await sendSms(
-                senderPhone,
-                `Pijin: Transaction failed. Sender account ${senderShortId} is not registered.`
-            ).catch(console.error);
+            await enqueueSms(senderPhone, `Pijin: Transaction failed. Sender account ${senderShortId} is not registered.`, { req, traceId, dedupKey: `settle-fail-${traceId}` }).catch(console.error);
         } else {
             console.warn('[Settle] Skipped sending unregistered sender SMS: senderPhone is empty');
         }
@@ -554,10 +539,7 @@ export async function POST(req: Request, params?: unknown): Promise<Response> {
             });
 
             if (senderPhone) {
-                await sendSms(
-                    senderPhone,
-                    `Pijin: Transaction failed. Recipient short ID ${receiverShortId} is not registered on-chain.`
-                ).catch((err) => console.error('[Settle] Failed to send error SMS:', err));
+                await enqueueSms(senderPhone, `Pijin: Transaction failed. Recipient short ID ${receiverShortId} is not registered on-chain.`, { req, traceId, dedupKey: `settle-fail-${traceId}` }).catch((err) => console.error('[Settle] Failed to send error SMS:', err));
             }
 
             return NextResponse.json(
@@ -583,10 +565,7 @@ export async function POST(req: Request, params?: unknown): Promise<Response> {
             });
             logOfflineTransactionDebug(traceId, 'db:failed', { settlementId, status: 'FAILED', failReason });
             if (senderPhone) {
-                await sendSms(
-                    senderPhone,
-                    `Pijin: Transaction failed. Offline device key is not enrolled.`
-                ).catch((err) => console.error('[Settle] Failed to send error SMS:', err));
+                await enqueueSms(senderPhone, `Pijin: Transaction failed. Offline device key is not enrolled.`, { req, traceId, dedupKey: `settle-fail-${traceId}` }).catch((err) => console.error('[Settle] Failed to send error SMS:', err));
             }
             return NextResponse.json({ success: false, status: 'FAILED', reason: failReason, traceId }, { status: 200 });
         }
@@ -709,10 +688,7 @@ export async function POST(req: Request, params?: unknown): Promise<Response> {
             logOfflineTransactionDebug(traceId, 'db:failed', { settlementId, status: 'FAILED', failReason });
 
             if (senderPhone) {
-                await sendSms(
-                    senderPhone,
-                    `Pijin: Transaction failed. Invalid voucher signature.`
-                ).catch((err) => console.error('[Settle] Failed to send error SMS:', err));
+                await enqueueSms(senderPhone, `Pijin: Transaction failed. Invalid voucher signature.`, { req, traceId, dedupKey: `settle-fail-${traceId}` }).catch((err) => console.error('[Settle] Failed to send error SMS:', err));
             }
 
             return NextResponse.json({ success: false, status: 'FAILED', reason: failReason, traceId }, { status: 200 });
@@ -797,29 +773,23 @@ export async function POST(req: Request, params?: unknown): Promise<Response> {
         const tokenSymbol = token.symbol;
         const shortRef = txHash ? txHash.substring(0, 8) : settlementId.toString();
 
-        const smsPromises: Promise<void>[] = [];
+        const smsPromises: Promise<unknown>[] = [];
 
         const senderRegisteredNumber = senderAccount.phoneNumber;
         if (senderRegisteredNumber) {
             smsPromises.push(
-                sendSmsNotification(
-                    senderRegisteredNumber,
-                    `Pijin: Transaction processed. Sent ${humanAmount} ${tokenSymbol} to ${receiverShortId}. Ref: ${shortRef}`,
-                )
+                enqueueSms(senderRegisteredNumber, `Pijin: Transaction processed. Sent ${humanAmount} ${tokenSymbol} to ${receiverShortId}. Ref: ${shortRef}`, { req, traceId, dedupKey: `settle-ok-${settlementId}-sender` })
             );
         }
 
         const receiverRegisteredNumber = receiverAccount.phoneNumber;
         if (receiverRegisteredNumber) {
             smsPromises.push(
-                sendSmsNotification(
-                    receiverRegisteredNumber,
-                    `Pijin: Transaction processed. Received ${humanAmount} ${tokenSymbol} from ${senderShortId}. Ref: ${shortRef}`,
-                )
+                enqueueSms(receiverRegisteredNumber, `Pijin: Transaction processed. Received ${humanAmount} ${tokenSymbol} from ${senderShortId}. Ref: ${shortRef}`, { req, traceId, dedupKey: `settle-ok-${settlementId}-receiver` })
             );
         }
 
-        // Wait for both SMS requests to hit the network, but ignore any 502 Textbee errors
+        // Queue both receipts (throttled delivery via /api/sms/dispatch); never fails the settlement
         if (smsPromises.length > 0) {
             await Promise.allSettled(smsPromises);
         }
@@ -854,21 +824,15 @@ export async function POST(req: Request, params?: unknown): Promise<Response> {
                     const tokenSymbol = token.symbol;
                     const shortRef = reconciliation.txHash ? reconciliation.txHash.substring(0, 8) : settlementId.toString();
 
-                    const smsPromises: Promise<void>[] = [];
+                    const smsPromises: Promise<unknown>[] = [];
                     if (senderAccount.phoneNumber) {
                         smsPromises.push(
-                            sendSmsNotification(
-                                senderAccount.phoneNumber,
-                                `Pijin: Transaction processed. Sent ${humanAmount} ${tokenSymbol} to ${receiverShortId}. Ref: ${shortRef}`,
-                            ),
+                            enqueueSms(senderAccount.phoneNumber, `Pijin: Transaction processed. Sent ${humanAmount} ${tokenSymbol} to ${receiverShortId}. Ref: ${shortRef}`, { req, traceId, dedupKey: `settle-ok-${settlementId}-sender` }),
                         );
                     }
                     if (receiverAccount.phoneNumber) {
                         smsPromises.push(
-                            sendSmsNotification(
-                                receiverAccount.phoneNumber,
-                                `Pijin: Transaction processed. Received ${humanAmount} ${tokenSymbol} from ${senderShortId}. Ref: ${shortRef}`,
-                            ),
+                            enqueueSms(receiverAccount.phoneNumber, `Pijin: Transaction processed. Received ${humanAmount} ${tokenSymbol} from ${senderShortId}. Ref: ${shortRef}`, { req, traceId, dedupKey: `settle-ok-${settlementId}-receiver` }),
                         );
                     }
                     if (smsPromises.length > 0) {
@@ -914,10 +878,7 @@ export async function POST(req: Request, params?: unknown): Promise<Response> {
 
         // Notify sender of permanent business-logic failure (e.g. insufficient balance).
         if (senderPhone) {
-            await sendSms(
-                senderPhone,
-                `Pijin: Transaction failed. ${normalizedFailureMessage || 'Please check your balance or voucher.'}`
-            ).catch((err) => console.error('[Settle] Failed to send error SMS:', err));
+            await enqueueSms(senderPhone, `Pijin: Transaction failed. ${normalizedFailureMessage || 'Please check your balance or voucher.'}`, { req, traceId, dedupKey: `settle-fail-${traceId}` }).catch((err) => console.error('[Settle] Failed to send error SMS:', err));
         }
 
         return NextResponse.json(
diff --git a/apps/backend/app/api/health/route.ts b/apps/backend/app/api/health/route.ts
index 695a9c3..e974fcb 100644
--- a/apps/backend/app/api/health/route.ts
+++ b/apps/backend/app/api/health/route.ts
@@ -10,6 +10,19 @@
  *       with the Node.js process uptime (seconds since start) and a server-side
  *       ISO 8601 timestamp. Use this endpoint for liveness probes in your
  *       deployment infrastructure (Vercel, Docker, Render).
+ *
+ *       `features.smsOtp` tells the mobile app whether OTP delivery is available.
+ *       With `?deep=1` the response adds `sms`: TextBee device state per role
+ *       (`online`, `offline`, `disabled`, `unknown`, `unconfigured`), cached 30s.
+ *       `status` becomes `degraded` when every configured device is offline or disabled.
+ *     parameters:
+ *       - in: query
+ *         name: deep
+ *         required: false
+ *         schema:
+ *           type: string
+ *           enum: ["1"]
+ *         description: Include TextBee device status.
  *     responses:
  *       '200':
  *         description: Service is healthy.
@@ -40,18 +53,39 @@
  *                   type: string
  *                   example: error
  */
-import { NextResponse } from 'next/server';
+import { NextRequest, NextResponse } from 'next/server';
+import { getSmsGateways } from '@/lib/sms';
+import { getTextbeeStatus } from '@/lib/sms-health';
 
 export const dynamic = "force-dynamic";
 
-export async function GET() {
+export async function GET(req: NextRequest) {
     try {
-        return NextResponse.json({
+        const deep = new URL(req.url).searchParams.get('deep') === '1';
+        const smsConfigured = getSmsGateways().length > 0;
+
+        const body: Record<string, unknown> = {
             status: 'healthy',
             uptime: process.uptime(),
             timestamp: new Date().toISOString(),
-        }, { status: 200 });
+            features: {
+                smsOtp: smsConfigured || process.env.OTP_TEST_MODE === 'true',
+            },
+        };
+
+        if (deep) {
+            // Device ids stay server-side; only the role and state are exposed.
+            const devices = await getTextbeeStatus();
+            body.sms = devices.map(({ role, status, lastHeartbeat, detail }) => ({ role, status, lastHeartbeat, detail }));
+            const anyOnline = devices.some((d) => d.status === 'online');
+            if (smsConfigured && !anyOnline && devices.some((d) => d.status !== 'unconfigured' && d.status !== 'unknown')) {
+                body.status = 'degraded';
+            }
+        }
+
+        return NextResponse.json(body, { status: 200 });
     } catch (error) {
+        console.error('[Health API]', error);
         return NextResponse.json({
             status: 'error',
         }, { status: 500 });
diff --git a/apps/backend/lib/settlement.ts b/apps/backend/lib/settlement.ts
index 583df1c..bac2fc8 100644
--- a/apps/backend/lib/settlement.ts
+++ b/apps/backend/lib/settlement.ts
@@ -1,6 +1,6 @@
 import { Keypair, TransactionBuilder } from "@stellar/stellar-sdk";
 import { prisma } from "@/lib/prisma";
-import { sendSmsReceipt } from "@/lib/textbee";
+import { enqueueSms } from "@/lib/sms-queue";
 import { contractConfig, pijinContract } from "@/lib/pijin-contract";
 import {
   buildOfflineSignatureXdr,
@@ -164,15 +164,12 @@ export async function processOfflineSettlement(
     },
   });
 
-  // Send SMS receipt to receiver (merchant) using pin/phoneNumber fields
-  const receiptMsg = `SUCCESS: Received ${amountStroops} stroops. PIN:${receiverAccount.pin ?? "0000"}`;
+  // Send SMS receipt to receiver (merchant). Never include the PIN.
+  const receiptMsg = `SUCCESS: Received ${amountStroops} stroops.`;
   const receiptPhone = normalizePhone(receiverAccount.phoneNumber);
   if (receiptPhone) {
-    void sendSmsReceipt(receiptPhone, receiptMsg).then((result) => {
-      if (!result.success) {
-        console.error(`[Textbee] Async SMS receipt failed: ${result.error}`);
-      }
-    });
+    // Awaited: a dangling promise can be frozen when the serverless function returns.
+    await enqueueSms(receiptPhone, receiptMsg, { dedupKey: `settlement-ok-${nonceB64}-receiver` });
   }
 
   return {
diff --git a/apps/backend/lib/sms.ts b/apps/backend/lib/sms.ts
index a4a8a99..3bd0d2e 100644
--- a/apps/backend/lib/sms.ts
+++ b/apps/backend/lib/sms.ts
@@ -1,11 +1,47 @@
 /**
- * Shared SMS notification utility.
+ * Unified TextBee SMS sender.
  *
- * Required environment variables:
- * TEXTBEE_GATEWAY_URL - Full Textbee device endpoint URL
- * TEXTBEE_API_KEY     - API key sent in the x-api-key header
+ * Every outbound SMS goes through `deliverSms`:
+ *  - recipient normalised to E.164 (PH local formats → +63)
+ *  - per-attempt timeout plus an overall deadline (keeps Vercel functions in budget)
+ *  - retries only on network errors / timeouts / 408 / 429 / 5xx — never on other 4xx
+ *  - optional SIM selection and an optional fallback device
+ *
+ * Environment variables:
+ * TEXTBEE_GATEWAY_URL           - Full primary device endpoint (or derive from TEXTBEE_DEVICE_ID)
+ * TEXTBEE_DEVICE_ID             - Primary device id
+ * TEXTBEE_API_KEY               - API key sent in the x-api-key header
+ * TEXTBEE_SIM_SUBSCRIPTION_ID   - Optional SIM slot on the primary device
+ * TEXTBEE_TIMEOUT_MS            - Per-attempt timeout (default 4500)
+ * TEXTBEE_RETRIES               - Retries per device (default 2)
+ * TEXTBEE_FALLBACK_GATEWAY_URL / TEXTBEE_FALLBACK_DEVICE_ID / TEXTBEE_FALLBACK_API_KEY /
+ * TEXTBEE_FALLBACK_SIM_SUBSCRIPTION_ID - Optional second device, tried when the primary fails.
  */
 
+const TEXTBEE_API_BASE = 'https://api.textbee.dev/api/v1/gateway/devices';
+const DEFAULT_DEADLINE_MS = 15_000;
+const MIN_ATTEMPT_MS = 500;
+
+export type SmsGateway = {
+    name: 'primary' | 'fallback';
+    url: string;
+    apiKey: string;
+    simSubscriptionId?: number;
+};
+
+export type SendSmsOptions = {
+    /** Retries per device after the first attempt. */
+    retries?: number;
+    /** Per-attempt timeout. */
+    timeoutMs?: number;
+    /** Overall budget across all attempts and devices. */
+    deadlineMs?: number;
+};
+
+export type SmsResult =
+    | { success: true; gateway: SmsGateway['name']; attempts: number; data?: unknown }
+    | { success: false; error: string; attempts: number; retryable: boolean };
+
 export function normalizeSmsRecipient(to: string): string | null {
     const compact = to.trim().replace(/[\s().-]/g, '');
 
@@ -19,36 +55,146 @@ export function normalizeSmsRecipient(to: string): string | null {
     return /^\+[1-9]\d{7,14}$/.test(normalized) ? normalized : null;
 }
 
-export async function sendSmsNotification(to: string, message: string): Promise<void> {
-    const formattedTo = normalizeSmsRecipient(to);
-    if (!formattedTo) {
-        console.warn(`[SMS] Skipped notification: invalid phone recipient "${to}"`);
-        throw new Error(`[SMS] Invalid phone recipient: "${to}"`);
-    }
+export function isRetryableStatus(status: number): boolean {
+    return status === 408 || status === 429 || status >= 500;
+}
 
-    const gatewayUrl = process.env.TEXTBEE_GATEWAY_URL;
-    const apiKey = process.env.TEXTBEE_API_KEY;
+function parseSimId(raw: string | undefined): number | undefined {
+    if (!raw || raw.trim().length === 0) return undefined;
+    const value = Number.parseInt(raw, 10);
+    return Number.isInteger(value) ? value : undefined;
+}
 
-    if (!gatewayUrl || !apiKey) {
-        console.error('[SMS] Missing Textbee config (TEXTBEE_GATEWAY_URL / TEXTBEE_API_KEY)');
-        throw new Error('[SMS] Missing Textbee config (TEXTBEE_GATEWAY_URL / TEXTBEE_API_KEY)');
+function resolveUrl(explicit: string | undefined, deviceId: string | undefined): string | undefined {
+    if (explicit?.trim()) return explicit.trim();
+    if (deviceId?.trim()) return `${TEXTBEE_API_BASE}/${deviceId.trim()}/send-sms`;
+    return undefined;
+}
+
+export function getSmsGateways(env: Record<string, string | undefined> = process.env): SmsGateway[] {
+    const gateways: SmsGateway[] = [];
+    const apiKey = env.TEXTBEE_API_KEY;
+
+    const primaryUrl = resolveUrl(env.TEXTBEE_GATEWAY_URL, env.TEXTBEE_DEVICE_ID) ?? env.TEXTBEE_TAILSCALE_URL;
+    if (primaryUrl && apiKey) {
+        gateways.push({
+            name: 'primary',
+            url: primaryUrl,
+            apiKey,
+            simSubscriptionId: parseSimId(env.TEXTBEE_SIM_SUBSCRIPTION_ID),
+        });
+    }
+
+    const fallbackUrl = resolveUrl(env.TEXTBEE_FALLBACK_GATEWAY_URL, env.TEXTBEE_FALLBACK_DEVICE_ID);
+    const fallbackKey = env.TEXTBEE_FALLBACK_API_KEY || apiKey;
+    if (fallbackUrl && fallbackKey && fallbackUrl !== primaryUrl) {
+        gateways.push({
+            name: 'fallback',
+            url: fallbackUrl,
+            apiKey: fallbackKey,
+            simSubscriptionId: parseSimId(env.TEXTBEE_FALLBACK_SIM_SUBSCRIPTION_ID),
+        });
     }
 
-    const response = await fetch(gatewayUrl, {
-        method: 'POST',
-        headers: {
-            'Content-Type': 'application/json',
-            'x-api-key': apiKey,
-        },
-        body: JSON.stringify({
-            recipients: [formattedTo],
-            message,
-        }),
+    return gateways;
+}
+
+const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
+
+async function sendViaGateway(
+    gateway: SmsGateway,
+    recipient: string,
+    message: string,
+    retries: number,
+    timeoutMs: number,
+    deadline: number,
+): Promise<SmsResult> {
+    const body = JSON.stringify({
+        recipients: [recipient],
+        message,
+        ...(gateway.simSubscriptionId !== undefined ? { simSubscriptionId: gateway.simSubscriptionId } : {}),
     });
 
-    if (!response.ok) {
+    let attempts = 0;
+    let lastError = 'No attempt made (deadline exhausted)';
+
+    for (let attempt = 1; attempt <= retries + 1; attempt++) {
+        const remaining = deadline - Date.now();
+        if (remaining < MIN_ATTEMPT_MS) break;
+        attempts = attempt;
+
+        let response: Response;
+        try {
+            response = await fetch(gateway.url, {
+                method: 'POST',
+                headers: { 'Content-Type': 'application/json', 'x-api-key': gateway.apiKey },
+                body,
+                signal: AbortSignal.timeout(Math.min(timeoutMs, remaining)),
+            });
+        } catch (err) {
+            const e = err as { message?: string; cause?: { code?: string } };
+            lastError = `${e?.message || 'Gateway unreachable'}${e?.cause?.code ? ` (${e.cause.code})` : ''}`;
+            console.warn(`[SMS] ${gateway.name} network error, attempt ${attempt}/${retries + 1}: ${lastError}`);
+            if (attempt <= retries) await sleep(Math.min(400 * attempt + Math.random() * 200, Math.max(0, deadline - Date.now())));
+            continue;
+        }
+
+        if (response.ok) {
+            const data = await response.json().catch(() => null);
+            return { success: true, gateway: gateway.name, attempts, data };
+        }
+
         const errorText = await response.text().catch(() => '');
-        throw new Error(`Textbee API Error: ${response.status} - ${errorText}`);
+        lastError = `HTTP ${response.status}: ${errorText || 'Unknown gateway error'}`;
+        console.warn(`[SMS] ${gateway.name} ${lastError}, attempt ${attempt}/${retries + 1}`);
+
+        if (!isRetryableStatus(response.status)) {
+            return { success: false, error: lastError, attempts, retryable: false };
+        }
+        if (attempt <= retries) await sleep(Math.min(400 * attempt + Math.random() * 200, Math.max(0, deadline - Date.now())));
+    }
+
+    return { success: false, error: lastError, attempts, retryable: true };
+}
+
+/** Sends one SMS. Never throws. */
+export async function deliverSms(to: string, message: string, options: SendSmsOptions = {}): Promise<SmsResult> {
+    const recipient = normalizeSmsRecipient(to);
+    if (!recipient) {
+        return { success: false, error: `Invalid phone recipient: "${to}"`, attempts: 0, retryable: false };
+    }
+
+    const gateways = getSmsGateways();
+    if (gateways.length === 0) {
+        return {
+            success: false,
+            error: 'Missing TextBee config (TEXTBEE_GATEWAY_URL or TEXTBEE_DEVICE_ID, and TEXTBEE_API_KEY)',
+            attempts: 0,
+            retryable: false,
+        };
+    }
+
+    const retries = options.retries ?? Number.parseInt(process.env.TEXTBEE_RETRIES ?? '2', 10);
+    const timeoutMs = options.timeoutMs ?? Number.parseInt(process.env.TEXTBEE_TIMEOUT_MS ?? '4500', 10);
+    const deadline = Date.now() + (options.deadlineMs ?? DEFAULT_DEADLINE_MS);
+
+    let attempts = 0;
+    let last: SmsResult = { success: false, error: 'No gateway attempted', attempts: 0, retryable: true };
+    for (const gateway of gateways) {
+        // Any primary failure (including 4xx such as a disabled device) is worth one try on the fallback.
+        const result = await sendViaGateway(gateway, recipient, message, retries, timeoutMs, deadline);
+        attempts += result.attempts;
+        if (result.success) return { ...result, attempts };
+        last = result;
+    }
+    return { ...last, attempts };
+}
+
+/** Throwing wrapper kept for existing callers. */
+export async function sendSmsNotification(to: string, message: string, options?: SendSmsOptions): Promise<void> {
+    const result = await deliverSms(to, message, options);
+    if (!result.success) {
+        throw new Error(`[SMS] ${result.error}`);
     }
 }
 
diff --git a/apps/backend/lib/textbee.ts b/apps/backend/lib/textbee.ts
index 151a079..88053b0 100644
--- a/apps/backend/lib/textbee.ts
+++ b/apps/backend/lib/textbee.ts
@@ -1,119 +1,15 @@
 /**
- * Reusable helper function to trigger the final SMS receipt to the merchant/customer.
- * Makes POST request to configured SMS gateway endpoint.
+ * Backwards-compatible receipt helper. All sending logic (timeouts, retry
+ * classification, SIM selection, fallback device) lives in `lib/sms.ts`.
  */
+import { deliverSms } from "@/lib/sms";
+
 export async function sendSmsReceipt(
   phoneNumber: string,
   message: string
-): Promise<{ success: boolean; data?: any; error?: string }> {
-  // Preferred: explicit gateway URL override.
-  // Default: official Textbee endpoint derived from TEXTBEE_DEVICE_ID.
-  const deviceId = process.env.TEXTBEE_DEVICE_ID?.trim();
-  const gatewayUrl =
-    process.env.TEXTBEE_GATEWAY_URL ??
-    (deviceId
-      ? `https://api.textbee.dev/api/v1/gateway/devices/${deviceId}/send-sms`
-      : process.env.TEXTBEE_TAILSCALE_URL);
-  const apiKey = process.env.TEXTBEE_API_KEY;
-  const simSubscriptionIdRaw = process.env.TEXTBEE_SIM_SUBSCRIPTION_ID;
-  const simSubscriptionId =
-    simSubscriptionIdRaw && simSubscriptionIdRaw.trim().length > 0
-      ? Number.parseInt(simSubscriptionIdRaw, 10)
-      : undefined;
-  const timeoutMs = Number.parseInt(process.env.TEXTBEE_TIMEOUT_MS ?? "4500", 10);
-  const maxRetries = Number.parseInt(process.env.TEXTBEE_RETRIES ?? "2", 10);
-
-  if (!gatewayUrl) {
-    return {
-      success: false,
-      error: "Missing TEXTBEE endpoint config (set TEXTBEE_GATEWAY_URL or TEXTBEE_DEVICE_ID)",
-    };
-  }
-  if (!apiKey) {
-    return {
-      success: false,
-      error: "Missing TEXTBEE_API_KEY",
-    };
-  }
-
-  try {
-    const headers: Record<string, string> = {
-      "Content-Type": "application/json",
-      "x-api-key": apiKey,
-    };
-
-    const payload = {
-      recipients: [phoneNumber],
-      message,
-      ...(Number.isInteger(simSubscriptionId)
-        ? { simSubscriptionId }
-        : {}),
-    };
-
-    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
-      let response: Response;
-      try {
-        response = await fetch(gatewayUrl, {
-          method: "POST",
-          headers,
-          body: JSON.stringify(payload),
-          signal: AbortSignal.timeout(timeoutMs),
-        });
-      } catch (networkError: any) {
-        console.error(
-          `[Textbee] Network error on attempt ${attempt}/${maxRetries + 1}:`,
-          networkError?.message ?? networkError
-        );
-        if (attempt <= maxRetries) {
-          await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
-          continue;
-        }
-        const causeCode = networkError?.cause?.code ? ` (${networkError.cause.code})` : "";
-        return {
-          success: false,
-          error: `${networkError?.message || "Gateway unreachable"}${causeCode}`,
-        };
-      }
-
-      if (!response.ok) {
-        const errText = await response.text();
-        console.error(
-          `[Textbee] Gateway status ${response.status} on attempt ${attempt}/${maxRetries + 1}:`,
-          errText
-        );
-        if (attempt <= maxRetries) {
-          await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
-          continue;
-        }
-        return {
-          success: false,
-          error: `HTTP ${response.status}: ${errText || "Unknown Gateway error"}`,
-        };
-      }
-
-      let responseData: any = null;
-      try {
-        responseData = await response.json();
-      } catch {
-        responseData = { message: "No JSON response" };
-      }
-
-      return {
-        success: true,
-        data: responseData,
-      };
-    }
-    return {
-      success: false,
-      error: "Exhausted retry attempts",
-    };
-
-  } catch (error: any) {
-    const causeCode = error?.cause?.code ? ` (${error.cause.code})` : "";
-    console.error("[Textbee] Failed to send SMS via Gateway:", error);
-    return {
-      success: false,
-      error: `${error.message || "Failed to connect to local Tailscale Android Gateway"}${causeCode}`,
-    };
-  }
+): Promise<{ success: boolean; data?: unknown; error?: string }> {
+  const result = await deliverSms(phoneNumber, message);
+  return result.success
+    ? { success: true, data: result.data }
+    : { success: false, error: result.error };
 }
diff --git a/apps/mobile/src/screens/OnboardingScreen.tsx b/apps/mobile/src/screens/OnboardingScreen.tsx
index 8b74bfe..18ec3d0 100644
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
@@ -61,6 +62,14 @@ import { getApiBaseUrl } from '../constants/api';
 // ---------------------------------------------------------------------------
 const API_URL = getApiBaseUrl();
 const FRIENDBOT_RETRY_DELAY_MS = 2_000;
+const OTP_RESEND_COOLDOWN_SECONDS = 60;
+
+/** 75 → "1:15" */
+function formatCooldown(seconds: number): string {
+  const m = Math.floor(seconds / 60);
+  const s = seconds % 60;
+  return `${m}:${s.toString().padStart(2, '0')}`;
+}
 
 
 // Enable LayoutAnimation on Android
@@ -96,6 +105,14 @@ export function OnboardingScreen() {
   const [isRegistering, setIsRegistering] = useState(false);
   const [isSendingOtp, setIsSendingOtp] = useState(false);
   const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);
+  // Seconds until "Resend" is available again (0 = available).
+  const [resendCooldown, setResendCooldown] = useState(0);
+
+  useEffect(() => {
+    if (resendCooldown <= 0) return;
+    const timer = setTimeout(() => setResendCooldown((s) => Math.max(0, s - 1)), 1000);
+    return () => clearTimeout(timer);
+  }, [resendCooldown]);
 
   // Phone form
   const [phoneNumber, setPhoneNumber] = useState('');
@@ -109,6 +126,8 @@ export function OnboardingScreen() {
 
   // OTP
   const [otp, setOtp] = useState('');
+  // Proof of phone ownership from /api/otp/verify, required by /api/register.
+  const verificationTokenRef = useRef<string | null>(null);
 
   // Name & Info (new users only)
   const [firstName, setFirstName] = useState('');
@@ -242,10 +261,25 @@ export function OnboardingScreen() {
         json = { error: responseText || `Request failed with status ${response.status}` };
       }
 
+      if (response.status === 429) {
+        // Respect the server's window so the countdown matches when a resend will succeed.
+        const retryAfter = Number(response.headers.get('Retry-After'));
+        const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.ceil(retryAfter) : OTP_RESEND_COOLDOWN_SECONDS;
+        setResendCooldown(wait);
+        throw new Error(`Too many code requests. Please try again in ${formatCooldown(wait)}.`);
+      }
+
+      if (response.status === 502 || json.code === 'SMS_FAILED') {
+        // Nothing was sent, so let the user retry immediately.
+        setResendCooldown(0);
+        throw new Error("We couldn't send the SMS. Please check your number and try again.");
+      }
+
       if (!response.ok || !json.success) {
         throw new Error(json.error ?? 'Failed to send OTP. Please try again.');
       }
 
+      setResendCooldown(OTP_RESEND_COOLDOWN_SECONDS);
       navigateToStep(3);
     } catch (e: any) {
       console.error('handleSendOtp error:', e);
@@ -280,6 +314,8 @@ export function OnboardingScreen() {
       if (!response.ok || !json.success) {
         throw new Error(json.error ?? 'Invalid OTP. Please try again.');
       }
+      verificationTokenRef.current =
+        typeof json.verificationToken === 'string' ? json.verificationToken : null;
       // OTP verified — proceed based on user flow
       if (userFlowType === 'returning') {
         navigation.replace('SignIn');
@@ -440,6 +476,7 @@ export function OnboardingScreen() {
         firstName,
         lastName,
         email,
+        verificationToken: verificationTokenRef.current ?? undefined,
       };
       const account = await registerAccount(registrationPayload);
 
@@ -467,6 +504,20 @@ export function OnboardingScreen() {
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
@@ -685,11 +736,18 @@ export function OnboardingScreen() {
                 style={styles.resendContainer}
                 activeOpacity={0.7}
                 onPress={handleSendOtp}
-                disabled={isSendingOtp}
+                disabled={isSendingOtp || resendCooldown > 0}
+                accessibilityRole="button"
+                accessibilityState={{ disabled: isSendingOtp || resendCooldown > 0, busy: isSendingOtp }}
+                accessibilityLabel={
+                  resendCooldown > 0 ? `Resend code available in ${resendCooldown} seconds` : 'Resend code'
+                }
               >
                 <Text style={styles.resendTextMuted}>Didn't get an OTP? </Text>
                 {isSendingOtp ? (
                   <ActivityIndicator size="small" color="#FFFFFF" />
+                ) : resendCooldown > 0 ? (
+                  <Text style={styles.resendTextMuted}>Resend in {formatCooldown(resendCooldown)}</Text>
                 ) : (
                   <Text style={styles.resendTextLink}>Resend</Text>
                 )}
```

</details>

<details><summary>New files</summary>

```diff
diff --git a/apps/backend/lib/sms-queue.ts b/apps/backend/lib/sms-queue.ts
new file mode 100644
index 0000000..d31086c
--- /dev/null
+++ b/apps/backend/lib/sms-queue.ts
@@ -0,0 +1,84 @@
+/**
+ * @file lib/sms-queue.ts
+ *
+ * Low-priority SMS (payment receipts, settlement notices) are queued on QStash
+ * and delivered by `/api/sms/dispatch`, throttled so they never starve OTPs on
+ * the single TextBee SIM. OTPs are sent inline by `/api/otp/send` instead.
+ *
+ * If QStash is unavailable the message is delivered directly so nothing is lost.
+ */
+
+import { Client } from "@upstash/qstash";
+import { deliverSms } from "@/lib/sms";
+
+export const SMS_QUEUE_FLOW_KEY = "pijin-sms-notifications";
+export const SMS_QUEUE_RATE_PER_MIN = 10;
+export const SMS_QUEUE_PARALLELISM = 1;
+export const SMS_QUEUE_RETRIES = 3;
+
+export type SmsJob = { to: string; message: string; traceId?: string };
+
+export type EnqueueResult = { queued: true; messageId: string } | { queued: false; delivered: boolean; error?: string };
+
+let qstashClient: Client | null = null;
+
+function getQstash(): Client | null {
+  if (!process.env.QSTASH_TOKEN) return null;
+  if (!qstashClient) qstashClient = new Client({ token: process.env.QSTASH_TOKEN });
+  return qstashClient;
+}
+
+/** Same resolution as the SMS webhook: the request host so Vercel previews route to themselves. */
+export function resolveAppUrl(req?: Request): string | null {
+  const host = req?.headers.get("host");
+  if (host) {
+    const protocol = host.includes("localhost") ? "http" : "https";
+    return `${protocol}://${host}`;
+  }
+  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || null;
+}
+
+/** QStash deduplication ids must be URL-safe. */
+function toDedupId(raw: string): string {
+  return raw.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 200);
+}
+
+/**
+ * Queues an SMS for throttled delivery. Never throws.
+ * `dedupKey` makes retries of the calling job (e.g. a QStash-retried settle) send once.
+ */
+export async function enqueueSms(
+  to: string,
+  message: string,
+  options: { req?: Request; traceId?: string; dedupKey?: string } = {},
+): Promise<EnqueueResult> {
+  const qstash = getQstash();
+  const appUrl = resolveAppUrl(options.req);
+
+  if (qstash && appUrl) {
+    try {
+      const body: SmsJob = { to, message, traceId: options.traceId };
+      const { messageId } = await qstash.publishJSON({
+        url: `${appUrl}/api/sms/dispatch`,
+        body,
+        retries: SMS_QUEUE_RETRIES,
+        flowControl: {
+          key: SMS_QUEUE_FLOW_KEY,
+          rate: SMS_QUEUE_RATE_PER_MIN,
+          period: "1m",
+          parallelism: SMS_QUEUE_PARALLELISM,
+        },
+        ...(options.dedupKey ? { deduplicationId: toDedupId(options.dedupKey) } : {}),
+      });
+      return { queued: true, messageId };
+    } catch (err) {
+      console.error("[SMS Queue] QStash publish failed, delivering directly:", err);
+    }
+  } else {
+    console.warn("[SMS Queue] QStash or app URL not configured, delivering directly");
+  }
+
+  const result = await deliverSms(to, message);
+  if (!result.success) console.error(`[SMS Queue] Direct delivery failed: ${result.error}`);
+  return { queued: false, delivered: result.success, ...(result.success ? {} : { error: result.error }) };
+}
diff --git a/apps/backend/app/api/sms/dispatch/route.ts b/apps/backend/app/api/sms/dispatch/route.ts
new file mode 100644
index 0000000..cc68208
--- /dev/null
+++ b/apps/backend/app/api/sms/dispatch/route.ts
@@ -0,0 +1,71 @@
+
+/**
+ * @swagger
+ * /api/sms/dispatch:
+ *   post:
+ *     tags:
+ *       - SMS
+ *     summary: QStash worker that delivers queued notification SMS
+ *     description: |
+ *       Internal endpoint invoked **only by QStash** (signature verified with
+ *       `QSTASH_CURRENT_SIGNING_KEY` / `QSTASH_NEXT_SIGNING_KEY`). Jobs are published by
+ *       `enqueueSms()` with flow control (10 / min, parallelism 1) so receipts never
+ *       starve OTP delivery on the TextBee SIM.
+ *
+ *       - `200` delivered, or permanently undeliverable (no retry).
+ *       - `500` transient gateway failure → QStash retries, then dead-letters.
+ *     responses:
+ *       '200':
+ *         description: Delivered or permanently failed.
+ *       '400':
+ *         description: Malformed job body.
+ *       '401':
+ *         description: Missing or invalid QStash signature.
+ *       '500':
+ *         description: Transient failure; QStash will retry.
+ */
+import { NextResponse } from "next/server";
+import { verifyQStashSignature } from "@/lib/qstash-security";
+import { deliverSms } from "@/lib/sms";
+import { maskPhoneNumber } from "@/lib/sms-security";
+import type { SmsJob } from "@/lib/sms-queue";
+
+export const runtime = "nodejs";
+export const dynamic = "force-dynamic";
+
+export async function POST(req: Request) {
+  const rawBody = await req.text();
+
+  const verification = await verifyQStashSignature(req, rawBody);
+  if (!verification.valid) {
+    console.warn(`[SMS Dispatch] Rejected: ${verification.error}`);
+    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
+  }
+
+  let job: SmsJob;
+  try {
+    job = JSON.parse(rawBody);
+  } catch {
+    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
+  }
+  if (typeof job?.to !== "string" || typeof job?.message !== "string" || !job.message) {
+    return NextResponse.json({ error: "Job requires `to` and `message`" }, { status: 400 });
+  }
+
+  // QStash owns retries; one gateway attempt per device keeps the function short.
+  const result = await deliverSms(job.to, job.message, { retries: 0, deadlineMs: 9_000 });
+  const trace = job.traceId ? ` traceId=${job.traceId}` : "";
+
+  if (result.success) {
+    console.info(`[SMS Dispatch] Delivered to ${maskPhoneNumber(job.to)} via ${result.gateway}${trace}`);
+    return NextResponse.json({ success: true });
+  }
+
+  if (result.retryable) {
+    console.warn(`[SMS Dispatch] Transient failure for ${maskPhoneNumber(job.to)}: ${result.error}${trace}`);
+    return NextResponse.json({ error: "SMS delivery failed, will retry" }, { status: 500 });
+  }
+
+  console.error(`[SMS Dispatch] Permanent failure for ${maskPhoneNumber(job.to)}: ${result.error}${trace}`);
+  return NextResponse.json({ success: false, error: "Undeliverable" });
+}
diff --git a/apps/backend/lib/sms-health.ts b/apps/backend/lib/sms-health.ts
new file mode 100644
index 0000000..293c9ea
--- /dev/null
+++ b/apps/backend/lib/sms-health.ts
@@ -0,0 +1,94 @@
+/**
+ * @file lib/sms-health.ts
+ *
+ * TextBee device status for `/api/health?deep=1`. Uses the TextBee device list
+ * (`GET /gateway/devices`) and caches the answer in Redis for 30s so health
+ * polling never hammers the gateway. Unknown response shapes degrade to
+ * `status: "unknown"` instead of failing.
+ */
+
+import { getRedis } from "@/lib/rate-limit";
+
+const DEVICES_URL = "https://api.textbee.dev/api/v1/gateway/devices";
+const CACHE_KEY = "pijin:health:textbee";
+const CACHE_TTL_SECONDS = 30;
+const STALE_HEARTBEAT_MS = 10 * 60 * 1000;
+
+export type DeviceStatus = {
+  role: "primary" | "fallback";
+  deviceId: string | null;
+  status: "online" | "offline" | "disabled" | "unknown" | "unconfigured";
+  lastHeartbeat?: string;
+  detail?: string;
+};
+
+type DeviceRecord = Record<string, unknown>;
+
+function heartbeatOf(device: DeviceRecord): string | undefined {
+  const value = device.lastHeartbeat ?? device.updatedAt;
+  return typeof value === "string" ? value : undefined;
+}
+
+export function classifyDevice(device: DeviceRecord | undefined, now = Date.now()): Pick<DeviceStatus, "status" | "lastHeartbeat" | "detail"> {
+  if (!device) return { status: "unknown", detail: "Device not found in TextBee account" };
+  if (device.enabled === false) return { status: "disabled", lastHeartbeat: heartbeatOf(device) };
+  const lastHeartbeat = heartbeatOf(device);
+  if (!lastHeartbeat) return { status: "unknown", detail: "No heartbeat reported" };
+  const age = now - Date.parse(lastHeartbeat);
+  if (Number.isNaN(age)) return { status: "unknown", lastHeartbeat };
+  return { status: age <= STALE_HEARTBEAT_MS ? "online" : "offline", lastHeartbeat };
+}
+
+async function fetchDevices(apiKey: string): Promise<DeviceRecord[]> {
+  const response = await fetch(DEVICES_URL, {
+    headers: { "x-api-key": apiKey },
+    signal: AbortSignal.timeout(3000),
+    cache: "no-store",
+  });
+  if (!response.ok) throw new Error(`HTTP ${response.status}`);
+  const json = (await response.json()) as { data?: unknown };
+  return Array.isArray(json?.data) ? (json.data as DeviceRecord[]) : [];
+}
+
+async function loadStatuses(): Promise<DeviceStatus[]> {
+  const targets: Array<{ role: DeviceStatus["role"]; deviceId?: string; apiKey?: string }> = [
+    { role: "primary", deviceId: process.env.TEXTBEE_DEVICE_ID?.trim(), apiKey: process.env.TEXTBEE_API_KEY },
+    {
+      role: "fallback",
+      deviceId: process.env.TEXTBEE_FALLBACK_DEVICE_ID?.trim(),
+      apiKey: process.env.TEXTBEE_FALLBACK_API_KEY || process.env.TEXTBEE_API_KEY,
+    },
+  ];
+
+  const devicesByKey = new Map<string, Promise<DeviceRecord[]>>();
+  return Promise.all(
+    targets.map(async ({ role, deviceId, apiKey }): Promise<DeviceStatus> => {
+      if (!deviceId || !apiKey) return { role, deviceId: deviceId ?? null, status: "unconfigured" };
+      try {
+        if (!devicesByKey.has(apiKey)) devicesByKey.set(apiKey, fetchDevices(apiKey));
+        const devices = await devicesByKey.get(apiKey)!;
+        const device = devices.find((d) => d._id === deviceId || d.id === deviceId);
+        return { role, deviceId, ...classifyDevice(device) };
+      } catch (err) {
+        return { role, deviceId, status: "unknown", detail: err instanceof Error ? err.message : String(err) };
+      }
+    }),
+  );
+}
+
+export async function getTextbeeStatus(): Promise<DeviceStatus[]> {
+  const redis = getRedis();
+  try {
+    const cached = await redis.get<DeviceStatus[]>(CACHE_KEY);
+    if (cached) return cached;
+  } catch {
+    // Cache is best-effort.
+  }
+  const statuses = await loadStatuses();
+  try {
+    await redis.set(CACHE_KEY, statuses, { ex: CACHE_TTL_SECONDS });
+  } catch {
+    // Cache is best-effort.
+  }
+  return statuses;
+}
diff --git a/apps/backend/lib/sms-delivery.test.ts b/apps/backend/lib/sms-delivery.test.ts
new file mode 100644
index 0000000..593cf4d
--- /dev/null
+++ b/apps/backend/lib/sms-delivery.test.ts
@@ -0,0 +1,154 @@
+/**
+ * @file lib/sms-delivery.test.ts
+ *
+ * Test suite for the unified TextBee sender and related SMS helpers:
+ *  - Retry classification (network / 5xx / 429 retried, other 4xx not)
+ *  - Fallback device, SIM selection, deadline budget
+ *  - Tester OTP gate (OTP_TEST_MODE)
+ *  - TextBee device health classification
+ */
+
+import assert from 'node:assert/strict';
+import test, { afterEach, beforeEach } from 'node:test';
+import { deliverSms, getSmsGateways, isRetryableStatus, normalizeSmsRecipient } from './sms';
+import { getTestOtpCode } from './otp';
+import { classifyDevice } from './sms-health';
+
+type Call = { url: string; body: Record<string, unknown> };
+
+const realFetch = globalThis.fetch;
+const savedEnv = { ...process.env };
+let calls: Call[] = [];
+
+function mockFetch(responses: Array<number | 'network'>) {
+    let i = 0;
+    globalThis.fetch = (async (url: string, init?: RequestInit) => {
+        calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) });
+        const next = responses[Math.min(i++, responses.length - 1)];
+        if (next === 'network') throw new TypeError('fetch failed');
+        return new Response(next < 300 ? '{"ok":true}' : 'err', { status: next });
+    }) as typeof fetch;
+}
+
+beforeEach(() => {
+    calls = [];
+    for (const key of Object.keys(process.env)) {
+        if (key.startsWith('TEXTBEE_') || key.startsWith('OTP_TEST')) delete process.env[key];
+    }
+    process.env.TEXTBEE_GATEWAY_URL = 'https://primary.test/send-sms';
+    process.env.TEXTBEE_API_KEY = 'key';
+});
+
+afterEach(() => {
+    globalThis.fetch = realFetch;
+    process.env = { ...savedEnv };
+});
+
+// ─────────────────────────────────────────────────────────────────────────────
+// Retry classification
+// ─────────────────────────────────────────────────────────────────────────────
+
+test('isRetryableStatus: 408/429/5xx only', () => {
+    for (const s of [408, 429, 500, 502, 503]) assert.equal(isRetryableStatus(s), true, String(s));
+    for (const s of [400, 401, 403, 404, 422]) assert.equal(isRetryableStatus(s), false, String(s));
+});
+
+test('deliverSms: retries a 5xx then succeeds', async () => {
+    mockFetch([503, 200]);
+    const result = await deliverSms('09171234567', 'hi', { retries: 2 });
+    assert.equal(result.success, true);
+    assert.equal(result.attempts, 2);
+    assert.equal(calls.length, 2);
+    assert.deepEqual(calls[0].body.recipients, ['+639171234567']);
+});
+
+test('deliverSms: does not retry a 4xx', async () => {
+    mockFetch([400, 200]);
+    const result = await deliverSms('+639171234567', 'hi', { retries: 2 });
+    assert.equal(result.success, false);
+    assert.equal(calls.length, 1);
+    if (!result.success) assert.equal(result.retryable, false);
+});
+
+test('deliverSms: retries network errors and reports retryable failure', async () => {
+    mockFetch(['network']);
+    const result = await deliverSms('+639171234567', 'hi', { retries: 1 });
+    assert.equal(result.success, false);
+    assert.equal(calls.length, 2);
+    if (!result.success) assert.equal(result.retryable, true);
+});
+
+test('deliverSms: falls back to the second device', async () => {
+    process.env.TEXTBEE_FALLBACK_GATEWAY_URL = 'https://fallback.test/send-sms';
+    process.env.TEXTBEE_FALLBACK_SIM_SUBSCRIPTION_ID = '2';
+    mockFetch([500, 200]);
+    const result = await deliverSms('+639171234567', 'hi', { retries: 0 });
+    assert.equal(result.success, true);
+    if (result.success) assert.equal(result.gateway, 'fallback');
+    assert.equal(calls[1].url, 'https://fallback.test/send-sms');
+    assert.equal(calls[1].body.simSubscriptionId, 2);
+});
+
+test('deliverSms: rejects invalid recipients without calling the gateway', async () => {
+    mockFetch([200]);
+    const result = await deliverSms('123', 'hi');
+    assert.equal(result.success, false);
+    assert.equal(calls.length, 0);
+});
+
+test('deliverSms: missing config is a permanent failure', async () => {
+    delete process.env.TEXTBEE_GATEWAY_URL;
+    mockFetch([200]);
+    const result = await deliverSms('+639171234567', 'hi');
+    assert.equal(result.success, false);
+    if (!result.success) assert.equal(result.retryable, false);
+});
+
+test('deliverSms: respects the overall deadline', async () => {
+    mockFetch(['network']);
+    const started = Date.now();
+    await deliverSms('+639171234567', 'hi', { retries: 10, deadlineMs: 1500 });
+    assert.ok(Date.now() - started < 2500, 'should stop near the deadline');
+});
+
+test('getSmsGateways: derives URL from device id and skips duplicate fallback', () => {
+    delete process.env.TEXTBEE_GATEWAY_URL;
+    process.env.TEXTBEE_DEVICE_ID = 'abc';
+    process.env.TEXTBEE_FALLBACK_DEVICE_ID = 'abc';
+    const gateways = getSmsGateways();
+    assert.equal(gateways.length, 1);
+    assert.equal(gateways[0].url, 'https://api.textbee.dev/api/v1/gateway/devices/abc/send-sms');
+});
+
+test('normalizeSmsRecipient: PH formats', () => {
+    assert.equal(normalizeSmsRecipient('0917 123 4567'), '+639171234567');
+    assert.equal(normalizeSmsRecipient('639171234567'), '+639171234567');
+    assert.equal(normalizeSmsRecipient('abc'), null);
+});
+
+// ─────────────────────────────────────────────────────────────────────────────
+// Tester OTP gate
+// ─────────────────────────────────────────────────────────────────────────────
+
+test('getTestOtpCode: only when enabled, valid code and allow-listed', () => {
+    const env = { OTP_TEST_MODE: 'true', OTP_TEST_CODE: '123456', OTP_TEST_NUMBERS: '09171234567, +639990000000' };
+    assert.equal(getTestOtpCode('+639171234567', env), '123456');
+    assert.equal(getTestOtpCode('639990000000', env), '123456');
+    assert.equal(getTestOtpCode('+639181111111', env), null);
+    assert.equal(getTestOtpCode('+639171234567', { ...env, OTP_TEST_MODE: 'false' }), null);
+    assert.equal(getTestOtpCode('+639171234567', { ...env, OTP_TEST_CODE: '12' }), null);
+    assert.equal(getTestOtpCode('+639171234567', {}), null);
+});
+
+// ─────────────────────────────────────────────────────────────────────────────
+// Device health
+// ─────────────────────────────────────────────────────────────────────────────
+
+test('classifyDevice: online, offline, disabled, unknown', () => {
+    const now = Date.parse('2026-10-13T12:00:00Z');
+    assert.equal(classifyDevice({ enabled: true, lastHeartbeat: '2026-10-13T11:58:00Z' }, now).status, 'online');
+    assert.equal(classifyDevice({ enabled: true, lastHeartbeat: '2026-10-13T10:00:00Z' }, now).status, 'offline');
+    assert.equal(classifyDevice({ enabled: false }, now).status, 'disabled');
+    assert.equal(classifyDevice({ enabled: true }, now).status, 'unknown');
+    assert.equal(classifyDevice(undefined, now).status, 'unknown');
+});
```

</details>

> Note: `otp/send/route.ts`, `lib/otp.ts`, `.env.example` and `OnboardingScreen.tsx` also contain uncommitted task 1.1 changes; the OnboardingScreen diff above includes both tasks. See task-1.1-changes.md for the 1.1 parts.
