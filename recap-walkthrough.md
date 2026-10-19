# Pijin Recap Walkthrough & Environment Configuration

> **Branch:** `refactor/end-to-end-integration`  
> **Reference Documents:** [task-1.1-changes.md](file:///d:/OmniFi/task-1.1-changes.md) · [task-1.2-changes.md](file:///d:/OmniFi/task-1.2-changes.md) · [task-3.1-changes.md](file:///d:/OmniFi/task-3.1-changes.md) · [test-50users-plan.md](file:///d:/OmniFi/test-50users-plan.md)  
> **Latest Commit:** `6282537` ("Pijin improvements that needed some reviews")

---

## 1. Executive Summary

During the recent refactoring phase on branch `refactor/end-to-end-integration`, comprehensive security, delivery optimization, and mobile resilience enhancements were implemented across `apps/backend` and `apps/mobile`. These changes resolve critical vulnerabilities discovered during the 50-user testnet readiness audit, prevent telecommunication bottlenecks on the physical SMS gateway, and protect the mobile client against network instability and crash scenarios.

```
┌───────────────────────────────────────────────────────────────────────────────────────┐
│                               CORE SYSTEM ENHANCEMENTS                                │
├───────────────────────┬────────────────────────────┬──────────────────┬───────────────┤
│  Task 1.1: Security   │   Task 1.2: SMS Gateway    │ Task 3.1: Mobile │  Concurrency  │
├───────────────────────┼────────────────────────────┼──────────────────┼───────────────┤
│ • Plaintext PIN leak  │ • Single resilient sender  │ • ErrorBoundary  │ • Redis mutex │
│   eliminated          │   with fallback gateway    │ • Central client │   relayer lock│
│ • scrypt PIN hashing  │ • Inline 8s OTP budget     │ • SEP-10 reauth  │ • Custom 5XLM │
│ • Server PIN verify   │ • QStash throttled queue   │ • Sync jitter    │   distributor │
│ • 30-min OTP token    │ • Health probe (?deep=1)   │ • Watcher bug    │ • Jittered    │
│ • Strict rate limits  │ • Emergency tester bypass  │   lifecycle fix  │   tx_bad_seq  │
│ • Forced USER role    │ • 60s mobile cooldown      │ • Sequential init│   retry loop  │
└───────────────────────┴────────────────────────────┴──────────────────┴───────────────┘
```

---

## 2. Detailed Recap: What Was Changed and Why

### Task 1.1 – Secure the Sign-Up Process

#### What Changed
1. **Plaintext PIN Leakage Eliminated:**
   - [GET /api/users/check](file:///d:/OmniFi/apps/backend/app/api/users/check/route.ts): Removed `pin` from the JSON response and restricted Prisma selection (`select: { stellarPublicKey: true, shortId: true }`).
   - [lib/settlement.ts](file:///d:/OmniFi/apps/backend/lib/settlement.ts): Stripped the user PIN from settlement receipt SMS messages (changed from `SUCCESS: Received X stroops. PIN:...` to `SUCCESS: Received X stroops.`).
2. **Server-Side PIN Hashing & Verification:**
   - Created [lib/pin.ts](file:///d:/OmniFi/apps/backend/lib/pin.ts): Implemented `hashPin` using Node.js `crypto.scrypt` (`scrypt$16384$8$1$<salt>$<hash>`) with constant-time equality checks (`timingSafeEqual`).
   - Created [POST /api/auth/pin/verify](file:///d:/OmniFi/apps/backend/app/api/auth/pin/verify/route.ts): Server-side verification with an attempt counter in Redis (`pijin:pin:fail:<digits>`). Exceeding 5 failures locks the account for 15 minutes (HTTP `423 Locked`). Transparently migrates legacy plaintext PINs to scrypt hashes on successful login.
   - [SignInScreen.tsx](file:///d:/OmniFi/apps/mobile/src/screens/SignInScreen.tsx): Mobile sign-in uses `verifyPinWithServer` instead of receiving the PIN from `/users/check` and verifying client-side.
3. **Cryptographic OTP Verification Token:**
   - [POST /api/otp/verify](file:///d:/OmniFi/apps/backend/app/api/otp/verify/route.ts): Returns a signed 30-minute HS256 JWT (`verificationToken`) bound strictly to the normalized phone number.
   - [POST /api/register](file:///d:/OmniFi/apps/backend/app/api/register/route.ts): Enforces the verification token (`verifyVerificationToken`), strictly assigns `role: "USER"` (ignoring client role inputs), checks for duplicate public keys AND phone numbers (`409 Conflict`), and stores PINs as scrypt hashes.
   - [OnboardingScreen.tsx](file:///d:/OmniFi/apps/mobile/src/screens/OnboardingScreen.tsx): Captures `verificationToken` from OTP verification and forwards it during account registration.
4. **Anti-Abuse Rate Limiting:**
   - Created [lib/rate-limit.ts](file:///d:/OmniFi/apps/backend/lib/rate-limit.ts): Shared Redis sliding-window limiters with first-hop IP detection from `x-forwarded-for`.
   - Rate limited: `/api/register` (30 per 10 min), `/api/users/check` (60/min), `/api/users/lookup` (300/min), `/api/friendbot` (20/min per IP + 3/hour per key).
   - OTP generation is now uniform (`000000–999999`), capped at 5 wrong guesses before burning the code, and debug logs are suppressed in production.

#### Why It Was Necessary
- **Critical Data Leak:** Anyone knowing a user's phone number could retrieve their plaintext PIN from `/api/users/check`.
- **Unencrypted Transmission:** Cellular SMS receipts transmitted plaintext PINs over carrier networks.
- **Unauthenticated Registration:** The previous registration endpoint did not prove that a user verified their phone number via SMS OTP, allowing attackers to hijack numbers or flood the database with bogus accounts.
- **Privilege Escalation:** Clients could send `role: "ADMIN"` in the registration payload.

---

### Task 1.2 – Optimize TextBee (SMS Gateway)

#### What Changed
1. **Unified SMS Delivery Engine:**
   - [lib/sms.ts](file:///d:/OmniFi/apps/backend/lib/sms.ts): Consolidated two divergent SMS libraries (`lib/sms.ts` and `lib/textbee.ts`) into a single robust sender `deliverSms`.
   - Implemented per-attempt timeouts, overall deadlines, intelligent retry categorization (retries only on network drops, `408`, `429`, `5xx`; never on invalid recipients or non-retryable `4xx`), SIM slot selection, and automatic failover to a configured secondary device (`TEXTBEE_FALLBACK_*`).
2. **Inline, Timed OTP Delivery with Clear Feedback:**
   - [POST /api/otp/send](file:///d:/OmniFi/apps/backend/app/api/otp/send/route.ts): Uses an 8-second execution budget (guaranteeing completion within Vercel's 10-second serverless execution window).
   - If TextBee fails, returns HTTP `502 { code: "SMS_FAILED" }` and immediately invalidates the unreceived code in Redis so the user is not left waiting.
3. **Asynchronous Throttled SMS Dispatch (QStash):**
   - Created [lib/sms-queue.ts](file:///d:/OmniFi/apps/backend/lib/sms-queue.ts) and [POST /api/sms/dispatch](file:///d:/OmniFi/apps/backend/app/api/sms/dispatch/route.ts).
   - High-volume transaction receipts and settlement failure notices are offloaded to Upstash QStash with flow control: **10 messages per minute, concurrency 1**, with deduplication keys (`settle-ok-...`, `settle-fail-...`) and automatic fallbacks to direct send if QStash is unavailable.
4. **Gateway Health Probe & Emergency Tester Mode:**
   - [GET /api/health](file:///d:/OmniFi/apps/backend/app/api/health/route.ts): Surfaces `features.smsOtp`. When invoked with `?deep=1`, probes TextBee device heartbeats (cached for 30s in Redis) and marks API health as `degraded` if gateways are offline.
   - [lib/otp.ts](file:///d:/OmniFi/apps/backend/lib/otp.ts): Provides an emergency tester bypass via `OTP_TEST_MODE`, `OTP_TEST_NUMBERS`, and `OTP_TEST_CODE` for zero-SMS signups during carrier outages.
5. **Mobile Resend Throttling:**
   - [OnboardingScreen.tsx](file:///d:/OmniFi/apps/mobile/src/screens/OnboardingScreen.tsx): Added a 60-second visual countdown on the "Resend Code" button, respects `Retry-After` headers on HTTP `429`, and unlocks immediately if an HTTP `502` occurs.

#### Why It Was Necessary
- **Physical SIM Bottleneck:** TextBee routes messages through an Android phone SIM card. Sending 50 simultaneous settlement receipts would saturate the SIM queue, delaying OTP verification codes for several minutes.
- **Silent Failures:** The old OTP endpoint returned HTTP 200 even when TextBee failed, leaving prospective users stuck waiting for non-existent SMS messages.
- **Serverless Premature Freezing:** Vercel functions terminate background asynchronous promises upon HTTP response completion unless awaited or queued externally.

---

### Task 3.1 – Mobile Reliability & Offline Hardening

#### What Changed
1. **Application Error Boundary & Crash Reporting:**
   - Created [ErrorBoundary.tsx](file:///d:/OmniFi/apps/mobile/src/components/ErrorBoundary.tsx) and [errorReporting.ts](file:///d:/OmniFi/apps/mobile/src/services/errorReporting.ts).
   - Wrapped [App.tsx](file:///d:/OmniFi/apps/mobile/App.tsx) with a global boundary displaying an alert and "Try again" recovery action, preventing app crashes from rendering faults.
2. **Centralized Resilient API Client:**
   - Refactored [services/api/client.ts](file:///d:/OmniFi/apps/mobile/src/services/api/client.ts) to provide `apiFetch`, `apiRequest`, and `fetchWithTimeout`.
   - Replaced all raw `fetch()` calls in [LoadOfflineFundsScreen.tsx](file:///d:/OmniFi/apps/mobile/src/screens/LoadOfflineFundsScreen.tsx), [LoadOnlineFundsScreen.tsx](file:///d:/OmniFi/apps/mobile/src/screens/LoadOnlineFundsScreen.tsx), [SendMoneyScreen.tsx](file:///d:/OmniFi/apps/mobile/src/screens/SendMoneyScreen.tsx), [SendMoneyConfirmScreen.tsx](file:///d:/OmniFi/apps/mobile/src/screens/SendMoneyConfirmScreen.tsx), and wallet sync routines.
   - Built-in request timeouts (15s standard, 25s for transaction assembly, 20s for Friendbot).
   - Automatic retry with exponential backoff and jitter for idempotent `GET` requests (POST actions remain strictly single-attempt).
   - Silent SEP-10 Re-authentication: On HTTP `401`, automatically requests a new SEP-10 token signed with the stored local key and retries once transparently.
   - Safe header handling: Only injects default JWTs if the caller did not supply custom authorization (preventing breakage of signature-authenticated `/api/engine/*` routes).
3. **Canonical Backend Routing:**
   - Updated [constants/api.ts](file:///d:/OmniFi/apps/mobile/src/constants/api.ts) to establish `https://pijin-api.vercel.app` as the single source of truth, enforcing HTTPS in production release builds.
4. **Sync Service Resilience:**
   - [services/syncService.ts](file:///d:/OmniFi/apps/mobile/src/services/syncService.ts): Enforces a cap of 5 posts per flush, introduces 0–3s start jitter on automatic reconnection to prevent server spikes, and classifies errors into permanent `FAILED` vs transient/rejected states.
5. **ConnectionWatcher Bug Fix:**
   - [ConnectionWatcher.tsx](file:///d:/OmniFi/apps/mobile/src/components/ui/ConnectionWatcher.tsx): Fixed a race condition where showing the offline banner caused the React effect to re-run, clearing the 3-second redirect timer and freezing the countdown.
6. **Sequential App Startup:**
   - [App.tsx](file:///d:/OmniFi/apps/mobile/App.tsx): Sequences `ensureMigration()` → `runMigrations()` → `syncService.start()`, holding the splash screen until local storage is ready and offering an explicit retry button if initialization fails.

#### Why It Was Necessary
- **Hanging Spinners:** Raw `fetch()` calls without timeout controllers caused infinite loading spinners when connections dropped in low-connectivity areas.
- **Thundering Herd:** When 50 devices simultaneously reconnected to venue Wi-Fi, un-throttled sync services would flood backend routes.
- **Authentication Expiration Drops:** Expired SEP-10 sessions forced users to restart flows rather than refreshing credentials behind the scenes.
- **Broken Mode Redirection:** The previous connection watcher never actually redirected users to the offline dashboard due to recursive effect teardowns.

---

### Concurrency Hardening – Upstash Redis Mutex for the Single Relayer

#### What Changed
1. **Distributed Mutex Lock Utility:**
   - Created [lib/redis-lock.ts](file:///d:/OmniFi/apps/backend/lib/redis-lock.ts) and re-exported in [lib/rate-limit.ts](file:///d:/OmniFi/apps/backend/lib/rate-limit.ts):
     - `acquireRelayerLock()`: Uses `redis.set("pijin:relayer:lock", "locked", { nx: true, ex: 5 })` to acquire an exclusive lock with a 5-second automatic TTL to guarantee deadlock safety.
     - `releaseRelayerLock()`: Deletes the key upon transaction broadcast completion.
     - `setLockRedisForTesting()`: Allows injecting mock Redis instances for offline testing.
2. **Critical Section Protection in Two-Phase Settlement:**
   - [lib/stellar-transaction-manager.ts](file:///d:/OmniFi/apps/backend/lib/stellar-transaction-manager.ts): Wrapped the critical section of `executeTwoPhaseSettlement()` in an acquisition wait loop:
     ```typescript
     const maxWaitMs = 20_000;
     const startWait = Date.now();
     while (!(await acquireRelayerLock())) {
       if (Date.now() - startWait > maxWaitMs) {
         throw new Error(`Timeout waiting for relayer lock after ${maxWaitMs}ms`);
       }
       await new Promise((resolve) => setTimeout(resolve, 200)); // check every 200ms
     }
     try {
       // 1. Fetch latest relayer sequence from network
       // 2. Build & simulate Soroban footprint
       // 3. Sign & persist pre-hash to DB
       // 4. Submit signed transaction to RPC mempool
     } finally {
       await releaseRelayerLock();
     }
     // Phase 3: Bounded polling runs OUTSIDE the lock
     ```
   - Polling for final confirmation runs **outside** the lock, freeing the relayer account sequence immediately so queued serverless invocations can advance.

#### Why It Was Necessary
- **Sequence Number Collisions (`tx_bad_seq`):** All settlement submissions share a single serverless `RELAYER_SECRET_KEY`. When multiple users settle concurrently, multiple instances read the identical sequence number from the network and broadcast conflicting transactions, causing all but the first to fail with `tx_bad_seq`. The Redis mutex serializes sequence assignment cleanly without holding up long polling cycles.

---

### Concurrency Hardening – Custom Distributor & Jittered Retry Loop for Friendbot

#### What Changed
1. **Replaced Public Friendbot with Dedicated On-Chain Distributor:**
   - Rewrote [app/api/friendbot/route.ts](file:///d:/OmniFi/apps/backend/app/api/friendbot/route.ts): Replaced the upstream call to `https://friendbot.stellar.org` with direct on-chain funding using Stellar SDK `TransactionBuilder` and `Operation.createAccount` with `startingBalance: "5.0000000"` (5 XLM).
   - Signs transactions using the server's `PHPC_DISTRIBUTOR_SECRET` (or `USDC_DISTRIBUTOR_SECRET`).
2. **Jittered Retry Loop (10 Attempts) for Sequence Races:**
   - Implemented an automatic retry loop up to 10 attempts to handle concurrent distributor requests during mass signups.
   - If `sorobanRpcServer.sendTransaction` or `getAccount` encounters `tx_bad_seq`, the handler calculates a random jitter delay between 500ms and 1500ms (`500 + Math.random() * 1000`), sleeps, re-fetches the distributor's latest sequence number, and retries.
3. **Idempotent Destination Account Check:**
   - Detects `createAccountAlreadyExist` / `op_already_exists` errors; if the account is already initialized on-chain, it returns `200 OK` rather than failing.
4. **Secret Key Redaction in Logs:**
   - Error messages and failure payloads sanitize any matching secret pattern (`/S[A-Z2-7]{55}/g -> "[REDACTED_SECRET]"`) ensuring credentials never leak to serverless logs or client responses.

#### Why It Was Necessary
- **Venue Wi-Fi IP Rate Limiting:** Public SDF Friendbot throttles requests aggressively by client IP. Having 50 participants onboarding simultaneously from the same venue network would quickly trigger `429 Too Many Requests` on Friendbot and break new user registrations.
- **Distributor Sequence Contention:** Because the backend funds accounts from its own distributor key, multiple signups at the exact same moment race for the distributor's sequence number. The jittered backoff loop allows multiple concurrent registrations to self-heal and succeed without user intervention.

---

### Task 1.3 – Lock the On/Off Ramp (Security & Abuse Prevention)

#### What Changed
1. **Centralized Ramp Configuration & Kill Switches:**
   - Created [lib/ramp-config.ts](file:///d:/OmniFi/apps/backend/lib/ramp-config.ts): Implemented centralized kill switch functions (`isRampEnabled`, `isDepositEnabled`, `isWithdrawEnabled`, `enforceRampKillSwitch`) that return HTTP `503 { code: "RAMP_LOCKED" }` when maintenance modes are active.
   - Enforced in [POST /api/anchor/simulate-payment](file:///d:/OmniFi/apps/backend/app/api/anchor/simulate-payment/route.ts), [POST /api/anchor/submit-withdraw](file:///d:/OmniFi/apps/backend/app/api/anchor/submit-withdraw/route.ts), [POST /api/anchor/confirm-withdraw](file:///d:/OmniFi/apps/backend/app/api/anchor/confirm-withdraw/route.ts), and SEP-24 interactive routes ([deposit/interactive](file:///d:/OmniFi/apps/backend/app/api/sep24/transactions/deposit/interactive/route.ts), [withdraw/interactive](file:///d:/OmniFi/apps/backend/app/api/sep24/transactions/withdraw/interactive/route.ts)).
   - Public capability manifest [GET /api/sep24/info](file:///d:/OmniFi/apps/backend/app/api/sep24/info/route.ts) dynamically advertises `deposit.enabled` and `withdraw.enabled` based on these environment kill switches.
2. **Authenticated Settlement with Short-Lived Interactive JWT:**
   - Closed the major security gap in `simulate-payment` (previously unauthenticated).
   - Deposit webviews ([DepositForm.tsx](file:///d:/OmniFi/apps/backend/app/deposit/DepositForm.tsx) and [page.tsx](file:///d:/OmniFi/apps/backend/app/deposit/page.tsx)) now pass the short-lived SEP-24 interactive token to `simulate-payment`.
   - `simulate-payment` cryptographically verifies the interactive JWT (`verifyInteractiveToken`), validates that `payload.transaction_id === transaction_id` and `payload.sub === anchorTx.stellarAccount`, and marks the token consumed in Redis (`claimInteractiveTokenOnce`) to guarantee single-use replay protection.
3. **Transaction Caps & Daily Per-User Velocity Limits:**
   - Enforced server-side caps in `validateRampLimits`:
     - **PHPC:** ₱5,000 per transaction, ₱20,000 daily limit per Stellar account.
     - **USDC:** $100 per transaction, $400 daily limit per Stellar account.
   - Validated against the caller's cumulative settlements for the current UTC day.
4. **Atomic Status Guard (Concurrency & Double-Settlement Defense):**
   - Replaced fragile read-then-write logic with atomic Prisma transitions (`updateMany({ where: { id, status: 'incomplete' }, data: { status: 'pending_external' } })`).
   - Prevents duplicate minting or double payout submissions even under concurrent requests.
5. **Structured Audit Logging:**
   - Added `logRampAudit`: Logs every deposit and withdrawal initiation, completion, rejection, and failure with user public key, amount, asset, client IP, and Stellar transaction hash.

#### Why It Was Necessary
- **Unauthenticated Minting Hazard:** Anyone knowing or generating a valid transaction UUID could previously call `/api/anchor/simulate-payment` without authentication to mint tokens from the server's distributor key.
- **Ramp Runaway & Testnet Drain:** Without per-transaction caps and daily limits, testnet distributor funds could easily be drained by a few heavy users or automated scripts.
- **Maintenance Safety:** System operators need an immediate kill switch (`RAMP_ENABLED=false`) to halt all on/off ramp operations during venue audits or smart contract updates.

---

### Task 2.3 – Backend Efficiency & High-Concurrency Optimization

#### What Changed
1. **High-Performance Database Indexing:**
   - Updated [prisma/schema.prisma](file:///d:/OmniFi/apps/backend/prisma/schema.prisma) with compound and selective query indexes:
     - `Account`: `@@index([phoneNumber])` for instant lookup during sign-in and duplicate checks.
     - `Settlement`: `@@index([senderShortId, createdAt])` and `@@index([receiverShortId, createdAt])` for rapid history aggregation.
     - `AnchorTransaction`: `@@index([stellarAccount, createdAt])` for instant user deposit/withdrawal timeline queries.
   - Regenerated Prisma Client (`npx prisma generate`).
2. **Multi-Tier Redis Caching (5-Second TTL):**
   - Added 5-second Redis caching to balance endpoints:
     - [GET /api/vault-balance](file:///d:/OmniFi/apps/backend/app/api/vault-balance/route.ts): Caches on-chain Soroban vault balances (`pijin:cache:vault-balance:<publicKey>`).
     - [GET /api/wallet/balance](file:///d:/OmniFi/apps/backend/app/api/wallet/balance/route.ts): Caches Horizon trustline balances (`pijin:cache:wallet-balance:<publicKey>:<assetCode>`).
   - Added 5-second Redis caching to transaction history queries:
     - [GET /api/wallet/history](file:///d:/OmniFi/apps/backend/app/api/wallet/history/route.ts) and [GET /api/transactions](file:///d:/OmniFi/apps/backend/app/api/transactions/route.ts).
   - Added `Cache-Control: public, s-maxage=5, stale-while-revalidate=5` and `X-Cache: HIT|MISS` headers to let CDN edge nodes offload repeated polling.
3. **Pagination & Date Range Filtering:**
   - Added support for `limit` (bounded between 1 and 100, default 50) and `since` (ISO 8601 date filter) to `/api/wallet/history` and `/api/transactions`.
4. **Comprehensive System Health Probe:**
   - Enhanced [GET /api/health](file:///d:/OmniFi/apps/backend/app/api/health/route.ts):
     - Executes live dependency probes: Neon Postgres (`SELECT 1`), Upstash Redis (`ping`), and Soroban RPC (`getHealth`).
     - Returns dynamic feature flags: `features: { ramp, deposit, withdraw, smsOtp, demo }`.
     - Supports `?deep=1` for TextBee device status probing.

#### Why It Was Necessary
- **Database CPU Spikes:** 50 mobile clients simultaneously polling transaction history and account profiles would cause full table scans without indexes on `phoneNumber`, `senderShortId`, and `stellarAccount`.
- **RPC & Horizon Rate Limiting:** Mobile clients poll balances frequently upon opening screens. A 5-second Redis cache shields public Horizon and Soroban nodes from being throttled, delivering sub-15ms balance responses.

---

## 3. Environment Variables Setup

### 3.1 Backend Configuration (`apps/backend`)

Copy `apps/backend/.env.example` to `apps/backend/.env` for local development or configure them in the **Vercel Project Dashboard** under **Settings > Environment Variables**.

```
apps/backend/
├── .env.example              # Template
└── .env                      # Local development (git-ignored)
```

#### Complete Backend Environment Variable Reference

| Variable | Required In | Default / Example | Purpose & Notes |
|:---|:---:|:---|:---|
| **GENERAL & HOSTING** | | | |
| `NODE_ENV` | All | `development` / `production` | Set to `production` on Vercel. Controls log suppression (e.g., OTP codes). |
| `NEXT_PUBLIC_APP_URL` | All | `http://localhost:3000` / `https://pijin-api.vercel.app` | Host domain used for QStash webhook targeting and callback routing. |
| `CORS_ORIGIN` | All | `*` | Allowed CORS origins. |
| `OFFLINE_TRANSACTION_DEBUG` | Dev | `true` (false in prod) | Enables verbose debugging logs for offline settlement transactions. |
| `DEMO_ENABLED` | All | `false` (in prod during 50-user test) | Feature flag for judge/demo simulator accounts and endpoints. |
| **DATABASE** | | | |
| `DATABASE_URL` | All | `postgresql://user:pass@host/pijin?sslmode=require` | Neon PostgreSQL pooled connection string (`-pooler.region.neon.tech`). |
| **STELLAR & SOROBAN RPC** | | | |
| `SOROBAN_RPC_URL` | All | `https://soroban-testnet.stellar.org` | Soroban RPC endpoint for contract interaction. |
| `STELLAR_NETWORK_PASSPHRASE` | All | `Test SDF Network ; September 2015` | Network passphrase (Testnet vs Mainnet). |
| `STELLAR_HORIZON_URL` | All | `https://horizon-testnet.stellar.org` | Horizon API URL. |
| `CONTRACT_ID` | All | `CCGX...` | Deployed Pijin smart contract address. |
| `TOKEN_ID` | All | `CD26...` | Soroban SAC or token contract address. |
| `OFFLINE_TOKEN_SYMBOL` | All | `PHPC` | Asset symbol for offline payments. |
| **CORE KEYPAIRS (SERVER-SIDE)** | | | |
| `RELAYER_PUBLIC_KEY` | All | `G...` | Public key of the account paying fees and signing engine transactions. |
| `RELAYER_SECRET_KEY` | All | `S...` | **Secret key** for the relayer. Keep secure! |
| `REGISTRAR_PUBLIC_KEY` | All | `G...` | Public key of the account authorized to register offline keys on-chain. |
| `REGISTRAR_SECRET_KEY` | All | `S...` | **Secret key** for the registrar. |
| `TREASURY_PUBLIC_KEY` | All | `G...` | Treasury account receiving settlement fees. |
| `PHPC_ISSUER_PUBKEY` | All | `G...` | Classic issuer for PHPC token. |
| `PHPC_DISTRIBUTOR_SECRET`| All | `S...` | Distributor secret used for funding new accounts (5 XLM each via `/api/friendbot`) and minting test balances. Ensure account holds at least 300+ XLM on Testnet. |
| `USDC_ISSUER_PUBKEY` | All | `G...` | Classic issuer for USDC token. |
| `USDC_DISTRIBUTOR_SECRET`| All | `S...` | Distributor secret used for USDC. |
| **TEXTBEE SMS GATEWAY** | | | |
| `TEXTBEE_GATEWAY_URL` | All | `https://api.textbee.dev/api/v1/gateway/devices/<ID>/send-sms` | Primary TextBee outbound SMS endpoint. |
| `TEXTBEE_DEVICE_ID` | All | `<device-uuid>` | Primary Android device ID registered in TextBee dashboard. |
| `TEXTBEE_API_KEY` | All | `<api-key>` | TextBee API key (sent in `x-api-key` header). |
| `TEXTBEE_WEBHOOK_SECRET` | All | `<webhook-secret>` | HMAC secret used to verify incoming offline transaction webhooks. |
| `TEXTBEE_SIM_SUBSCRIPTION_ID`| Optional | `1` (or `2`) | Optional dual-SIM slot index (0-indexed or 1-indexed per carrier). |
| `TEXTBEE_TIMEOUT_MS` | All | `4500` | Per-attempt HTTP timeout for SMS gateway calls. |
| `TEXTBEE_RETRIES` | All | `2` | Number of retries on network or 5xx gateway failures. |
| `TEXTBEE_FALLBACK_DEVICE_ID` | Optional | `<fallback-device-uuid>` | Secondary Android device ID if primary is offline. |
| `TEXTBEE_FALLBACK_GATEWAY_URL`| Optional | `https://api.textbee.dev/...` | Secondary device outbound endpoint. |
| `TEXTBEE_FALLBACK_API_KEY` | Optional | `<fallback-key>` | Secondary API key (defaults to primary if empty). |
| `TEXTBEE_FALLBACK_SIM_SUBSCRIPTION_ID`| Optional| `1` | Secondary device SIM index. |
| **UPSTASH REDIS & QSTASH** | | | |
| `UPSTASH_REDIS_REST_URL` | All | `https://<instance>.upstash.io` | Upstash Redis REST URL (used for rate limits, OTPs, locks). |
| `UPSTASH_REDIS_REST_TOKEN`| All | `<token>` | Upstash Redis REST bearer token. |
| `QSTASH_URL` | All | `https://qstash.upstash.io` | Upstash QStash message broker URL. |
| `QSTASH_TOKEN` | All | `<token>` | Bearer token to enqueue background SMS jobs. |
| `QSTASH_CURRENT_SIGNING_KEY`| All | `sig_...` | Key used to verify inbound signatures on `/api/sms/dispatch`. |
| `QSTASH_NEXT_SIGNING_KEY` | All | `sig_...` | Next signing key for rotation. |
| **SIGN-UP SECURITY (NEW IN 1.1 & 1.2)** | | | |
| `OTP_VERIFICATION_JWT_SECRET`| **Critical** | `generate-a-random-32-byte-hex` | **HS256 secret** used to sign and verify phone verification tokens. Must be unique! |
| `REQUIRE_OTP_TOKEN` | All | `false` (initially) → `true` | When `false`, backward compatibility for older APKs. Set `true` once all testers install new APK! |
| `OTP_GLOBAL_LIMIT_PER_HOUR` | All | `300` | Total hourly ceiling for OTP SMS to preserve SIM plan quota. |
| `OTP_TEST_MODE` | Testing | `false` | Emergency switch: bypasses SMS delivery if TextBee goes down. |
| `OTP_TEST_NUMBERS` | Testing | `+639171234567,+639189876543` | Comma-separated list of whitelisted phone numbers. |
| `OTP_TEST_CODE` | Testing | `123456` | Fixed 6-digit code for whitelisted test numbers. |
| **SEP-10 & SEP-24 AUTHENTICATION** | | | |
| `SECRET_SEP10_SIGNING_SEED`| All | `S...` | Stellar secret key used to sign SEP-10 challenge transactions. |
| `SECRET_SEP10_JWT_SECRET` | All | `<32-byte-hex>` | Secret key for SEP-10 authentication JWT tokens. |
| `SEP10_HOME_DOMAINS` | All | `localhost:3000,pijin-api.vercel.app` | Allowed SEP-10 home domains. |
| `SECRET_SEP24_INTERACTIVE_URL_JWT_SECRET`| All | `<separate-jwt-secret>` | Secret key for SEP-24 interactive deposit/withdraw webview sessions. |

---

### 3.2 Mobile Configuration (`apps/mobile`)

Copy `apps/mobile/.env.example` to `apps/mobile/.env` or configure inside `eas.json` for Expo Application Services (EAS) preview/release builds.

```
apps/mobile/
├── .env.example              # Template
└── .env                      # Local / Expo development (git-ignored)
```

#### Complete Mobile Environment Variable Reference

| Variable | Required In | Recommended Value | Notes |
|:---|:---:|:---|:---|
| `EXPO_PUBLIC_API_BASE_URL` | All | `https://pijin-api.vercel.app` (prod) or `http://<LAN_IP>:3000` (local) | The primary backend URL. Must use `https://` in release APK builds. |
| `EXPO_PUBLIC_ANCHOR_DOMAIN`| All | `pijin-api.vercel.app` | Domain for SEP-10 / SEP-24 anchor discovery. Automatically derived from API URL if omitted. |
| `EXPO_PUBLIC_SOROBAN_RPC_URL`| All | `https://soroban-testnet.stellar.org` | Soroban RPC provider. |
| `EXPO_PUBLIC_HORIZON_URL` | All | `https://horizon-testnet.stellar.org` | Stellar Horizon URL. |
| `EXPO_PUBLIC_STELLAR_NETWORK_PASSPHRASE` | All | `Test SDF Network ; September 2015` | Stellar network passphrase. |
| `EXPO_PUBLIC_STELLAR_WALLET_CHAIN` | All | `stellar:testnet` | Chain identifier. |
| `EXPO_PUBLIC_CONTRACT_ID` | All | `CCGX...` | Must match backend `CONTRACT_ID`. |
| `EXPO_PUBLIC_TOKEN_ID` | All | `CD26...` | Must match backend `TOKEN_ID`. |
| `EXPO_PUBLIC_TOKEN_DB_ID` | All | `1` | Database reference ID for offline token. |
| `EXPO_PUBLIC_GATEWAY_PUBLIC_KEY` | All | `G...` | Public key of the relayer gateway. |
| `EXPO_PUBLIC_PHPC_ISSUER_PUBKEY` | All | `G...` | Must match backend `PHPC_ISSUER_PUBKEY`. |
| `EXPO_PUBLIC_USDC_ISSUER_PUBKEY` | All | `G...` | Must match backend `USDC_ISSUER_PUBKEY`. |
| `EXPO_PUBLIC_SMS_GATEWAY_NUMBER` | All | `+639912345678` | Phone number of the Android phone running TextBee (target for offline SMS vouchers). |
| `EXPO_PUBLIC_SMS_SIMULATE_SECRET`| Dev only | `dev-secret` | Debug secret for local voucher testing. Strip from release builds! |

---

## 4. Step-by-Step Deployment & Migration Guide

To ensure zero downtime and prevent locking out active mobile app testers, follow this phased rollout plan:

```mermaid
flowchart TD
    A["Step 1: Configure Vercel Env<br/>(Set OTP_VERIFICATION_JWT_SECRET,<br/>Keep REQUIRE_OTP_TOKEN=false)"] --> B["Step 2: Deploy Backend to Vercel"]
    B --> C["Step 3: Verify Health Probe<br/>GET /api/health?deep=1"]
    C --> D["Step 4: Build & Distribute New APK<br/>(Contains Token forwarding & ErrorBoundary)"]
    D --> E["Step 5: Verify Live Signups & Pin Verification"]
    E --> F["Step 6: Flip REQUIRE_OTP_TOKEN=true in Vercel<br/>(Full Protection Active)"]
```

### Phase 1: Vercel Backend Configuration
1. Open your Vercel project dashboard at `pijin-api.vercel.app`.
2. Generate a secure 32-byte secret for OTP tokens (e.g. `node -e "console.log(crypto.randomBytes(32).toString('hex'))"`).
3. Add the following environment variables to **Production** and **Preview**:
   ```ini
   OTP_VERIFICATION_JWT_SECRET="<generated-secret>"
   REQUIRE_OTP_TOKEN="false"
   OTP_GLOBAL_LIMIT_PER_HOUR="300"
   ```
4. Verify that `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, and `QSTASH_NEXT_SIGNING_KEY` are populated.
5. Deploy the backend:
   ```bash
   git push origin refactor/end-to-end-integration
   ```

### Phase 2: Post-Deployment Smoke Test
Verify the deployment with these quick curl commands:
```bash
# 1. Health check with TextBee device status probe
curl "https://pijin-api.vercel.app/api/health?deep=1"

# 2. Verify /api/users/check NEVER exposes PIN
curl "https://pijin-api.vercel.app/api/users/check?phone=09171234567"

# 3. Test PIN verification route lockout (returns 400 for missing fields)
curl -X POST "https://pijin-api.vercel.app/api/auth/pin/verify" \
  -H "Content-Type: application/json" \
  -d "{\"phoneNumber\":\"09171234567\",\"pin\":\"0000\"}"
```

### Phase 3: Mobile Build & Rollout
1. Build the updated mobile APK using EAS:
   ```bash
   cd apps/mobile
   eas build --profile preview --platform android
   ```
2. Distribute the generated APK link to the test cohort.
3. Once all testers have installed the new APK build, go back to Vercel and switch:
   ```ini
   REQUIRE_OTP_TOKEN="true"
   ```
4. Redeploy Vercel. Public registration is now 100% hardened and cryptographically bound to SMS OTP verification.

---

## 5. Summary of Key Files

| Domain | File Path | Major Changes |
|:---|:---|:---|
| **PIN Security** | [apps/backend/lib/pin.ts](file:///d:/OmniFi/apps/backend/lib/pin.ts) | scrypt hashing, constant-time verification, legacy migration helper. |
| **PIN Endpoint** | [apps/backend/app/api/auth/pin/verify/route.ts](file:///d:/OmniFi/apps/backend/app/api/auth/pin/verify/route.ts) | Server-side PIN verification with 15-minute brute-force lockout. |
| **Registration** | [apps/backend/app/api/register/route.ts](file:///d:/OmniFi/apps/backend/app/api/register/route.ts) | Forced `USER` role, phone duplicate check, verification token enforcement. |
| **SMS Delivery** | [apps/backend/lib/sms.ts](file:///d:/OmniFi/apps/backend/lib/sms.ts) | Unified gateway sender, intelligent retry classes, fallback device support. |
| **SMS Queue** | [apps/backend/lib/sms-queue.ts](file:///d:/OmniFi/apps/backend/lib/sms-queue.ts) | QStash asynchronous message producer with rate throttling. |
| **SMS Dispatch**| [apps/backend/app/api/sms/dispatch/route.ts](file:///d:/OmniFi/apps/backend/app/api/sms/dispatch/route.ts) | QStash webhook worker delivering throttled settlement receipts. |
| **Rate Limiter** | [apps/backend/lib/rate-limit.ts](file:///d:/OmniFi/apps/backend/lib/rate-limit.ts) | Redis rate limiting with first-hop client IP extraction. |
| **Mobile Client**| [apps/mobile/src/services/api/client.ts](file:///d:/OmniFi/apps/mobile/src/services/api/client.ts) | Centralized fetch wrapper with timeouts, retries, and silent SEP-10 reauth. |
| **Boundary** | [apps/mobile/src/components/ErrorBoundary.tsx](file:///d:/OmniFi/apps/mobile/src/components/ErrorBoundary.tsx) | React error boundary protecting app from unhandled crashes. |
| **Redirection** | [apps/mobile/src/components/ui/ConnectionWatcher.tsx](file:///d:/OmniFi/apps/mobile/src/components/ui/ConnectionWatcher.tsx) | Fixed dependency loop on connection drop redirect timer. |
| **Relayer Mutex** | [apps/backend/lib/redis-lock.ts](file:///d:/OmniFi/apps/backend/lib/redis-lock.ts) | Upstash Redis mutex lock (`acquireRelayerLock`, `releaseRelayerLock`) with 5s TTL. |
| **Relayer Submit**| [apps/backend/lib/stellar-transaction-manager.ts](file:///d:/OmniFi/apps/backend/lib/stellar-transaction-manager.ts) | Wrapped two-phase settlement in relayer lock wait loop to eliminate `tx_bad_seq`. |
| **Friendbot** | [apps/backend/app/api/friendbot/route.ts](file:///d:/OmniFi/apps/backend/app/api/friendbot/route.ts) | Custom distributor 5 XLM funding route with 10-attempt jittered retry loop. |
| **Concurrency Tests**| [apps/backend/lib/concurrency-hardening.test.ts](file:///d:/OmniFi/apps/backend/lib/concurrency-hardening.test.ts) | Unit tests for Redis lock mutex exclusivity, `isTxBadSeq`, and secret key redaction. |
| **Ramp Controls** | [apps/backend/lib/ramp-config.ts](file:///d:/OmniFi/apps/backend/lib/ramp-config.ts) | Central kill switches, limits, single-use token claiming, and structured audit logs. |
| **Ramp Security Tests** | [apps/backend/lib/ramp-security.test.ts](file:///d:/OmniFi/apps/backend/lib/ramp-security.test.ts) | Unit tests for Ramp kill switches, interactive JWT auth, and per-tx caps. |
| **DB Indexes** | [apps/backend/prisma/schema.prisma](file:///d:/OmniFi/apps/backend/prisma/schema.prisma) | Added indexes on `Account.phoneNumber`, `Settlement`, and `AnchorTransaction`. |
| **Health Probe** | [apps/backend/app/api/health/route.ts](file:///d:/OmniFi/apps/backend/app/api/health/route.ts) | Live DB, Redis, and Soroban RPC health checks with dynamic feature flags. |
| **Balance Caching** | [apps/backend/app/api/vault-balance/route.ts](file:///d:/OmniFi/apps/backend/app/api/vault-balance/route.ts) · [wallet/balance](file:///d:/OmniFi/apps/backend/app/api/wallet/balance/route.ts) | 5-second Redis caching and HTTP cache headers for high-frequency balance queries. |
