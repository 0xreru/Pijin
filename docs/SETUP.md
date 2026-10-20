# Pijin — Setup & Integration Guide

> The same guide, formatted for the web, is at **[pijin.live/docs](https://pijin.live/docs)**. The interactive API reference is at **[pijin.live/api-docs](https://pijin.live/api-docs)**.

This guide covers running the whole Pijin stack yourself: the Next.js API and SEP anchor, the Soroban vault contract, the Expo Android app, and the SMS → QStash → Soroban settlement pipeline. It also covers integrating with that stack from your own wallet or service.

## Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Prerequisites](#3-prerequisites)
4. [Quick start](#4-quick-start)
5. [Environment variables](#5-environment-variables)
6. [Smart contract](#6-smart-contract)
7. [Assets & database seed](#7-assets--database-seed)
8. [SMS gateway & queues](#8-sms-gateway--queues)
9. [Mobile app](#9-mobile-app)
10. [Deployment](#10-deployment)
11. [Integration guide](#11-integration-guide)
12. [Security model](#12-security-model)
13. [Testing](#13-testing)
14. [Troubleshooting](#14-troubleshooting)
15. [Contributing & license](#15-contributing--license)

---

## 1. Overview

| Path | What it is |
|---|---|
| `apps/backend` | Next.js 16 app: REST API, SEP-1/10/24 anchor, SMS webhook and QStash workers, landing page, browser simulator, docs. |
| `apps/mobile` | Expo 52 / React Native 0.76 Android app with a local SQLite (Drizzle) store and offline Ed25519 signing. |
| `contracts` | The Pijin Soroban contract (Rust, soroban-sdk 22): vaults, offline spend, ShortID registry, gateway whitelist. |
| `packages/pijin_core` | Generated TypeScript bindings for the contract, consumed by the backend. |
| `asset-mint.js` | Testnet helper that mints the PHPC asset. |
| `.github/workflows` | CI for the backend, contracts and mobile app. |

## 2. Architecture

```
Phone (sign voucher) ─▶ SMS / Payload QR ─▶ Textbee ─▶ POST /api/sms/webhook
      ─▶ Upstash QStash ─▶ POST /api/engine/settle ─▶ Soroban spend_offline
```

- **Online wallet**: a normal Stellar account holding PHPC/USDC, funded through SEP-24 (GCash).
- **Offline vault**: a per-user, per-token balance inside the contract. Only this balance can be spent with offline vouchers.
- **Two keys per user**: the *wallet key* controls the Stellar account. The *device key* is registered on-chain and signs only offline vouchers.
- **Backend as a dumb pipe**: the relayer pays gas and submits, but cannot forge, alter or replay a voucher. For vault and transfer operations the backend only *assembles* transactions. The phone signs and submits them.

## 3. Prerequisites

| Tool / service | Needed for | Notes |
|---|---|---|
| Node.js 20+ and npm 10+ | Everything | CI runs Node 20. |
| Rust (stable) + `wasm32v1-none` | Contract | `rustup target add wasm32v1-none` |
| [Stellar CLI](https://developers.stellar.org/docs/tools/cli) | Contract | Build, deploy, invoke, generate bindings. |
| PostgreSQL 14+ | Backend | Neon serverless works out of the box. |
| Upstash QStash + Redis | Backend | Queues, rate limits, OTP and replay caches. |
| Textbee + an Android phone with a SIM | SMS | Inbound/outbound SMS gateway. |
| Android Studio, JDK 17, device or emulator | Mobile | Local dev builds. |
| Expo account + EAS CLI | Mobile | Cloud builds only. |

You can run and test the backend and contract without SMS. Use the direct settlement path ([§11](#submit-vouchers)) and the browser simulator at `/demo-split`.

## 4. Quick start

```bash
git clone https://github.com/0xreru/Pijin.git
cd Pijin

# Install every workspace and build the contract bindings
npm install
npm run build:sdk

# Create local env files, then fill them in (§5)
cp apps/backend/.env.example apps/backend/.env
cp apps/mobile/.env.example apps/mobile/.env

# Database schema
cd apps/backend
npx prisma generate
npx prisma migrate deploy

# API, landing page, simulator and docs on http://localhost:3000
npm run dev
```

Check `http://localhost:3000/api/health`. Add `?deep=1` to include Textbee device status.

## 5. Environment variables

All variables, with placeholders, are in [`apps/backend/.env.example`](../apps/backend/.env.example) and [`apps/mobile/.env.example`](../apps/mobile/.env.example). Never commit real secrets. `EXPO_PUBLIC_*` values are compiled into the APK and are public.

### Backend

| Group | Variables | Purpose |
|---|---|---|
| Core | `DATABASE_URL`, `NEXT_PUBLIC_APP_URL`, `CORS_ORIGIN` | Postgres and the public base URL (SEP-24 links, QStash callbacks). |
| Stellar | `SOROBAN_RPC_URL`, `STELLAR_NETWORK_PASSPHRASE`, `STELLAR_HORIZON_URL` | Network endpoints. |
| Contract | `CONTRACT_ID`, `TOKEN_ID`, `OFFLINE_TOKEN_SYMBOL` | Deployed contract, PHPC SAC, offline token (default PHPC). |
| Keys | `RELAYER_*`, `REGISTRAR_*`, `TREASURY_PUBLIC_KEY` | Gateway, ShortID registrar, toll/withdrawal recipient. |
| Assets | `PHPC_ISSUER_PUBKEY`, `PHPC_DISTRIBUTOR_SECRET`, `USDC_*` | Anchor issuer/distributor. |
| SEP-10 | `SECRET_SEP10_SIGNING_SEED`, `SECRET_SEP10_JWT_SECRET`, `SEP10_HOME_DOMAINS`, timeouts | Web authentication. |
| SEP-24 | `SECRET_SEP24_INTERACTIVE_URL_JWT_SECRET` | Separate secret for 15-minute webview tokens. |
| Textbee | `TEXTBEE_GATEWAY_URL`, `TEXTBEE_API_KEY`, `TEXTBEE_DEVICE_ID`, `TEXTBEE_WEBHOOK_SECRET`, optional `TEXTBEE_FALLBACK_*` | SMS in/out. |
| Upstash | `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY`, `UPSTASH_REDIS_REST_*` | Queues and rate limits. |
| OTP | `OTP_VERIFICATION_JWT_SECRET`, `REQUIRE_OTP_TOKEN`, `OTP_GLOBAL_LIMIT_PER_HOUR`, `OTP_TEST_*` | Phone verification (keep test mode off). |
| Ramps | `RAMP_ENABLED`, `DEPOSIT_ENABLED`, `WITHDRAW_ENABLED`, `RAMP_MAX_*` | Kill switches and limits (optional). |
| Demo | `DEMO_ENABLED`, `DEMO_ACCESS_CODE`, `DEMO_POOL_*` | Browser simulator (Testnet only). |

### Mobile

| Variable | Purpose |
|---|---|
| `EXPO_PUBLIC_API_BASE_URL` | Backend base URL. |
| `EXPO_PUBLIC_ANCHOR_DOMAIN` | Host serving `/.well-known/stellar.toml`. |
| `EXPO_PUBLIC_CONTRACT_ID`, `EXPO_PUBLIC_TOKEN_ID` | Must match the backend. |
| `EXPO_PUBLIC_TOKEN_DB_ID` | Numeric `Token.id` (first voucher field). |
| `EXPO_PUBLIC_GATEWAY_PUBLIC_KEY` | Relayer address bound into voucher signatures. |
| `EXPO_PUBLIC_SMS_GATEWAY_NUMBER` | Phone number of the Textbee SIM. |
| `EXPO_PUBLIC_PHPC_ISSUER_PUBKEY`, `EXPO_PUBLIC_USDC_ISSUER_PUBKEY` | Trustline issuers. |
| `EXPO_PUBLIC_SOROBAN_RPC_URL`, `EXPO_PUBLIC_HORIZON_URL`, `EXPO_PUBLIC_STELLAR_NETWORK_PASSPHRASE` | Network endpoints. |

> [!WARNING]
> The contract ID, gateway key and token contract are all inside every voucher signature. If the phone and backend disagree on any of them, every offline payment fails verification.

## 6. Smart contract

### Build and test

```bash
cd contracts
rustup target add wasm32v1-none
make test    # cargo test
make build   # → target/wasm32v1-none/release/pijin_contract.wasm
```

### Identities

You need four accounts: **admin** (upgrades, gateway and registrar control), **treasury** (tolls and withdrawals), **relayer** (submits `spend_offline`) and **registrar** (maps ShortIDs).

```bash
stellar keys generate admin     --network testnet --fund
stellar keys generate treasury  --network testnet --fund
stellar keys generate relayer   --network testnet --fund
stellar keys generate registrar --network testnet --fund
stellar keys address relayer    # G… public key
stellar keys secret  relayer    # S… secret (older CLIs: stellar keys show)
```

### Deploy and initialise

```bash
stellar contract deploy \
  --wasm target/wasm32v1-none/release/pijin_contract.wasm \
  --source admin --network testnet \
  -- \
  --admin    $(stellar keys address admin) \
  --treasury $(stellar keys address treasury)

CONTRACT_ID=C...

stellar contract invoke --id $CONTRACT_ID --source admin --network testnet -- \
  set_registrar --admin $(stellar keys address admin) --registrar $(stellar keys address registrar)

stellar contract invoke --id $CONTRACT_ID --source admin --network testnet -- \
  register_gateway --admin $(stellar keys address admin) --gateway $(stellar keys address relayer)
```

### Regenerate bindings

```bash
stellar contract bindings typescript --network testnet --contract-id $CONTRACT_ID \
  --output-dir packages/pijin_core --overwrite
# keep the package name "pijin_core", then:
npm run build:sdk
```

`packages/pijin_core/dist` is committed. Commit the rebuilt output.

### Upgrade in place

```bash
stellar contract upload --wasm target/wasm32v1-none/release/pijin_contract.wasm --source admin --network testnet
stellar contract invoke --id $CONTRACT_ID --source admin --network testnet -- upgrade --new_wasm_hash <WASM_HASH>
```

Error codes: `1` AlreadyInitialized, `2` Unauthorized, `3` InvalidAmount, `4` ExpiredVoucher, `5` NonceReplayed, `6` InsufficientBalance, `7` RecipientNotFound, `8` MathOverflow, `9` NotWhitelistedGateway, `10` ShortIdAlreadyRegistered, `11` RegistrarNotConfigured, `12` InvalidShortId.

## 7. Assets & database seed

```bash
# Repository root: new issuer + distributor, trustline, mint 1,000,000,000 PHPC
node asset-mint.js

# Stellar Asset Contract for the classic asset → TOKEN_ID
stellar contract asset deploy --asset PHPC:<PHPC_ISSUER_PUBKEY> --source admin --network testnet
```

> [!WARNING]
> The contract transfers the protocol toll to the treasury, and withdrawals pay the treasury directly. Add PHPC (and USDC) **trustlines to the treasury account**.

Seed the token row that offline vouchers reference:

```sql
INSERT INTO token (symbol, contract_id, decimals, is_active, updated_at)
VALUES ('PHPC', '<TOKEN_ID>', 7, true, now());
-- the generated id (normally 1) is EXPO_PUBLIC_TOKEN_DB_ID
```

## 8. SMS gateway & queues

1. Install the **Textbee** Android app on a phone with an active SIM and link it. Set `TEXTBEE_DEVICE_ID`, `TEXTBEE_API_KEY` and `TEXTBEE_GATEWAY_URL`.
2. Register a `MESSAGE_RECEIVED` webhook to `https://<host>/api/sms/webhook` with the same secret as `TEXTBEE_WEBHOOK_SECRET`. `GET /api/sms/webhook` reports which settings are configured.
3. Create an Upstash **QStash** project and a **Redis** database, and copy their credentials.
4. QStash calls `NEXT_PUBLIC_APP_URL/api/engine/settle`, so that URL must be public. Locally, use a tunnel:

```bash
npx ngrok http 3000
# NEXT_PUBLIC_APP_URL="https://<your-tunnel>.ngrok-free.app"
```

Set the app's `EXPO_PUBLIC_SMS_GATEWAY_NUMBER` to the gateway SIM. Outbound receipts go through `/api/sms/dispatch`, which QStash throttles to 10 per minute.

## 9. Mobile app

```bash
cd apps/mobile
# EXPO_PUBLIC_API_BASE_URL="http://<LAN-IP>:3000" (or your tunnel / Vercel URL)
npm run android        # build + install the dev client
npm run android:usb    # USB device via adb reverse
npm start              # Metro only
```

The app runs as a development build (`expo-dev-client`), not in Expo Go. EAS profiles (`apps/mobile/eas.json`): `development` (dev client), `preview` (installable APK), `production`.

```bash
npm install -g eas-cli
cd apps/mobile && eas login
eas build --platform android --profile preview
```

## 10. Deployment

**Backend on Vercel**

| Setting | Value |
|---|---|
| Framework | Next.js |
| Root directory | `apps/backend` |
| Build command | `npx prisma generate && next build` |
| Node.js | 20.x |

Then:

1. Add every backend variable to the project.
2. Run `npx prisma migrate deploy` against the production database.
3. Set `NEXT_PUBLIC_APP_URL` and `SEP10_HOME_DOMAINS` to the deployed domain, and check `/.well-known/stellar.toml`.
4. Point the Textbee webhook at the production host.

**Checklist**: contract deployed, registrar set, relayer whitelisted · SAC deployed, treasury trustlines, `token` row seeded · backend and app agree on contract ID, token ID, token DB id and gateway key · `/api/health?deep=1` healthy · an end-to-end voucher settles.

## 11. Integration guide

Full schemas: **[/api-docs](https://pijin.live/api-docs)**.

### Authenticate (SEP-10)

```ts
import { Keypair, TransactionBuilder } from '@stellar/stellar-sdk';

const API = 'https://pijin.live';
const wallet = Keypair.fromSecret(process.env.WALLET_SECRET!);

const challenge = await fetch(`${API}/api/auth?account=${wallet.publicKey()}`).then((r) => r.json());
const tx = TransactionBuilder.fromXDR(challenge.transaction, challenge.network_passphrase);
tx.sign(wallet);

const { token } = await fetch(`${API}/api/auth`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ transaction: tx.toXDR() }),
}).then((r) => r.json());
```

### Onboard a user

```
POST /api/otp/send                  { phoneNumber }
POST /api/otp/verify                { phoneNumber, code }       → verificationToken
POST /api/friendbot                 { publicKey }               → 50 XLM (Testnet)
     (app adds PHPC / USDC trustlines)
POST /api/register                  { stellarPublicKey, phoneNumber, pin, offlineDeviceKey, verificationToken, … }
GET  /api/auth → POST /api/auth     SEP-10 JWT
POST /api/engine/recipient-registry (JWT)                       → offlineConfig
POST /api/engine/offline-key        (JWT) { offlineDeviceKey }  → synced | rotation_required
```

### Move funds into the offline vault

`/api/engine/deposit`, `/withdraw` and `/transfer` authenticate with `Authorization: Bearer <base64 Ed25519 signature>`, made with the wallet key over a canonical message:

| Endpoint | Signed message |
|---|---|
| `POST /api/engine/deposit` | `deposit:<senderPublicKey>:<amountStroops>` |
| `POST /api/engine/withdraw` | `withdraw:<senderPublicKey>:<amountStroops>` |
| `POST /api/engine/transfer` | `transfer:v2:online:<tokenAddress>:<sender>:<recipient>:<amountStroops>` |

```ts
const amountStroops = '500000000'; // 50 PHPC
const signature = wallet.sign(Buffer.from(`deposit:${wallet.publicKey()}:${amountStroops}`)).toString('base64');

const { xdr } = await fetch(`${API}/api/engine/deposit`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signature}` },
  body: JSON.stringify({
    senderPublicKey: wallet.publicKey(),
    tokenAddress: TOKEN_ID,
    offlineDevicePubkeyHex: device.rawPublicKey().toString('hex'),
    amountStroops,
  }),
}).then((r) => r.json());

const tx = TransactionBuilder.fromXDR(xdr, NETWORK_PASSPHRASE);
tx.sign(wallet);
await new rpc.Server(RPC_URL).sendTransaction(tx);
```

After an online transfer, post its hash to `/api/wallet/transfers/confirm` so it appears in history.

### Build an offline voucher

```
<tokenDbId>:<senderShortId>:<receiverShortId>:<amountBase62>:<nonce>:<signature>
```

| Field | Encoding |
|---|---|
| tokenDbId | Decimal `Token.id` (`offlineConfig.tokenDbId`) |
| sender/receiverShortId | 6 case-sensitive Base62 characters |
| amountBase62 | Amount in stroops, Base62 (`0-9A-Za-z`) |
| nonce | 32 random bytes, Base64 without padding |
| signature | 64-byte Ed25519 signature by the device key, Base64 without padding |

The device key signs the XDR of the `ScVec` `(amount: i128, protocol_toll: i128, nonce: Bytes32, receiver_short_id: Bytes6, gateway: Address, token: Address, contract: Address)`. The protocol toll is 0.5 PHPC (`5000000` stroops). The sender's vault must cover amount + toll.

```ts
const message = xdr.ScVal.scvVec([
  nativeToScVal(amountStroops, { type: 'i128' }),
  nativeToScVal(5_000_000n, { type: 'i128' }),
  xdr.ScVal.scvBytes(Buffer.from(nonce)),
  xdr.ScVal.scvBytes(Buffer.from(receiverShortId, 'ascii')),
  Address.fromString(cfg.gatewayPublicKey).toScVal(),
  Address.fromString(cfg.tokenContractId).toScVal(),
  Address.fromString(cfg.contractId).toScVal(),
]).toXDR();
const signature = device.sign(message);
```

### Submit vouchers

- **SMS** (production): text the voucher to the gateway number. The webhook verifies and enqueues it, and QStash deduplicates on `<senderShortId>_<nonce>`.
- **Payload QR**: anyone can scan it and send the SMS, but cannot change it.
- **Direct HTTP** for clients back online:

```bash
curl -X POST https://pijin.live/api/settlements \
  -H 'Content-Type: application/json' \
  -d '{"smsBody":"1:aB3x9Q:Zx7mNk:1Ly8Hk:<nonce>:<signature>"}'
```

`/api/engine/settle` accepts only QStash-signed requests in production.

### Fiat ramps (SEP-24)

```
Deposit:     POST /api/sep24/transactions/deposit/interactive (JWT) → webview
             → POST /api/anchor/simulate-payment (interactive token) → poll GET /api/sep24/transaction
Withdrawal:  POST /api/sep24/transactions/withdraw/interactive (JWT) → webview
             → POST /api/anchor/submit-withdraw (memo) → wallet pays treasury
             → POST /api/anchor/confirm-withdraw (JWT) → poll → pending_external
```

### Reads

| Endpoint | Returns |
|---|---|
| `GET /api/wallet/balance?publicKey&assetCode` | Online (Horizon) balance |
| `GET /api/vault-balance?shortId` | Offline vault balance |
| `GET /api/wallet/history?shortId&publicKey` | Merged history (latest 50) |
| `GET /api/users/lookup?shortId` | Recipient confirmation |

## 12. Security model

- Wallet and device keys never leave the phone. The backend only assembles unsigned transactions.
- Vouchers bind amount, toll, nonce, receiver, gateway, token and contract.
- Replay protection in four layers: Redis nonce cache, QStash deduplication, a unique DB nonce, and on-chain nonce storage.
- The webhook checks a constant-time HMAC-SHA256, an optional ±300 s timestamp, a 2 KB body cap and per-phone rate limits.
- Infrastructure failures return 500, so QStash retries. Contract rejections return 200, so they are not retried.
- On-chain roles are separate (admin, registrar, gateway). Only whitelisted gateways can call `spend_offline`.

> [!CAUTION]
> **Before mainnet:** remove or gate the `mock-` simulator path in `/api/anchor/simulate-payment`, keep `DEMO_ENABLED` and `OTP_TEST_MODE` off, set `REQUIRE_OTP_TOKEN=true`, and connect a real fiat anchor in place of the simulated GCash flow.

Report vulnerabilities privately to **support.pijin@gmail.com**.

## 13. Testing

```bash
cd apps/backend && npm test            # security, settlement, demo suites
cd contracts && cargo test             # contract unit tests
npm run typecheck                      # backend + pijin_core (root)
cd apps/backend && npx tsx scripts/e2e-live-test.ts   # live Testnet voucher → settlement
```

## 14. Troubleshooting

| Symptom | Likely cause |
|---|---|
| `Missing CONTRACT_ID` | Set `CONTRACT_ID`. The backend refuses to fall back outside tests. |
| Webhook 401 | Webhook secret mismatch, or timestamp > 300 s off. |
| Settle worker never runs | `NEXT_PUBLIC_APP_URL` is not public, or the QStash credentials are wrong. |
| Signature mismatch | Phone and backend disagree on contract / gateway / token, or the device key changed (re-run `/api/engine/offline-key`). |
| Contract `#9` | Relayer not whitelisted (`register_gateway`). |
| Contract `#7` / `#11` | ShortID not registered / `set_registrar` not run. |
| Contract `#6` | Vault does not cover amount + 0.5 PHPC toll. |
| Toll transfer fails | Treasury has no trustline. |
| SEP-24 503 | A ramp kill switch is off. |

## 15. Contributing & license

1. Fork and branch from `main`.
2. Keep CI green: `npm run typecheck`, `npm test` (backend), `cargo test` / `cargo fmt` (contracts).
3. Document new endpoints with an `@swagger` JSDoc block. It appears in `/api-docs` automatically.
4. Open a pull request describing the change and how you tested it.

Released under the [MIT License](../LICENSE) © 2026 The Pijin Team.
