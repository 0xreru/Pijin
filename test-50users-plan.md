# Pijin – Testnet Hardening & 50-User Readiness Plan

> Read-only scan of `apps/mobile` and `apps/backend` (the mobile app depends on the backend for every critical path). **No project files were modified.**
> Items marked ✅ are from your original list; 🆕 are things I found that were missing.
>
> **Progress (updated 2026-10-13):** §1.1 Secure the Sign-Up Process and §1.2 Optimize TextBee are **code-complete**; §3.1 Mobile Reliability is **mostly complete** (onboarding state machine and Sentry pending). All on `rixdev`, uncommitted, not yet deployed. Review: [task-1.1-changes.md](task-1.1-changes.md), [task-1.2-changes.md](task-1.2-changes.md), [task-3.1-changes.md](task-3.1-changes.md). Legend: `[x]` done · `[~]` partially done · `[ ]` open.

---

## 0. Top Risks at a Glance

| # | Risk | Severity | Why it matters at 50 users | Status |
|---|------|----------|----------------------------|--------|
| 1 | 🆕 `GET /api/users/check?phone=` **returns the user's plaintext PIN** | 🔴 Critical | Anyone who knows a phone number can read the PIN. | ✅ Fixed (§1.1) |
| 2 | 🆕 PIN stored **plaintext** in DB (`Account.pin`) and sent in SMS receipts (`lib/settlement.ts`: `PIN:${pin ?? "0000"}`) | 🔴 Critical | Leaks via DB, SMS, logs. | ✅ Fixed – new PINs hashed, PIN removed from SMS; legacy rows re-hashed on next server verify |
| 3 | 🆕 `/api/register` has **no auth, no OTP proof, no rate limit** | 🔴 Critical | OTP verify is only client-side navigation; anyone can register/spam accounts. | ✅ Fixed – rate limit + OTP token (enforced once `REQUIRE_OTP_TOKEN=true`) |
| 4 | 🆕 OTP verify has **no attempt limit** (6-digit, 5 min TTL) | 🔴 High | Brute-forceable (1M combos). | ✅ Fixed – 5 attempts then code burned |
| 5 | 🆕 OTP **logged in plaintext** (`console.info ... GENERATED CODE`) | 🟠 High | Leaks in Vercel logs. | ✅ Fixed – dev-only log |
| 6 | 🆕 **Single shared relayer account** signs settle/deposit/transfer | 🟠 High | Sequence-number collisions (`tx_bad_seq`) under concurrency. | ⏳ Open (§2.1) |
| 7 | 🆕 Friendbot called from **one backend IP** for all signups | 🟠 High | Friendbot rate-limits per IP → mass onboarding fails. | 🟡 Partial – proxy rate-limited; single-IP problem remains (§2.2) |
| 8 | 🆕 Soroban RPC polling from every device against public testnet RPC | 🟠 Medium | Public RPC rate limits (429). | ⏳ Open |
| 9 | 🆕 Two divergent SMS senders (`lib/sms.ts` vs `lib/textbee.ts`) | 🟠 Medium | Only one has retry/timeout; OTP path uses the weaker one. | ✅ Fixed – single sender in `lib/sms.ts` (§1.2) |
| 10 | 🆕 OTP send awaits SMS inline | 🟠 Medium | Slow/failing TextBee blocks API (Vercel timeout) and UX. | 🟡 Mitigated – OTP stays inline by design but capped at 8s and returns `502` on failure; receipts moved to a queue (§1.2) |

---

## 1. Your Original Tasks – Expanded

### 1.1 ✅ Secure the Sign-Up Process (P0) — 🟢 code-complete, pending deploy

> **Status:** implemented on `rixdev` (uncommitted). Details, diff and test checklist: [task-1.1-changes.md](task-1.1-changes.md).
> **Remaining rollout:** set `OTP_VERIFICATION_JWT_SECRET` in Vercel → deploy backend → ship new APK → set `REQUIRE_OTP_TOKEN=true`.

**Findings**
- `apps/backend/app/api/register/route.ts`: no rate limit, no verification that the phone was OTP-verified, role accepts `ADMIN` from the client (!), PIN saved as-is, email/name unvalidated.
- `apps/backend/app/api/users/check/route.ts` returns `pin` → must be removed immediately.
- `OnboardingScreen.tsx`: OTP verification only advances the UI (`navigateToStep(4)`); nothing server-side ties the verified phone to `/api/register`.
- Returning-user flow compares PIN client-side against server-provided PIN (follows from #1).
- Phone not unique and not indexed (`Account.phoneNumber`); `findFirst` on unindexed column → duplicates + slow lookups.
- PIN is only 4 digits.
- Registration is a long sequential chain on the device (Friendbot → trustline → register → SEP-10 → registry sync → offline key sync); a failure midway leaves orphaned state, and retries can hit the `409`.

**Tasks**
- [x] **Remove `pin` from `/api/users/check` response.** Now returns `exists`, `stellarPublicKey`, `shortId` (PIN never selected).
- [x] Hash PINs server-side (`crypto.scrypt`, `lib/pin.ts`); never put PIN in SMS (`settlement.ts`).
- [~] Migrate existing rows: legacy plaintext PINs are re-hashed only when verified via `/api/auth/pin/verify`. **Open:** one-off script to hash all remaining rows.
- [x] Make PIN verification a server endpoint with attempt counter + lockout (5 tries → 15 min) – `POST /api/auth/pin/verify`; mobile `SignInScreen` uses it.
- [x] `/api/otp/verify` returns a short-lived signed **verification token** (JWT, bound to phone; **30 min** to cover seed-phrase backup); `/api/register` validates it, mandatory when `REQUIRE_OTP_TOKEN=true`. Mobile Onboarding sends it.
- [x] Reject `role: ADMIN` from public register (force `USER`).
- [x] Rate-limit `/api/register` (30/10m), `/api/users/check` (60/m), `/api/users/lookup` (300/m), `/api/friendbot` (20/m IP + 3/h key) – shared `lib/rate-limit.ts`.
- [x] OTP: max 5 verify attempts per code then invalidate; use `crypto.randomInt(0, 1_000_000)` zero-padded (current range is 100000–999999, slightly biased/short); compare with `timingSafeEqual`; remove OTP console log in production.
- [x] OTP rate limit key uses `x-forwarded-for` raw (spoofable list) → take first IP; also add **per-phone** and **global** limits (protects TextBee SIM quota).
- [~] Add `@unique` on `Account.phoneNumber` + index; normalize to E.164 once. **Done:** single normaliser (`lib/otp.ts` `toDbPhone`) and duplicate-phone `409` in `/register`. **Deferred:** DB migration (check prod for duplicate phones first).
- [x] Validation for request bodies (email, names length, phone, PIN format) – hand-written, Zod not added.
- [ ] *(deferred)* Make onboarding **resumable/idempotent**: persist progress so a crash after Friendbot doesn't force a re-run; handle `409` by reconciling instead of failing.
- [ ] *(deferred; backend already accepts 4–6 digits)* Consider 6-digit PIN or biometrics (expo-local-authentication) for sensitive actions.

### 1.2 ✅ Optimize TextBee (P0) — 🟢 code-complete, pending deploy

> **Status:** implemented on `rixdev` (uncommitted). Details, diff and test checklist: [task-1.2-changes.md](task-1.2-changes.md).
> **Design decision:** OTP is sent **inline** (so the client gets a real `502`), while receipts/notifications go through a throttled QStash queue – that is how OTP gets priority.

**Findings**
- Two senders: `lib/textbee.ts` (timeout 4.5s, retries w/ backoff, SIM selection) and `lib/sms.ts` (no timeout, no retry, no SIM id). OTP route uses `lib/sms.ts`.
- `/api/otp/send` **awaits** SMS then always returns `success: true` even if SMS failed → user waits for a code that never arrives.
- A single Android phone SIM is the throughput limit (SMS rate limits/carrier throttling). 50 users signing up near-simultaneously + settlement receipts can exceed it.
- Retries aren't idempotent-aware (could double-send); retries on 4xx waste quota.
- Settlement receipts via SMS compete with OTPs on the same device.

**Tasks**
- [x] Consolidate to **one** sender (`deliverSms` in `lib/sms.ts`; `sendSmsNotification` / `sendSmsReceipt` are thin wrappers) – (use `textbee.ts` logic: timeout, retry only on network/5xx/429, no retry on 4xx).
- [x] Return a real result to the client: if SMS fails → `502 { code: "SMS_FAILED" }`, stored code deleted, resend allowed immediately.
- [~] Move SMS dispatch to **QStash** with retries + dead-letter. **Done:** all receipts/notifications (`enqueueSms` → `/api/sms/dispatch`, 3 retries, QStash DLQ, direct-send fallback). **Not done by design:** OTP stays inline (see status note).
- [x] **Priority**: OTP > payment receipts (receipts throttled to 10/min, parallelism 1, via QStash `flowControl`).
- [x] Client resend cooldown (60s countdown; follows `Retry-After` on `429`; no cooldown after `502`) in `OnboardingScreen` (server limit is 3 per 5 min per IP+phone).
- [ ] *(manual, test-day prep)* Pre-test: verify TextBee device uptime (battery saver off, charger, stable Wi-Fi/data, SIM load, daily SMS limit). Have a **second device/SIM** configured as fallback. *(Code support added: `TEXTBEE_FALLBACK_*` env vars – device still needs to be set up.)*
- [x] Health check endpoint for TextBee (device online status) surfaced in `/api/health?deep=1` (cached 30s; `status: degraded` when no device is online). TextBee response shape not yet verified against a live account.
- [x] Fix webhook secret usage consistency – verified: HMAC fails closed when `TEXTBEE_WEBHOOK_SECRET` is missing; no change needed.
- [x] Fallback OTP for testers (`OTP_TEST_MODE` + `OTP_TEST_NUMBERS` + `OTP_TEST_CODE`), off by default, logged on every use.

### 1.3 ✅ Lock the On/Off Ramp (P0/P1)

**Findings**
- `api/anchor/simulate-payment` is **explicitly unauthenticated** (comment: "Add rate-limiting / CSRF before mainnet"). It mints PHPC/USDC from the distributor secret → abuse possible by anyone who has/guesses a `transaction_id`.
- `demo/*` routes and pages are shipped in the same deployment (`DEMO_ENABLED=true` in the example env).
- `/api/anchor/submit-withdraw`, `confirm-withdraw` – need amount caps and replay protection.
- `/api/friendbot` is an open proxy (no auth/limit).
- No amount limits, no per-user daily caps, no kill switch.
- Mobile ramp screens (`LoadOfflineFundsScreen`, `LoadOnlineFundsScreen`, `Sep24WebviewScreen`) have no feature flag.

**Tasks**
- [x] Add env kill switches: `RAMP_ENABLED`, `DEPOSIT_ENABLED`, `WITHDRAW_ENABLED`; return `503 { code: "RAMP_LOCKED" }`. Mobile reads `/api/health` or `/api/sep24/info` flag and disables buttons with a friendly message.
- [x] Require the SEP-24 interactive JWT (short-lived, single-use) in `simulate-payment`; bind to `transaction_id` + `sub`; mark used (one-shot).
- [x] Per-tx and per-user caps (e.g. ≤ ₱5,000 per tx, ≤ ₱20,000/day on testnet), enforced server-side.
- [x] Idempotency: reject if `AnchorTransaction.status` is already `completed/pending_external` (verify the atomic status transition: use `updateMany where status=X` rather than read-then-write).
- [ ] Disable/guard `DEMO_ENABLED` and `OFFLINE_TRANSACTION_DEBUG` in the production env; ensure `/demo*` returns 404 when off.
- [~] Lock Friendbot to the signup flow (requires OTP verification token + 1 per phone/key). **Done:** 20/min per IP + 3/h per key. **Open:** require OTP token.
- [ ] Restrict `CORS_ORIGIN` from `*` (mobile native doesn't need CORS; webviews/web pages only) → set to the specific origin(s).
- [ ] Keep distributor/relayer/registrar keys out of `.env` in repo; use Vercel encrypted env and **separate keys per role** (currently `REGISTRAR_SECRET_KEY` falls back to `RELAYER_SECRET_KEY`).
- [x] Audit log: store ramp requests with user, amount, IP, result.

---

## 2. 🆕 Scalability / Bottlenecks for 50 Concurrent Users

### 2.1 Relayer concurrency (P0)
- `settle`, `deposit`, `transfer`, `withdraw` all use the **same relayer** (`RELAYER_SECRET_KEY`), and `transfer` loads `relayerAccount` fresh per request. Concurrent submissions → `tx_bad_seq` / `txTOO_LATE` / duplicate sequence.
- **Fix options** (pick one):
  1. **Channel accounts**: pool of N funded relayer accounts (e.g. 10–20), lease per request via Redis lock, or
  2. Serialize relayer submissions through a **QStash/Redis queue** with a single consumer and sequence tracking, or
  3. Fee-bump pattern with per-user source accounts (the user's sequence already used in `deposit/withdraw` – extend to `settle`/`transfer`).
- Retry classifier exists (`engine-retry-classifier.test.ts`) – verify it covers `tx_bad_seq` with refresh + backoff + jitter.
- Fund relayer well above expected spend (testnet Friendbot).

### 2.2 External rate limits (P0)
| Dependency | Risk | Mitigation |
|-----------|------|-----------|
| Friendbot | Per-IP limits; backend proxy = 1 IP | **Pre-fund** accounts or run a funding queue with throttle (1–2 req/s) + retries/backoff; or fund from your own distributor account (Create Account op) instead of Friendbot |
| Soroban RPC (public) | 429s from polling by each client | Use a **dedicated RPC provider** (Validation Cloud, Blockdaemon, QuickNode) or proxy RPC through backend with caching; exponential backoff + jitter in polling loops (`LoadOffline/OnlineFundsScreen`, `SendMoneyConfirmScreen`) |
| Horizon testnet | Trustline submit & balance polls | Same: backoff, avoid per-render fetches |
| Neon Postgres | Connection exhaustion on serverless | Use **pooled** connection string (`-pooler`), `PrismaPg` pool max small (e.g. 3–5) per lambda; ~~avoid N+1 (register loops `findUnique` per shortId attempt)~~ ✅ fixed in §1.1 |
| Upstash Redis | Free-tier command limits | Check quota; each OTP = ~4 commands, ratelimit calls add more |
| TextBee | Device throughput | ✅ Receipts throttled via queue, fallback device supported (§1.2) |
| Vercel | Function timeout (10s hobby / 60s pro), cold starts | Set `maxDuration` on engine routes; keep heavy work async |

### 2.3 Backend efficiency (P1)
- [x] `register`: replace shortId look-up loop with `create` + catch unique-violation retry (1 query instead of up to 16).
- [x] Add indexes: `Account.phoneNumber`, `Settlement(senderShortId, createdAt)`, `Settlement(receiverShortId, createdAt)`, `AnchorTransaction(stellarAccount, createdAt)`.
- [x] `wallet/history` and `settlements` and `transactions`: confirm pagination (`take`/cursor) and caching; response size limits.
- [x] Cache `vault-balance` / `wallet/balance` for a few seconds (Redis) – dashboards from 50 devices polling the chain is costly.
- [x] `health` endpoint: DB + Redis + RPC + TextBee + relayer readiness. **Done:** DB (`SELECT 1`), Redis (`ping`), RPC (`getHealth`), TextBee (`?deep=1`), dynamic features flags.
- [ ] Idempotency keys on `engine/*` POSTs (client retry safety).
- [ ] Structured logs with request IDs; remove noisy debug logs (`offline-transaction-debug`).

---

## 3. 🆕 Mobile App Improvements (`apps/mobile`)

### 3.1 Reliability (P0/P1) — 🟡 mostly complete, pending APK build

> **Status:** implemented on `rixdev` (uncommitted). Details and test checklist: [task-3.1-changes.md](task-3.1-changes.md). **Next pass:** onboarding state machine. **Later:** Sentry (needs DSN + EAS build).
- [~] **Global ErrorBoundary** in `App.tsx` + crash reporting. **Done:** `ErrorBoundary` with recovery screen, global JS error handler, single `reportError()` hook. **Deferred:** Sentry (plug into `reportError`; needs `@sentry/react-native`, DSN, new EAS build).
- [x] **Central API client** *(done: `apiFetch` / `apiRequest` / `fetchWithTimeout` in `services/api/client.ts`; 15s default timeout, retries with backoff + jitter for GET/HEAD only, honours `Retry-After`, JWT attached only when the caller sets no `Authorization`, silent SEP-10 re-auth on 401; every raw `fetch` in `src/` migrated)*: `OnboardingScreen`, `syncService`, `LoadOffline/OnlineFundsScreen`, `SendMoney*` use raw `fetch()` with no timeout. Use `services/api/client.ts` (`apiRequest`) everywhere and add: `AbortController` timeout (10–15s), retry with backoff on network/5xx/429, JWT attach, 401 → re-auth.
- [x] *(canonical = `https://pijin-api.vercel.app`; `constants/api.ts` is the single source incl. anchor host; release builds refuse non-https; `.env.example` aligned)* `getApiBaseUrl()` is evaluated at module load and fallbacks differ: `constants/api.ts` defaults to `pijin-api.vercel.app` while `.env.example` says `https://pijin.live` and `eas.json` another → **confirm a single canonical production URL** and fail loudly if missing in release builds.
- [ ] *(next pass, by decision)* `OnboardingScreen` is 1,387 lines; the `handleEnterPijin` chain should be a resumable state machine with per-step status/retry UI ("Funding wallet… Setting trustline… Registering…").
- [x] Add duplicate-tap guards on every money action – **verified already present**: send (`submissionStartedRef`), deposit/withdraw (`isProcessingRef`). No change needed.
- [~] `syncService.postToBackend` sends **no auth** and `senderPhone: null`; flush loop is sequential (OK) but unbounded – add max batch, backoff on 429/5xx, and stop on repeated failures. **Done:** max 5 posts per flush, 0–3s start jitter on automatic flushes, stop on first transient/429/5xx/network failure. **Finding:** `/api/engine/settle` requires a QStash signature, so direct mobile posts get `401` in production – items now stay pending (SMS path still settles them). **Open (backend):** accept device-signed direct submissions if the online fallback is wanted. `senderPhone` left `null` deliberately (a client-supplied phone would let anyone trigger SMS to arbitrary numbers).
- [x] `syncService.flush` distinguishes failures: backend `FAILED` and `400/413/422` → permanent; `401/403` → kept pending (rejected); network/timeout/`408/429/5xx` → kept pending (transient).
- [x] `ConnectionWatcher` effect split – also fixed a real bug: showing the banner re-ran the effect and its cleanup cancelled the 3s redirect and countdown, so the redirect never fired.
- [x] `App.tsx`: `ensureMigration()` → `runMigrations()` → `syncService.start()` in order; splash held until DB ready; "Pijin couldn't start" screen with **Try again** on failure.

### 3.2 Security (P0/P1) — 🟢 code-complete, pending APK build

> **Status:** implemented on `rixdev` (uncommitted). Adds one native dep (`expo-screen-capture`) → needs a **new EAS build**, not an OTA/reload.
- [x] `EXPO_PUBLIC_SMS_SIMULATE_SECRET` is now dev-only (`__DEV__ ? env : ''` in `constants/api.ts`); release bundles carry an empty string. `.env.example` marked dev-only. **Manual:** make sure it is unset in the EAS `preview`/`production` profiles (not present in `eas.json` today).
- [x] `TREASURY_PUBLIC_KEY` removed from the mobile `.env.example` (backend-only; the backend returns the treasury address per withdrawal).
- [x] `.env` files verified git-ignored (`.gitignore` L21/40/56) and **never present in git history** (`git log --all` for `.env` paths is empty; only `.env.example` files are tracked). No rotation needed on that basis. *(Values the team pasted elsewhere, e.g. chat, are out of scope.)*
- [x] PIN: SecureStore is now the only local copy (`saveUserPin`/`getUserPin`; `*Secure` variants removed). Legacy AsyncStorage PINs are moved into SecureStore on first read and deleted. Local lockout added (5 wrong → 15 min, `getPinLockoutRemainingMs`/`recordPinFailure`/`resetPinAttempts`) on `SignInScreen` and `ChangePinScreen`.
- [x] Mnemonic: copy goes through `utils/secureClipboard.ts` (clears after 60s, only if the clipboard still holds the phrase); `useSecureScreen` (`expo-screen-capture`, Android `FLAG_SECURE`) on onboarding steps 6–7 and `RestoreWalletScreen`.
- [x] Release builds strip `console.log/info/debug/warn` via `babel-plugin-transform-remove-console` (production env only; `console.error` kept for `reportError`). Verified with a direct Babel transform. `__DEV__` secret logging unchanged.
- [x] `Sep24WebviewScreen`: `onShouldStartLoadWithRequest` blocks any non-https / non-anchor-host navigation; bridge messages are accepted only from the anchor origin; `originWhitelist` uses the bare host. **Not done:** TLS certificate pinning (needs a native module; out of scope for testnet).

### 3.3 Performance (P1/P2) — 🟡 partly done (static changes, **not yet measured on a device**)

> Everything below is a static, code-level change. Per the measure-first rule, record baselines (§8.6) on a preview APK before/after; revert anything that doesn't beat noise.
- [~] Large screens split: **not done** (high regression risk without a device/profiler; overlaps §8.2 R1/R7 and the onboarding state-machine pass). **Done:** `TransactionItem` is `React.memo`; `TransactionList` has stable `renderItem`/`keyExtractor` and no redundant `key`/`removeClippedSubviews`/`windowSize` (the list is a non-scrolling ≤5-row preview — `HomeTab` already slices to 5 — so virtualization tuning/`getItemLayout` would be no-ops).
- [x] Lookup: it is triggered by the Search button / keyboard submit, **not per keystroke**, so a debounce would add nothing. Instead `services/api/userLookup.ts` gives one shared lookup with a 60s cache and in-flight de-dupe (search modal → Continue now costs one request, double-taps cost one), and `SendMoneyScreen` ignores stale responses. Side effect: a non-404 error on the Continue path now says "Failed to look up recipient" instead of "No account found".
- [x] Balances: `useVaultBalance` shares one in-flight request per account across all hook instances and reuses a result < 20s old on mount (Dashboard → SendMoney no longer refetches). Explicit `refresh()` (pull-to-refresh, after deposit/send) always hits the network.
- [x] Hermes verified on (`android/gradle.properties`); New Arch on. `expo-image` already used for illustrations. Compressed the three identical launcher/splash icons (1254px, 1654 KB each) to lossless 1024px (762 KB each): **−2.7 MB** of assets. Onboarding illustrations were already 8-bit palette PNGs (160–350 KB); a 256-colour test on the icon visibly banded, so I did not lossy-compress anything else.
- [ ] Heavy crypto progress UI — belongs to the onboarding state-machine pass (§3.1).
- [x] Android: `eas.json` `preview` profile is a release APK (no dev client) — use it for the test; nothing to change.
- [x] Expo 52 / RN 0.76: left as is, per the plan.

### 3.4 UX for Test Day (P1)
- [ ] In-app **status/maintenance banner** (driven by `/api/health` or a remote flag) – e.g. "On/Off ramp temporarily locked".
- [~] Clear, actionable error messages (map `ApiError.status` → text: 429 "Too many attempts", 503 "Service busy, retrying"). **Done:** `apiRequest` defaults for 429/5xx, timeout and network errors. **Open:** per-screen mapping.
- [ ] Skeleton/loading states for balance & history; offline indicator.
- [ ] "Report a problem" button that shares last logs + shortId.
- [ ] Test-user guide: how to get testnet tokens, how offline SMS works, SIM/permission requirements.

---

## 4. 🆕 Testing & Verification (P0 before the test)

- [ ] **Load test** the backend with k6/Artillery at 50–100 virtual users: OTP send (mocked SMS), register, SEP-10, deposit, transfer, settle, history. Targets: p95 < 2s (non-chain), error rate < 1%, 0 `tx_bad_seq`.
- [ ] **Chaos checks**: TextBee down, RPC 429, Friendbot 429, DB slow – verify graceful messages and retries.
- [ ] **Concurrency test** for relayer: 20 simultaneous transfers/settles from different users.
- [ ] **Soak run**: 30-min scripted flow with 10 real devices (mixed Android versions).
- [~] Security regression tests (unit tests for PIN hashing, OTP and token binding added in `lib/signup-security.test.ts`; endpoint-level tests still open): PIN not in any response; register without OTP token → 401; OTP brute force → locked; ramp locked → 503.
- [~] Unit tests exist for sms-security, voucher, retry-classifier – **otp/PIN done** (`signup-security.test.ts`); register/ramp limits open. (No mobile tests found.)
- [ ] Pre-flight checklist script: relayer XLM balance, distributor balances, contract/token IDs match mobile `.env`, DB migrations applied, Redis reachable, TextBee device online.

---

## 5. 🆕 Observability & Ops (P1)

- [ ] Sentry (backend + mobile) with release tags; Vercel log drain or Axiom.
- [ ] Dashboard of: signups/min, OTP success rate, SMS failures, settle latency, relayer balance/sequence errors, 429 counts.
- [ ] Alerts (Discord/Telegram webhook) on: relayer XLM < threshold, SMS failure rate > 10%, error rate spike.
- [ ] Runbook: how to flip kill switches, rotate TextBee device, top up relayer, reset a stuck user, re-queue failed settlements.
- [ ] Backups: Neon branch/snapshot before test day.
- [ ] Freeze: **code freeze** 24h before test; tag build; distribute one APK (EAS `preview`).

---

### 5.1 Pre-APK build checklist (EAS `preview`)

1. [ ] **Deploy the backend first** (§1.1/§1.2 code). The new APK calls `/api/auth/pin/verify` and sends the OTP verification token; against the old backend, PIN sign-in on a new device fails and the plaintext-PIN leak stays open.
2. [ ] **Commit all changes** (incl. new untracked files `useSecureScreen.ts`, `userLookup.ts`, `secureClipboard.ts`) so EAS builds exactly what was reviewed.
3. [ ] **Check your env.** `EXPO_PUBLIC_SMS_SIMULATE_SECRET` must **not** be set in the EAS `preview` profile (it isn't in `eas.json` today; release builds ignore it anyway), and `REQUIRE_OTP_TOKEN` must stay `false` on the backend until the new APK is rolled out to all testers — only then flip it to `true`.
4. [ ] Build: `eas build --platform android --profile preview` from `apps/mobile` (new native module `expo-screen-capture` → not OTA-able).

---

## 6. Suggested Execution Order

**Phase 1 – Security blockers (Day 1–2)** *(must finish)*
1. ✅ Remove PIN from `/users/check`; stop PIN in SMS; hash PINs. *(code done, pending deploy)*
2. ✅ OTP verify token + attempt limit; protect `/register`; block `ADMIN` role; remove OTP log. *(code done; enforce token after APK rollout)*
3. Ramp kill switch + lock `simulate-payment`; disable demo/debug flags.

**Phase 2 – Capacity (Day 2–4)**
4. ✅ Unified SMS sender + QStash queue + resend cooldown + fallback device. *(code done, pending deploy; second device still to be provisioned)*
5. Relayer channel accounts / queue; Friendbot throttle or pre-funding.
6. Dedicated Soroban RPC; backoff + jitter everywhere; Neon pooling; indexes.

**Phase 3 – Mobile hardening (Day 3–5)**
7. 🟡 ErrorBoundary ✅ + Sentry ⏳; central API client with timeout/retry ✅; resumable onboarding ⏳ (next pass).
8. Remove public secrets; clean env/URL config ✅; sync service improvements ✅ (partial – see §3.1).
9. Debounce lookups, list performance, test-day UX banners.

**Phase 4 – Validation (Day 5–6)**
10. Load/chaos/soak tests; fix findings; pre-flight script; build release APK; freeze.

---

## 7. 🆕 Backend Inventory vs. Latest Mobile Patch

> Method: listed all 29 `route.ts` handlers in `apps/backend/app/api`, then traced every `fetch`/`apiRequest` in `apps/mobile/src`. Recent git history (`refactor/security` PR #133: two-phase tx submission, 7-tuple firewall, reconciliation/pre-flight, QStash host resolution, outbound SMS alerts) was used as the "latest patch" context. Static analysis only – not executed.

### 7.1 Endpoints the mobile app actually uses (KEEP – these are the contract)

| Backend route | Mobile caller | Auth today | Notes / risk |
|---|---|---|---|
| `GET/POST /api/auth` (SEP-10) | `anchorService.getSep10Token` (Onboarding, SignIn) | Challenge/sign | Host = `ANCHOR_DOMAIN` (`pijin-api.vercel.app`), **not** `getApiBaseUrl()` → two hosts in use. |
| `GET /.well-known/stellar.toml` | `anchorService` | public | OK |
| `POST /api/otp/send`, `/verify` | `OnboardingScreen` | rate limits | ✅ Attempt limit, per-phone/global limits, verification token (§1.1). |
| `GET /api/users/check` | `accounts.checkUserExists` (Onboarding, SignIn) | 60/min per IP | ✅ No longer returns `pin`; SignIn uses `POST /api/auth/pin/verify`. |
| `POST /api/register` | `accounts.registerAccount` | OTP token (optional until `REQUIRE_OTP_TOKEN=true`) + rate limit | ✅ see §1.1 |
| `POST /api/auth/pin/verify` *(new)* | `SignInScreen` (via `verifyPinWithServer`) | lockout 5 / 15 min + 30/min per IP | ✅ Added in §1.1. |
| `GET /api/users/lookup` | SendMoney, SendMoneyConfirm, `transactionDb` | 300/min per IP | ✅ Rate-limited. Still public enumeration of name + public key + device key – consider auth. |
| `POST /api/friendbot` | `OnboardingScreen.fundMainWallet` | rate limit only | 🟡 Throttled (20/min IP, 3/h key); still a single backend IP to Friendbot. |
| `POST /api/engine/deposit` | `LoadOfflineFundsScreen` | Bearer = Ed25519 signature | Relayer shared. |
| `POST /api/engine/withdraw` | `LoadOnlineFundsScreen` | Bearer = signature | Relayer shared. |
| `POST /api/engine/transfer` | `SendMoneyConfirmScreen` | Bearer = signature | Relayer sequence load per request (`getAccount(relayer)`) → collision risk. |
| `POST /api/wallet/transfers/confirm` | `services/api/transactions` | **none** (only `txHash`) | Safe-ish (state derived from chain) but add rate limit; each call = RPC hit. |
| `POST /api/engine/settle` | `syncService.postToBackend` | **QStash signature required** → direct mobile posts get `401` | ⚠️ Mobile direct path is effectively disabled in prod; items wait for SMS settlement (§3.1). Mobile treats `409` as success. |
| `GET /api/engine/offline-key`, `/recipient-registry` | `offlineKeySync`, `recipientRegistrySync` | SEP-10 JWT | Registrar signing → sequential; limit concurrency. |
| `GET /api/transactions` | `getUserSettlements` (sync flush) | none | Needs pagination + rate limit. |
| `GET /api/wallet/history` | `getWalletHistory` | rate-limited | Keep; cache. |
| `GET /api/vault-balance`, `/api/wallet/balance` | `useVaultBalance`, balance cards | rate-limited | Keep; short Redis cache. |
| `/api/sep24/info`, `/sep24/transactions/deposit/interactive`, `/withdraw/interactive`, `/sep24/transaction` | `anchorService`, `Sep24WebviewScreen` | SEP-10 JWT | Part of the ramp → kill-switch target. |
| `/api/anchor/simulate-payment` | Called by the **server-rendered web page inside the webview** (not RN code) | none (comment-acknowledged) | 🔴 lock first. |
| `POST /api/anchor/submit-withdraw`, `/confirm-withdraw` | `anchorService`/`Sep24WebviewScreen` | SEP-10 JWT (confirm) | Add caps/idempotency. |
| `POST /api/sms/webhook` | **TextBee device → backend** (offline SMS vouchers) | HMAC `X-Textbee-Signature` + ratelimit | Core of offline flow; keep, enqueue to QStash. |

### 7.2 🔴 Mobile code calling endpoints that **do not exist** (dead/broken)

| Mobile file | Calls | Backend status | Action |
|---|---|---|---|
| `src/services/api/merchants.ts` | `GET /api/merchants/default-short-id` | **No such route** | Confirm unused (no importers found) → delete, or implement. |
| `src/services/api/settlement.ts` | `POST /api/sms/simulate` | **No such route** (only `/api/sms/webhook`) | Same – likely stale from an earlier patch; remove so it can't ship a 404 path. |
| `src/hooks/useMockTransactions.ts` | local mock | n/a | Remove from release path. |

### 7.3 Backend routes **not referenced by mobile** (candidates to disable/guard in prod)

| Route | Used by | Recommendation |
|---|---|---|
| `/api/demo/session`, `/api/demo/settlement`, `app/demo/*`, `app/demo-split` | Judge/QA web demo (`DEMO_ENABLED`) | Disable via env (`DEMO_ENABLED=false`) or 404 in prod during the 50-user test; keep pool provisioning off to avoid burning relayer/Friendbot quota. |
| `/api/swagger`, `/api-docs` | Developer docs | Restrict in prod (or basic auth). |
| `/api/settlements` (POST) | Not called by mobile (mobile uses `/api/engine/settle`) | Verify authorization; likely legacy → remove or protect. |
| `app/deposit`, `app/withdraw` pages, landing components | Web | Not needed by mobile; keep isolated. |
| `/api/health` | Ops | Extend (see §2.3). |

### 7.4 Frontend ↔ Backend change coordination (so your mobile edits don't break)

Rules of thumb for the frontend changes you'll make:

1. **Never ship a backend breaking change before the app update is installed.** Use additive changes: new fields/endpoints first, old behavior behind a flag, remove later. All 50 testers run one APK, so a coordinated cutover is acceptable *only* if the APK is rebuilt first.
2. Add an **API version header** (`X-Pijin-App-Version`, `X-Pijin-Api: 1`) from `apiRequest`; backend returns `426 Upgrade Required` for too-old builds.
3. ✅ Single source of truth for the base URL (`getApiBaseUrl()`); anchor host now derived from it (`getAnchorDomain()`, overridable via `EXPO_PUBLIC_ANCHOR_DOMAIN`).

**Breaking-change matrix (do these as paired PRs)**

| Backend change | Required mobile change | Order |
|---|---|---|
| Remove `pin` from `/users/check` + server-side PIN verify endpoint (`POST /api/auth/pin/verify`) | `SignInScreen`/`accounts.checkUserExists` stop reading `pin`; call verify endpoint; handle `423 Locked`, `429` | ✅ Done together (`pin` removed immediately – see task-1.1-changes.md §4). |
| `/otp/verify` returns `verificationToken` | `OnboardingScreen.handleVerifyOtp` stores token in state; `registerAccount` sends it | ✅ Backend optional + mobile sends. ⏳ Enforce via `REQUIRE_OTP_TOKEN=true` after APK rollout. |
| `/register` forces `role=USER`, hashed PIN, validation | Map new `400` field errors to inline form errors | ✅ Backend done. ⏳ Mobile shows a generic alert; inline `fieldErrors` mapping open. |
| SMS result surfaced (`502` on failure) + resend cooldown | Show retry UI, 60s countdown; disable resend button | ✅ Done together (§1.2). |
| Ramp kill switch (`503 RAMP_LOCKED`) | `LoadOffline/OnlineFundsScreen`, ramp buttons check flag (`/api/health` → `features.ramp`) and show banner | Backend flag default ON → ship mobile → flip OFF. |
| Relayer channel accounts / queue | None (transparent), but mobile must tolerate `202 Accepted + poll` if you choose the queue option | Decide before frontend work on polling. |
| Pagination on `/transactions`, `/wallet/history` | `syncService` & lists handle `nextCursor` | Backend additive (`limit` default) → mobile adopts. |
| Auth on `/engine/settle` (if added) | `syncService.postToBackend` attach JWT/signature | Together. |
| Rate limits (429 + `Retry-After`) everywhere | `apiRequest` honors `Retry-After`, shows friendly message | ✅ Mobile side done (§3.1); backend limits can be tightened after the APK ships. |

**Shared contract to formalize** (prevents drift): export request/response types from `packages/` (the monorepo already has `pijin_core`) or generate from the existing Swagger JSDoc; mobile `services/api/*` imports them. Add a CI contract test that hits a local Next dev server with the mobile client functions.

### 7.5 Backend patch-verification checklist (what's "working" vs "needs proof")

Evidence of working paths (from code + recent commits): SEP-10 auth, OTP send/verify, register, deposit/withdraw/transfer assembly with signature auth, settle with 7-tuple firewall + two-phase submit + reconciliation, SMS webhook with HMAC + QStash, offline-key + registry sync, SEP-24 deposit/withdraw. Unit tests exist for: SMS security, offline voucher security, retry classifier, demo helpers, secret box.

Needs verification before the test (run on a staging deploy with real device):
- [ ] End-to-end: signup → fund → trustline → register → SEP-10 → registry/offline-key sync (happy path timing; record p50/p95 per step).
- [ ] Online transfer: assemble → sign → RPC send → poll → `/transfers/confirm` → history shows `SETTLED`.
- [ ] Offline voucher: SMS send → TextBee webhook → QStash → settle → receipt SMS → mobile `syncService` marks `SETTLED` (check nonce normalization `=` stripping matches backend).
- [ ] Failure alerts: outbound SMS on settlement failure (commit `770d32d`) does not loop or exhaust SIM quota.
- [ ] Reconciliation/pre-flight job (commit `0fe2048`) is idempotent and safe under concurrency.
- [ ] `ENV` parity: `CONTRACT_ID`, `TOKEN_ID`, `TOKEN_DB_ID`, gateway key, issuers identical in backend Vercel env, `mobile/.env`, and `eas.json` profile used for the APK (found hard-coded duplicates in `eas.json`).
- [ ] QStash delivery host resolution (commit `2e9202f`) works on the production domain (not preview URLs).
- [ ] Prisma migrations applied on the production DB (latest: `20260726090000_add_demo_account_pool`).
- [ ] Add tests (endpoint-level): `users/check` never returns PIN; `register` without token rejected; ramp lock returns 503; `settle` duplicate nonce idempotent.

### 7.6 Added tasks from this scan

- [ ] Delete/guard dead mobile services: `merchants.ts`, `settlement.ts` (non-existent endpoints).
- [ ] Decide fate of `/api/settlements` POST and `/api/swagger` in production.
- [~] Rate-limit `users/lookup`, `users/check`, `transactions`, `wallet/transfers/confirm`, `friendbot`, `register`. **Done:** lookup, check, friendbot, register. **Open:** transactions, transfers/confirm.
- [~] Add `/api/health` `features` object (`ramp`, `smsOtp`, `demo`) consumed by mobile for maintenance banners. **Done:** `features.smsOtp`. **Open:** `ramp`, `demo`, mobile banner.
- [ ] Introduce `X-Pijin-App-Version` header + backend min-version gate.
- [~] Align anchor host and API host config; remove hard-coded duplicates from `eas.json`. **Done:** anchor host derived from API host in code. **Open:** `eas.json` still repeats the URL per profile (values already consistent).

---

## 8. 🆕 Mobile Performance Audit (`apps/mobile`)

> Scope: static review of `App.tsx`, `DashboardScreen`, `useVaultBalance`, `syncService`, `connectionService`, `transactionDb`, DB client/migrations, `TransactionList`, funds/send screens, assets and Expo config. **No profiling has been run yet** – per the measure-first rule, every item below is a *hypothesis ranked by expected impact at 50 users*, and §8.6 gives the baseline to take before keeping any change. Nothing was edited.

### 8.1 Request-amplification (biggest risk when 50 devices hit one backend/RPC)

| # | Finding (evidence) | Why it hurts at 50 users | Proposed fix | Expected impact |
|---|---|---|---|---|
| P1 | `DashboardScreen` fires **`flush()` + `syncTransactions()` + `resolveOfflineTransactionNames()` + `refreshBalance()`** in the effect at L385 (deps `hasInternet, isOnline, shortId, publicKey`) **and again** on every pull-to-refresh (L446), `ON_DEPOSIT_COMPLETE` (L335), `ON_SEND_MONEY_ONLINE` (L220) and after balance polling. `useVaultBalance` also fetches on mount (L72). Toggling online/offline re-runs the whole chain. | Each app open = ~4–6 requests; toggling modes or flaky signal multiplies it. 50 users × reconnects → request storms. | One `useSyncCoordinator` with a **single in-flight promise + min interval (e.g. 15s)**; effect only runs on *connectivity regained* and *foreground*, not on `isOnline` toggles. | High |
| P2 | `resolveOfflineTransactionNames()` (`transactionDb.ts` L345) selects **all** `OFFLINE` rows and does a **sequential `fetch /api/users/lookup` per row, every refresh**, with no cache. Names that fall back to the shortId match the regex again → re-fetched forever. | O(n) sequential requests per refresh per user; hammers the public lookup route. | In-memory + persisted `shortId → displayName` cache (TTL 24h), de-dupe IDs, `Promise.all` with concurrency 3, skip rows already resolved, run only when unresolved rows exist. | High |
| P3 | `getUserSettlements()` is called inside **every `syncService.flush()`** (L169) before sending; flush itself runs on mount, refresh, online-transition. | Extra `GET /api/transactions` per flush, unpaginated. | Only fetch when `pending.length > 0` (already) **and** at most once per 30s; request `?since=` / `limit`. | Med |
| P4 | `syncTransactions` downloads history then **slices to 50 client-side** (`syncService.ts` L235) – server still returns everything. | Payload grows with usage. | Pass `limit=50` to `/api/wallet/history` (backend change §7.4). | Med |
| P5 | Balance polling after SEP-24 deposit: 15 attempts from 4s→10s (`DashboardScreen` L274), each a full `/api/vault-balance` (which does chain reads). Deposit/withdraw/transfer screens poll **Soroban RPC directly** every 2s × 15 (`LoadOfflineFundsScreen` L252-255, same in Online/SendMoneyConfirm). | 50 users on a public RPC = 429s. | Backoff + jitter, honor `Retry-After`, route RPC polling via backend `/transfers/confirm`-style endpoint or dedicated RPC key; stop polling when screen unfocused. | High |
| P6 ✅ | **No timeouts / AbortController** on any `fetch` *(fixed in §3.1)* (OnboardingScreen, SendMoney*, LoadFunds*, `syncService`). | A slow response hangs spinners and keeps connections open → user retries → duplicate load. | Route all calls through `apiRequest` with 10–15s abort, retry-with-jitter for idempotent GETs only. | High (stability) |
| P7 | `SendMoneyScreen` calls `/api/users/lookup` per query (L198/L283) – no debounce or cancel of stale requests. | Keystroke-driven requests. | 350ms debounce + `AbortController` + result cache. | Med |
| P8 | `useVaultBalance` doesn't dedupe concurrent `refresh()` calls and has **no stale-while-revalidate**; shows `isLoading` flicker, and writes AsyncStorage twice (cache effects in Dashboard L358/L366 + hook). | Redundant fetches/writes. | Promise de-dupe + `lastFetchedAt` (skip if < 5s); cache write in one place. | Med |

### 8.2 JS-thread / render cost

| # | Finding | Fix | Impact |
|---|---|---|---|
| R1 | `DashboardScreen` (697 lines, **12 `useEffect`s**) owns balances, sync, polling, animation and tab state; any state change (e.g. `cachedBalance`, `refreshing`, `isPollingBalance`) re-renders **all 5 tabs** because all five panels are mounted side-by-side in a `5 × SCREEN_WIDTH` `Animated.View` (L682-690). | Split into `useDashboardSync` hook + memoized tab components (`React.memo` + stable props); mount non-active tabs lazily (`activeTab === x \|\| visited[x]`); keep Scan tab unmounted (camera). | High |
| R2 | `useLiveQuery` on **all** non-settlement transactions (L82) with `or(stellarPublicKey, shortId)` and `ORDER BY createdAt` and **no `LIMIT`**; result is re-mapped + regex-parsed per row (L97-117) on every DB change (each `upsert` row write triggers the change listener). | `LIMIT 100` for Home/Notifications, paginate Transactions tab; precompute display fields at write time; batch upserts so listener fires once. | High as history grows |
| R3 | `upsertServerTransactions` / `upsertHistoryTransactions` do **SELECT-then-UPDATE/INSERT per row** inside a transaction (N+1 on-device, up to 50×2 statements). | Single `INSERT … ON CONFLICT(id) DO UPDATE` (Drizzle `onConflictDoUpdate`), multi-row `values([...])`. | Med |
| R4 | **No indexes** in `db/schema.ts`/`migrations.ts` (queries filter on `tag`, `short_id`, `stellar_public_key`, `type`, `created_at`, and `payment_queue.synced/customer_short_id`). | Add `CREATE INDEX IF NOT EXISTS` migration: `(short_id, created_at DESC)`, `(stellar_public_key)`, `(tag)`, and `payment_queue(synced, customer_short_id)`. Verify with `EXPLAIN QUERY PLAN`. | Med |
| R5 | `TransactionList` is a non-scrolling `FlatList` (`scrollEnabled={false}`) nested in a `ScrollView` → **virtualization disabled**, renders every item; `renderItem` inline + redundant `key`. | Slice to 5–10 for "Recent Activity"; for the full list use a top-level `FlatList`/`FlashList` with `getItemLayout`, `keyExtractor`, `initialNumToRender`, memoized row. | Med |
| R6 | `NotificationsTab`/`TransactionsTab` use `ScrollView` + `.map()` (non-virtualized). | Convert to `FlatList`/`SectionList`. | Med |
| R7 | `OnboardingScreen` – 1,387 lines, 16 `useState`, zero memoization; all 8 slides mounted in a horizontal `ScrollView`; `LayoutAnimation` + `Animated` with `useNativeDriver:false` (dots) running per step. | Lazy-render slides adjacent to `step`; split per-step components; use native driver where possible (width isn't supported → use `scaleX`). | Med (first-run UX, 50 simultaneous signups) |
| R8 ✅ | `ConnectionWatcher` effect depends on `showBanner` *(fixed in §3.1)* → re-subscribes to the RxJS stream on each toggle and can leak timers. | Split subscription (stable deps) from banner state. | Low–Med |
| R9 | Heavy crypto (`deriveKeysFromMnemonic`, PBKDF2/ed25519 in JS) runs on the JS thread during registration (OnboardingScreen L405). | Keep the `setTimeout(50)` yield, show step progress; consider `InteractionManager.runAfterInteractions`; verify `react-native-get-random-values` + native crypto (`expo-crypto`) paths. | Med (low-end Android) |

### 8.3 Startup & bundle size

| # | Finding | Fix | Impact |
|---|---|---|---|
| S1 | `assets/icon.png`, `splash-icon.png`, `adaptive-icon.png` are **1,655 KB each** (≈5 MB); total `assets/` ≈ **7.6 MB**; onboarding PNGs 160–350 KB each. `assetBundlePatterns: ["**/*"]` bundles everything. | Resize icons (1024², optimized, ~60–150 KB), convert illustrations to WebP/AVIF or compress 60–70%; use `expo-image` with cached/priority hints; restrict `assetBundlePatterns`. | High for APK size/first launch |
| S2 | `@stellar/stellar-sdk` (+ `stellar-base`) imported at the top of **14 modules** incl. screens loaded at startup (`LoadOffline/Online`, `SendMoneyConfirm`, `anchorService`, `walletConnector`, `crypto`). The SDK is large and parsed at launch. `unstable_enablePackageExports=false` + full `lib` build. | Lazy-load via `await import('@stellar/stellar-sdk')` inside the handlers that need it; lazy-load screens (`React.lazy`/navigation `getComponent`) for Funds/Send/Sep24/Restore. Measure TTI before/after (Hermes bytecode makes the gain smaller – measure). | High |
| S3 | `App.tsx` imports **all 15 screens eagerly** from `./src/screens` barrel and runs `ensureMigration()` **twice in parallel** (App + `connectionService` constructor + Dashboard + Onboarding) plus `runMigrations()`. | Single idempotent `bootstrap()` promise awaited once (memoized); show splash until done. | Med |
| S4 | `walletconnect/*`, `drizzle-orm`, `rxjs`, `css-tree` (why?), `qrcode` **and** `react-native-qrcode-svg`, `react-native-webview`, `expo-media-library`, `expo-sharing`, `expo-clipboard` in dependencies. Android permission `RECORD_AUDIO` requested with no obvious use. | Audit with `npx expo-doctor` + `npx depcheck`; drop unused (`css-tree`, duplicate QR lib, WalletConnect if unused for testnet build); remove `RECORD_AUDIO`. | Med (size + review friction) |
| S5 | Dev-oriented code in the release path: `AsyncStorage.removeItem('pijn.hide_offline_notice') // Ensure modal appears for testing` (Dashboard L162), `handleAddMockQueueItem` + `useMockTransactions`, verbose `console.*`. | Guard by `__DEV__`; strip console in production (`babel-plugin-transform-remove-console`). `console.log` through the bridge is measurably slow in release. | Low–Med |
| S6 | Test on a **release/`preview` APK** only (dev-client + Metro is 2–5× slower and masks real numbers). Hermes + New Arch (`newArchEnabled: true`) – verify all native libs (`react-native-webview 13.12`, `svg 15.8`, `screens 4.4`) are New-Arch compatible. | Add to build checklist. | – |

### 8.4 Offline-queue & sync correctness under load (perf-adjacent)

- *(Partly fixed in §3.1: batch cap 5, start jitter, stop on 429/5xx; per-item `nextRetryAt` backoff still open.)* `syncService.flush()` is **sequential with no batch cap, no backoff, no jitter**; every user that regains signal at the same moment (e.g., venue Wi-Fi at the test) posts to `/api/engine/settle` simultaneously → relayer contention (§2.1). Add **random start jitter (0–5s)**, max 5 items/flush, exponential backoff per item (`nextRetryAt` column), and stop on 429/5xx.
- Error classification: any exception → `markSyncError` and retried every flush; permanent vs transient not distinguished (see §3.1).
- `connectionService` flips `isOnlineMode` based on NetInfo `isConnected` (true on captive/blocked Wi-Fi) → false "online" triggers all of P1. Use `isInternetReachable` and a lightweight `/api/health` ping with 3s timeout before starting sync.
- `connectionService` constructor kicks off `init()` (AsyncStorage + `ensureMigration`) at import time, and `NetInfo.addEventListener` is never unsubscribed (singleton – acceptable, but make `init` race-safe).

### 8.5 Prioritized optimization backlog (do in this order)

| Order | Task | Effort | Verify with |
|---|---|---|---|
| 1 | **SyncCoordinator** (P1, P3, P8, §8.4 jitter/backoff) | M | Request count per app-open & per toggle (proxy via Charles/mitmproxy or backend logs) |
| 2 | **API client with timeout/abort/retry-jitter**, used by all screens (P6, P5, P7) | M | Simulated 3G + 5% packet loss; no hung spinner > 15s |
| 3 | **Name-resolution cache** (P2) | S | Requests on refresh with 30 offline rows: before N → after ≤ 1 |
| 4 | **Asset compression** (S1) + remove dead deps/permission (S4) | S | APK size, cold-start time |
| 5 | **Dashboard split + lazy tabs + LIMITed live query** (R1, R2, R5, R6) | M–L | React Profiler commits/render ms per interaction, JS FPS on mid-range Android |
| 6 | **SQLite upsert + indexes** (R3, R4) | S | `EXPLAIN QUERY PLAN`; time to upsert 50 rows |
| 7 | **Lazy-load Stellar SDK & heavy screens** (S2, S3) | M | Cold-start TTI via `adb shell am start -W` (TotalTime), Hermes bundle size |
| 8 | Onboarding slide virtualization / step components (R7, R9) | M | Time-to-interactive per slide, dropped frames |
| 9 | Remove debug/mock code + strip console in prod (S5) | S | Release build console silent |

### 8.6 Measurement protocol & experiment ledger (fill in as you go)

**Device matrix for the test:** at least one low-end (≤3 GB RAM, Android 10–12), one mid-range, one recent; release/preview APK; same Wi-Fi + one throttled run (3G profile).

**Baselines to capture first (before any change):**

| Metric | How | Budget |
|---|---|---|
| Cold start → interactive (Dashboard visible) | `adb shell am start -W -n <pkg>/.MainActivity` (TotalTime) ×5, median | < 3s mid-range, < 5s low-end |
| JS bundle size (Hermes `.hbc`) & APK size | `npx expo export --platform android` / EAS artifact | APK < 40 MB; JS bundle track trend |
| Requests per app-open and per pull-to-refresh | Backend request logs by `shortId` + Charles | ≤ 4 on open, ≤ 3 on refresh |
| Sequential onboarding time (OTP → Dashboard) | Stopwatch + per-step `console.time` in dev build | < 30s p95 |
| Dashboard interaction FPS / long tasks | React DevTools Profiler + Perf Monitor overlay | ≥ 55 FPS UI & JS during tab swipe/refresh |
| Memory after 10 min use | Android Studio Profiler | No monotonic growth (timer/listener leaks) |
| Backend p95 under 50 virtual users | k6 script (§4) | p95 < 2s non-chain; error < 1% |

**Experiment ledger** (copy rule: a change that doesn't beat run-to-run noise is **reverted**):

| Idea | Baseline → Result | Verdict | Why |
|---|---|---|---|
| _SyncCoordinator + 15s throttle_ | _TBD_ | _TBD_ | |
| _Name cache_ | _TBD_ | _TBD_ | |
| _Compress icons/illustrations_ | _TBD_ | _TBD_ | |
| _Lazy tabs_ | _TBD_ | _TBD_ | |
| _Lazy Stellar SDK_ | _TBD_ | _TBD_ | May be noise under Hermes – measure before keeping |

**Regression guards:** Maestro/Detox smoke flow in CI on a release build; EAS build size check; Sentry Performance (app start, slow/frozen frames, HTTP spans) with alerts on p75 app-start and HTTP error rate.

### 8.7 Interaction with backend work (so the two plans don't fight)

- P1/P2/P4/P5 only fully pay off if the backend adds `limit`/`since` params and caches `vault-balance` (§2.3, §7.4) – land them additively so the current APK keeps working.
- Rate limits you add on `users/lookup`, `transactions`, `wallet/history` (§1.1) **will 429 today's chatty client** – ship the SyncCoordinator + name cache first, then turn limits on. *(Update: `users/lookup` is limited at a deliberately high 300/min per IP to avoid this; tighten after the name cache ships.)*
- If the relayer moves to a queue returning `202 + poll` (§2.1), P5's polling must target the new status endpoint, not Soroban RPC.

---

## 9. Open Questions for You

1. ~~Is the production API host `pijin.live` or `pijin-api.vercel.app`?~~ **Answered: `pijin-api.vercel.app`.**
2. Vercel plan (function timeout, concurrency limits) and Neon plan (connection limit)?
3. Will all 50 users sign up in the same short window, or staggered? (Drives Friendbot/relayer/SMS design.)
4. How many TextBee devices/SIMs are available, and what are the SIM's SMS limits?
5. Should the ramp be **fully locked** for the test, or limited (amount-capped) for a subset of users?
6. Are existing `.env` secrets ever committed to git history? (If yes → rotate.)

> [!IMPORTANT]
> Items 1–5 in the *Top Risks* table are fixed in code (§1.1) but **remain exploitable until the backend is deployed**, and risk 3 is fully closed only after `REQUIRE_OTP_TOKEN=true`. Treat deployment as a blocker before any external testers are onboarded.
