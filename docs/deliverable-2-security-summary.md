# Deliverable 2: Security Hardening & Webhook/QStash Pipeline Summary

**Project:** OmniFi / Pijin Relayer  
**Component:** Vercel Coordinator Backend — Phase 1 (Deliverable 2)  
**Assigned Engineers:** JANRELLLL, MARKKKKK  
**Status:** Completed & Verified (55/55 Tests Passing)  

---

## 1. Executive Summary & Goal Mapping

The primary objective of **Deliverable 2** was to secure the ingestion and settlement pipeline connecting telecom SMS gateways (Textbee), serverless orchestration (Upstash QStash), and the Stellar Soroban smart contract ecosystem.

Prior to this hardening phase, the webhook and relayer workers were vulnerable to payload spoofing, denial-of-service via unbounded streaming, replay attacks, duplicate customer alerts, and silent failures when unmapped accounts or contract errors occurred.

### Goal & Deliverables Matrix

| Deliverable 2 Requirement | Architectural Solution | Implementation | Verification Status |
| :--- | :--- | :--- | :--- |
| **HMAC Authentication** | Constant-time cryptographic verification of inbound SMS payloads | `verifyTextbeeHmac` in `sms-security.ts` | Passed (`sms-security.test.ts`) |
| **Payload Limits & DoS Guards** | Single-stream bounded reader (2 KB webhook, 64 KB settle) + 300-char SMS limit | `readBoundedRequestBody` in `sms-security.ts` | Passed (`sms-security.test.ts`) |
| **Queue Authentication** | Cryptographic verification of QStash signatures before execution | `verifyQStashSignature` in `qstash-security.ts` | Passed (E2E / Security suite) |
| **Safe Voucher Parsing** | Strict 6-part Base62/Base64 unpacking with `i128::MAX` bounds protection | `parseOfflineVoucher` in `offline-voucher.ts` | Passed (`offline-voucher-security.test.ts`) |
| **Retry Classification** | Discerning transient infrastructure faults from permanent contract failures | `isRetryableSettlementError` in `qstash-security.ts` | Passed (`engine-retry-classifier.test.ts`) |
| **Outbound SMS Alerts** | Failure notifications to sender on unregistered accounts, bad vouchers, or contract rejections | `sendSms` in `route.ts` & `sms.ts` | Verified (Engine & Classifier tests) |
| **Deployment & Host Routing** | Dynamic host header resolution for Vercel Preview deployments | `POST` handler in `/api/sms/webhook` | Verified |

---

## 2. Architectural Breakdown of Security Modules

### 2.1 `apps/backend/lib/sms-security.ts` — Ingress Security Layer

This module provides defence-in-depth utilities for inbound HTTP payloads from external telecom webhooks:

1. **Bounded Stream Reader (`readBoundedRequestBody`):**
   - Reads request streams chunk-by-chunk with a strict byte limit (2048 bytes for webhooks, 65536 bytes for settlement).
   - Rejects oversized requests early via `Content-Length` headers if present, and immediately aborts stream iteration if read bytes exceed the ceiling.
   - Prevents memory exhaustion attacks and ensures raw body bytes are cached for downstream HMAC validation without re-reading `req.body`.

2. **Constant-Time HMAC-SHA256 Verification (`verifyTextbeeHmac`):**
   - Validates incoming webhook signatures using `crypto.timingSafeEqual` to neutralize timing side-channel attacks.
   - Tolerates common gateway header variations (`sha256=` prefix, raw hexadecimal, and Base64-encoded digests).
   - Fails closed in production if `TEXTBEE_WEBHOOK_SECRET` is unset.

3. **Conditional Timestamp Drift Validation (`verifyTimestampDrift`):**
   - Validates `x-timestamp` or `x-textbee-timestamp` against server time within a `±300` second window.
   - Handles both 10-digit second and 13-digit millisecond Unix timestamps.
   - Operates conditionally (passes gracefully when headers are absent to support simpler gateways, but strictly enforces drift boundaries when provided).

4. **PII and Secret Sanitization (`maskPhoneNumber`, `sanitizeLogData`):**
   - Masks phone numbers in all log outputs (`+639171234567` → `+639****4567`).
   - Recursively redacts Stellar secret seeds (`S...`), QStash signing keys (`sig_...`), and Bearer tokens from structured error logs.

---

### 2.2 `apps/backend/lib/qstash-security.ts` — Queue & Fault Isolation Layer

This module bridges Upstash QStash delivery guarantees with Soroban smart contract error boundaries:

1. **QStash Signature Verification (`verifyQStashSignature`):**
   - Wraps `@upstash/qstash` `Receiver` using pre-read raw body strings.
   - Never throws HTTP 500 on missing or invalid signatures; returns clean `{ valid: false, error }` results to return HTTP 401/403 responses.

2. **Settlement Error Classifier (`isRetryableSettlementError`):**
   - **Retryable Errors (Returns `true` → HTTP 500):** Transient HTTP statuses (`429 Too Many Requests`, `502 Bad Gateway`, `503 Service Unavailable`, `504 Gateway Timeout`), network dropouts (`ECONNREFUSED`, `ETIMEDOUT`, `fetch failed`), and Stellar sequence collisions (`tx_bad_seq`, `tx_insufficient_fee`). QStash will automatically retry.
   - **Permanent Errors (Returns `false` → HTTP 200 `{ status: 'FAILED' }`):** Soroban smart contract exceptions (`Error(Contract, N)`), invalid Ed25519 signatures, account/token hydration misses, and corrupted voucher encoding. Stops QStash retry loops.

3. **Dual Failure Normalizers (`normalizeSettlementFailure` vs `normalizeSettlementUserFailure`):**
   - `normalizeSettlementFailure`: Provides detailed, sanitized root causes for database tracking (`Settlement.failReason`) and operator monitoring.
   - `normalizeSettlementUserFailure`: Produces human-friendly, concise failure copy for SMS notifications (e.g. `"Insufficient balance."`, `"Voucher has already been used."`, `"Sender account aB3x9Q is not registered."`), stripping out raw contract codes and stack traces.

---

### 2.3 `apps/backend/lib/offline-voucher.ts` — Cryptographic Voucher Validation

Provides zero-trust parsing of offline compressed payment strings (`tokenId:senderShortId:receiverShortId:amountBase62:nonce:signature`):

1. **Structural & Encoding Checks:**
   - Enforces exact 6-part colon-delimited structure.
   - Validates that short IDs adhere strictly to 6-character Base62 alphanumeric strings (`^[0-9A-Za-z]{6}$`).
   - Normalizes and validates Base64 payloads (supports standard, URL-safe, and unpadded Base64).

2. **Cryptographic Byte Length Guarantees:**
   - Validates that decoded nonces are exactly 32 bytes (`BytesN<32>`).
   - Validates that decoded Ed25519 signatures are exactly 64 bytes (`BytesN<64>`).

3. **Integer Overflow & Bounds Protection:**
   - Ensures decoded transfer amounts are strictly greater than zero.
   - Rejects amounts exceeding Soroban signed 128-bit integer ceiling (`i128::MAX` = $2^{127} - 1$).

---

## 3. Route Hardening Implementations

### 3.1 `/api/sms/webhook/route.ts` (Ingress Gateway)

- **DoS Body Ceiling:** Enforces 2 KB max streaming limit via `readBoundedRequestBody`.
- **HMAC & Drift Verification:** Authenticates incoming Textbee webhooks before running any logic.
- **Outbound Delivery Receipt Filtering:** Quietly drops Textbee delivery receipt callbacks (`webhookEvent: 'MESSAGE_SENT'` or `status: 'sent'`) immediately after JSON parsing, eliminating warning log noise.
- **SMS Body Character Limit:** Restricts incoming SMS bodies to a maximum of 300 characters (`MAX_SMS_BODY_CHARS`).
- **Sliding-Window Rate Limiting:** Limits ingress to 3 requests per 60 seconds per sender phone number using `@upstash/ratelimit`.
- **Early Nonce Deduplication:** Implements fail-open Redis nonce checks (`checkAndSetNonceReplay` with 24-hour TTL) to drop rapid replays before QStash scheduling.
- **Eliminated Eager Acknowledgment:** Removed the eager "Processing transaction..." SMS dispatch to prevent double-texting users when QStash processes in sub-second intervals.
- **Dynamic Vercel Host Resolution:** Resolves target settlement endpoint using `req.headers.get('host')` with fallback to `process.env.NEXT_PUBLIC_APP_URL`, ensuring Vercel Preview deployments route settlement jobs to themselves.

### 3.2 `/api/engine/settle/route.ts` (QStash Settlement Worker)

- **64 KB Body Ceiling:** Prevents oversized settlement payload injections.
- **Queue HMAC Verification:** Enforces valid `upstash-signature` headers.
- **Flexible Phone Extraction:** Reliably extracts sender phone numbers from `senderPhone`, `sender`, `phone`, `from`, or `phoneNumber` across root and nested `data` payloads.
- **Idempotency & Duplicate Guards:** Prisma unique constraint on `nonce` gracefully handles duplicate deliveries; completed settlements return `DUPLICATE_SKIPPED`.
- **Pre-flight Local Firewall:** Reconstructs the canonical XDR tuple and validates the Ed25519 voucher signature against the registered `offlineDeviceKey` locally, aborting unauthenticated vouchers to protect relayer gas.
- **Failure SMS Notifications:** Automatically alerts the sender via Textbee SMS upon non-retryable failures:
  - Recipient not found: `"Pijin: Transaction failed. Recipient ID <ID> was not found."`
  - Unregistered sender: `"Pijin: Transaction failed. Sender account <ID> is not registered."`
  - Token inactive or unsupported: `"Pijin: Transaction failed. Unsupported token."`
  - Invalid signature: `"Pijin: Transaction failed. Invalid voucher signature."`
  - Smart contract rejection: `"Pijin: Transaction failed. <Reason>"`
- **Traceability:** Logs `[Settle] Attempting to send unregistered sender SMS to: <maskedPhone>` for real-time observability.
- **Non-Fatal SMS Guards:** All `sendSms` invocations are wrapped with `.catch()` to prevent telecom failures from disrupting QStash status codes.

---

## 4. Testing & Verification

The suite was executed using Node.js's native test runner (`tsx --test`). All **55/55** tests across the backend test suite passed without regression.

```
✔ tests 55
✔ suites 0
✔ pass 55
✔ fail 0
✔ cancelled 0
✔ skipped 0
✔ todo 0
✔ duration_ms: ~1500ms
```

### Test Suite Summary

#### 1. `apps/backend/lib/sms-security.test.ts` (11 Tests)
- `verifyTextbeeHmac`: Verifies valid HMAC-SHA256 signatures.
- `verifyTextbeeHmac`: Rejects tampered payloads and invalid shared secrets.
- `verifyTextbeeHmac`: Handles malformed signature strings without throwing uncaught exceptions.
- `verifyTimestampDrift`: Passes when timestamp header is omitted (permissive mode).
- `verifyTimestampDrift`: Validates timestamps in both seconds and milliseconds.
- `verifyTimestampDrift`: Rejects stale timestamps exceeding ±300s.
- `readBoundedRequestBody`: Correctly reads payloads under the byte limit.
- `readBoundedRequestBody`: Rejects payloads exceeding limit via early `Content-Length` header (HTTP 413).
- `readBoundedRequestBody`: Aborts stream reading when byte stream exceeds ceiling.
- `maskPhoneNumber`: Correctly masks middle digits for international and local numbers.
- `sanitizeLogData`: Recursively redacts Stellar secret keys, QStash tokens, and Bearer tokens.

#### 2. `apps/backend/lib/offline-voucher-security.test.ts` (10 Tests)
- `parseOfflineVoucher`: Successfully parses valid 6-part vouchers.
- `parseOfflineVoucher`: Parses standard, unpadded, and URL-safe Base64 strings.
- `parseOfflineVoucher`: Rejects payloads with part counts $\ne 6$.
- `parseOfflineVoucher`: Rejects invalid token identifiers.
- `parseOfflineVoucher`: Rejects non-Base62 or incorrect-length short IDs.
- `parseOfflineVoucher`: Rejects zero and negative transfer amounts.
- `parseOfflineVoucher`: Rejects amounts exceeding Soroban signed 128-bit maximum (`i128::MAX`).
- `parseOfflineVoucher`: Rejects corrupted Base64 in nonces and signatures.
- `parseOfflineVoucher`: Rejects nonces whose byte count $\ne 32$ bytes.
- `parseOfflineVoucher`: Rejects signatures whose byte count $\ne 64$ bytes.

#### 3. `apps/backend/lib/engine-retry-classifier.test.ts` (16 Tests)
- `isRetryableSettlementError`: Classifies HTTP 429 (rate limits) as retryable (`true`).
- `isRetryableSettlementError`: Classifies HTTP 502, 503, 504 server errors as retryable (`true`).
- `isRetryableSettlementError`: Classifies connection drops (`ECONNREFUSED`, `ETIMEDOUT`, socket drops) as retryable (`true`).
- `isRetryableSettlementError`: Classifies Stellar sequence collision (`tx_bad_seq`) as retryable (`true`).
- `isRetryableSettlementError`: Classifies Soroban `ContractError` (1–12) as non-retryable (`false`).
- `isRetryableSettlementError`: Classifies cryptographic signature rejections as non-retryable (`false`).
- `isRetryableSettlementError`: Classifies account and token lookup failures as non-retryable (`false`).
- `isRetryableSettlementError`: Safely handles non-`Error` objects without crashing.
- `normalizeSettlementFailure`: Formats offline device key mismatches clearly for operator logs.
- `normalizeSettlementFailure`: Formats missing trustlines with exact account addresses.
- `normalizeSettlementFailure`: Formats smart contract error codes without leaking secrets.
- `normalizeSettlementUserFailure`: Produces clean user SMS copy for contract errors (e.g. `"Insufficient balance."`).
- `normalizeSettlementUserFailure`: Produces clean user SMS copy for key and signature rejections.
- `normalizeSettlementUserFailure`: Produces clean user SMS copy for missing trustlines.
- `normalizeSettlementUserFailure`: Produces clean user SMS copy for missing sender and recipient accounts.
- `normalizeSettlementUserFailure`: Returns empty string for raw internal stack traces to trigger safe fallback copy.

---

## 5. Conclusion & Operational Impact

The Deliverable 2 security enhancements ensure that:
1. Malicious or malformed inputs are rejected at the edge before incurring Soroban RPC execution or transaction fee costs.
2. Transient infrastructure blips are retried automatically without operator intervention.
3. End users receive clear, immediate feedback via SMS when an offline transaction fails.
4. Preview deployments on Vercel seamlessly self-route webhook settlement jobs without cross-contaminating production queues.
