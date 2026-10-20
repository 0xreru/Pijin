import type { Metadata } from 'next';
import { Info, Lightbulb, TriangleAlert } from 'lucide-react';
import DocsShell from '../components/DocsShell/DocsShell';
import { CodeBlock, Toc, type TocItem } from './DocsClient';
import './guide.css';

export const metadata: Metadata = {
  title: 'Setup & Integration Guide · Pijin',
  description:
    'Install, configure, deploy and integrate Pijin: the Next.js API, the Soroban contract, the Expo mobile app and the SMS settlement pipeline.',
};

const sections: TocItem[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'architecture', label: 'Architecture' },
  { id: 'prerequisites', label: 'Prerequisites' },
  { id: 'quickstart', label: 'Quick start' },
  { id: 'environment', label: 'Environment variables' },
  { id: 'contract', label: 'Smart contract' },
  { id: 'assets', label: 'Assets & database seed' },
  { id: 'sms', label: 'SMS gateway & queues' },
  { id: 'mobile', label: 'Mobile app' },
  { id: 'deploy', label: 'Deployment' },
  { id: 'integrate', label: 'Integration guide' },
  { id: 'security', label: 'Security model' },
  { id: 'testing', label: 'Testing' },
  { id: 'troubleshooting', label: 'Troubleshooting' },
  { id: 'contributing', label: 'Contributing & license' },
];

/* ── Code samples ─────────────────────────────────────────────────────────── */

const QUICKSTART = `git clone https://github.com/0xreru/Pijin.git
cd Pijin

# Install every workspace and build the contract bindings (packages/pijin_core)
npm install
npm run build:sdk

# Create local env files, then fill them in (see "Environment variables")
cp apps/backend/.env.example apps/backend/.env
cp apps/mobile/.env.example apps/mobile/.env

# Database schema
cd apps/backend
npx prisma generate
npx prisma migrate deploy

# API, landing page, simulator and these docs on http://localhost:3000
npm run dev`;

const CONTRACT_BUILD = `cd contracts
rustup target add wasm32v1-none
make test    # cargo test
make build   # stellar contract build
             # → target/wasm32v1-none/release/pijin_contract.wasm`;

const CONTRACT_KEYS = `# Testnet identities, funded by Friendbot
stellar keys generate admin     --network testnet --fund
stellar keys generate treasury  --network testnet --fund
stellar keys generate relayer   --network testnet --fund
stellar keys generate registrar --network testnet --fund

stellar keys address relayer   # G… public key
stellar keys secret  relayer   # S… secret (older CLIs: stellar keys show)`;

const CONTRACT_DEPLOY = `stellar contract deploy \\
  --wasm target/wasm32v1-none/release/pijin_contract.wasm \\
  --source admin --network testnet \\
  -- \\
  --admin    $(stellar keys address admin) \\
  --treasury $(stellar keys address treasury)

# Prints the contract ID (C…). Use it as CONTRACT_ID and EXPO_PUBLIC_CONTRACT_ID.`;

const CONTRACT_INIT = `CONTRACT_ID=C...

# 1. Hand ShortID registration to a narrowly-scoped registrar key
stellar contract invoke --id $CONTRACT_ID --source admin --network testnet -- \\
  set_registrar --admin $(stellar keys address admin) \\
                --registrar $(stellar keys address registrar)

# 2. Whitelist the relayer that is allowed to call spend_offline
stellar contract invoke --id $CONTRACT_ID --source admin --network testnet -- \\
  register_gateway --admin $(stellar keys address admin) \\
                   --gateway $(stellar keys address relayer)`;

const CONTRACT_BINDINGS = `stellar contract bindings typescript \\
  --network testnet --contract-id $CONTRACT_ID \\
  --output-dir packages/pijin_core --overwrite

# Keep the package name "pijin_core" in packages/pijin_core/package.json, then:
npm run build:sdk`;

const CONTRACT_UPGRADE = `stellar contract upload \\
  --wasm target/wasm32v1-none/release/pijin_contract.wasm \\
  --source admin --network testnet
# → prints the new WASM hash

stellar contract invoke --id $CONTRACT_ID --source admin --network testnet -- \\
  upgrade --new_wasm_hash <WASM_HASH>`;

const ASSET_MINT = `# From the repository root. Creates a fresh issuer + distributor, adds the
# trustline and mints 1,000,000,000 PHPC. Prints both secrets once.
node asset-mint.js

# Wrap the classic asset in its Stellar Asset Contract (SAC) → TOKEN_ID
stellar contract asset deploy \\
  --asset PHPC:<PHPC_ISSUER_PUBKEY> \\
  --source admin --network testnet`;

const TOKEN_SEED = `INSERT INTO token (symbol, contract_id, decimals, is_active, updated_at)
VALUES ('PHPC', '<TOKEN_ID>', 7, true, now());

-- The generated id (normally 1) is EXPO_PUBLIC_TOKEN_DB_ID and
-- the first field of every offline SMS voucher.`;

const LOCAL_TUNNEL = `# QStash must reach your machine to call /api/engine/settle
npx ngrok http 3000      # or: cloudflared tunnel --url http://localhost:3000

# apps/backend/.env
NEXT_PUBLIC_APP_URL="https://<your-tunnel>.ngrok-free.app"`;

const MOBILE_RUN = `cd apps/mobile

# Point the app at your backend (apps/mobile/.env)
#   EXPO_PUBLIC_API_BASE_URL="http://<LAN-IP>:3000"   # or your tunnel / Vercel URL

npm run android        # expo run:android — builds the dev client and installs it
npm run android:usb    # USB device: adb reverse + dev server on localhost
npm start              # Metro only, once the dev client is installed`;

const EAS_BUILD = `npm install -g eas-cli
cd apps/mobile
eas login
eas build --platform android --profile preview      # installable APK
eas build --platform android --profile production   # store build`;

const VERCEL = `Framework preset  Next.js
Root directory    apps/backend
Install command   (default — npm installs the workspace from the repo root)
Build command     npx prisma generate && next build
Node.js version   20.x`;

const SEP10_SAMPLE = `import { Keypair, TransactionBuilder } from '@stellar/stellar-sdk';

const API = 'https://pijin.live';
const wallet = Keypair.fromSecret(process.env.WALLET_SECRET!);

// 1. Challenge
const challenge = await fetch(
  \`\${API}/api/auth?account=\${wallet.publicKey()}\`,
).then((r) => r.json());

// 2. Co-sign and exchange it for a JWT
const tx = TransactionBuilder.fromXDR(challenge.transaction, challenge.network_passphrase);
tx.sign(wallet);

const { token } = await fetch(\`\${API}/api/auth\`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ transaction: tx.toXDR() }),
}).then((r) => r.json());

// 3. Use it
const headers = { Authorization: \`Bearer \${token}\` };`;

const ONBOARD_SEQUENCE = `POST /api/otp/send                  { phoneNumber }
POST /api/otp/verify                { phoneNumber, code }       → verificationToken
POST /api/friendbot                 { publicKey }               → 50 XLM on Testnet
     (app adds PHPC / USDC trustlines with the wallet key)
POST /api/register                  { stellarPublicKey, phoneNumber, pin,
                                      offlineDeviceKey, verificationToken, … } → shortId
GET  /api/auth  →  POST /api/auth   SEP-10                      → JWT
POST /api/engine/recipient-registry (JWT)                       → offlineConfig
POST /api/engine/offline-key        (JWT) { offlineDeviceKey }  → synced | rotation_required`;

const WALLET_SIG_SAMPLE = `import { Keypair, TransactionBuilder, rpc } from '@stellar/stellar-sdk';

const server = new rpc.Server('https://soroban-testnet.stellar.org');
const amountStroops = '500000000';   // 50 PHPC

// Canonical message for /api/engine/deposit
const message = \`deposit:\${wallet.publicKey()}:\${amountStroops}\`;
const signature = wallet.sign(Buffer.from(message)).toString('base64');

const { xdr } = await fetch(\`\${API}/api/engine/deposit\`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: \`Bearer \${signature}\`,
  },
  body: JSON.stringify({
    senderPublicKey: wallet.publicKey(),
    tokenAddress: TOKEN_ID,                       // PHPC SAC
    offlineDevicePubkeyHex: device.rawPublicKey().toString('hex'),
    amountStroops,
  }),
}).then((r) => r.json());

// The backend only assembles. The wallet signs and submits.
const tx = TransactionBuilder.fromXDR(xdr, NETWORK_PASSPHRASE);
tx.sign(wallet);
await server.sendTransaction(tx);`;

const VOUCHER_FORMAT = `<tokenDbId>:<senderShortId>:<receiverShortId>:<amountBase62>:<nonce>:<signature>

1:aB3x9Q:Zx7mNk:1Ly8Hk:Hq3...unpaddedBase64(32 bytes):Rk1...unpaddedBase64(64 bytes)`;

const VOUCHER_SAMPLE = `import { Address, Keypair, nativeToScVal, xdr } from '@stellar/stellar-sdk';

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const toBase62 = (n: bigint) => {
  let s = '';
  do { s = BASE62[Number(n % 62n)] + s; n /= 62n; } while (n > 0n);
  return s;
};
const unpadded = (b: Uint8Array) => Buffer.from(b).toString('base64').replace(/=+$/, '');

export function buildVoucher(opts: {
  device: Keypair;              // offline device key registered on-chain
  senderShortId: string;
  receiverShortId: string;      // exact, case-sensitive
  amountStroops: bigint;
  cfg: OfflineConfig;           // from POST /api/engine/recipient-registry
}) {
  const toll = 5_000_000n;      // 0.5 PHPC protocol toll
  const nonce = crypto.getRandomValues(new Uint8Array(32));

  // Field order must match the contract byte-for-byte
  const message = xdr.ScVal.scvVec([
    nativeToScVal(opts.amountStroops, { type: 'i128' }),
    nativeToScVal(toll, { type: 'i128' }),
    xdr.ScVal.scvBytes(Buffer.from(nonce)),
    xdr.ScVal.scvBytes(Buffer.from(opts.receiverShortId, 'ascii')),
    Address.fromString(opts.cfg.gatewayPublicKey).toScVal(),
    Address.fromString(opts.cfg.tokenContractId).toScVal(),
    Address.fromString(opts.cfg.contractId).toScVal(),
  ]).toXDR();

  const signature = opts.device.sign(message);

  return [
    opts.cfg.tokenDbId,
    opts.senderShortId,
    opts.receiverShortId,
    toBase62(opts.amountStroops),
    unpadded(nonce),
    unpadded(signature),
  ].join(':');
}`;

const SUBMIT_DIRECT = `# Direct path for a client that is back online (no SMS)
curl -X POST https://pijin.live/api/settlements \\
  -H 'Content-Type: application/json' \\
  -d '{"smsBody":"1:aB3x9Q:Zx7mNk:1Ly8Hk:<nonce>:<signature>"}'

# → 200 { "txHash": "…", "status": "SETTLED" }
# → 409 when the nonce was already processed (returns the original txHash)`;

const RAMP_SEQUENCE = `Deposit (GCash → PHPC)
  POST /api/sep24/transactions/deposit/interactive   (JWT) { asset_code: "PHPC" } → { url, id }
  open url in a webview → user confirms → POST /api/anchor/simulate-payment (interactive token)
  poll GET /api/sep24/transaction?id=<id>           (JWT) until "completed"

Withdrawal (PHPC → GCash)
  POST /api/sep24/transactions/withdraw/interactive  (JWT) { asset_code: "PHPC" } → { url, id }
  webview → POST /api/anchor/submit-withdraw          (interactive token) → memo issued
  wallet pays the treasury with that memo
  POST /api/anchor/confirm-withdraw                   (JWT) { transaction_id, stellar_transaction_id }
  poll GET /api/sep24/transaction?id=<id>             → "pending_external"`;

const TEST_CMDS = `# Backend security, settlement and demo suites (node:test via tsx)
cd apps/backend && npm test

# Contract unit tests
cd contracts && cargo test

# Type checks (backend + pijin_core), as run in CI
npm run typecheck

# Live Testnet end-to-end runs (need a funded .env)
cd apps/backend
npx tsx scripts/e2e-live-test.ts          # offline voucher → settlement
npx tsx scripts/simulate-sep24-deposit.ts # SEP-24 deposit`;

/* ── Small presentational helpers ─────────────────────────────────────────── */

function Section({ id, n, title, children }: { id: string; n: number; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="g-section" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>
        <span className="g-num" aria-hidden="true">
          {String(n).padStart(2, '0')}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Callout({ kind, children }: { kind: 'note' | 'warn' | 'tip'; children: React.ReactNode }) {
  const Icon = kind === 'warn' ? TriangleAlert : kind === 'tip' ? Lightbulb : Info;
  return (
    <div className={`g-callout g-callout-${kind}`} role={kind === 'warn' ? 'note' : undefined}>
      <Icon size={18} aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}

function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="g-table-wrap" tabIndex={0} role="region" aria-label={head.join(', ')}>
      <table>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j} data-label={head[j]}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const c = (s: string) => <code>{s}</code>;

/* ── Page ─────────────────────────────────────────────────────────────────── */

export default function GuidePage() {
  return (
    <DocsShell active="guide">
      <section className="pj-hero">
        <div className="pj-hero-inner">
          <span className="pj-eyebrow">Open-source release · MIT</span>
          <h1>Setup & Integration Guide</h1>
          <p className="pj-hero-lead">
            Run the whole Pijin stack yourself: the Next.js API and SEP anchor, the Soroban vault contract, the Expo
            Android app, and the SMS → QStash → Soroban settlement pipeline. Then integrate with it from your own
            wallet or service.
          </p>
          <div className="pj-chips">
            <span className="pj-chip">
              <span className="pj-chip-dot" aria-hidden="true" />
              Stellar Testnet
            </span>
            <span className="pj-chip">Soroban · Rust</span>
            <span className="pj-chip">Next.js 16 · Expo 52</span>
            <span className="pj-chip">SEP-1 · SEP-10 · SEP-24</span>
          </div>
          <div className="g-quicklinks">
            <a className="g-quicklink" href="#quickstart">
              <strong>Quick start</strong>
              <span>Clone, install and run locally</span>
            </a>
            <a className="g-quicklink" href="#contract">
              <strong>Deploy the contract</strong>
              <span>Build, deploy and initialise</span>
            </a>
            <a className="g-quicklink" href="#integrate">
              <strong>Integrate</strong>
              <span>Auth, vaults, offline vouchers</span>
            </a>
            <a className="g-quicklink" href="/api-docs">
              <strong>API reference</strong>
              <span>Interactive OpenAPI docs</span>
            </a>
          </div>
        </div>
      </section>

      <div className="g-layout">
        <aside>
          <Toc items={sections} />
        </aside>

        <article className="g-content">
          {/* 01 ─────────────────────────────────────────────────────────── */}
          <Section id="overview" n={1} title="Overview">
            <p className="g-lead">
              Pijin lets people pay each other with Stellar stablecoins without mobile data. Payments are signed
              offline on the phone, carried as a single SMS, and settled atomically by a Soroban contract.
            </p>
            <p>The repository is an npm-workspaces monorepo:</p>
            <Table
              head={['Path', 'What it is']}
              rows={[
                [c('apps/backend'), 'Next.js 16 app: REST API, SEP-1/10/24 anchor, SMS webhook and QStash workers, landing page, browser simulator, and these docs.'],
                [c('apps/mobile'), 'Expo 52 / React Native 0.76 Android app with a local SQLite (Drizzle) store and offline Ed25519 signing.'],
                [c('contracts'), 'The Pijin Soroban contract (Rust, soroban-sdk 22): vaults, offline spend, ShortID registry, gateway whitelist.'],
                [c('packages/pijin_core'), 'Generated TypeScript bindings for the contract, consumed by the backend.'],
                [c('asset-mint.js'), 'Testnet helper that mints the PHPC asset.'],
                [c('.github/workflows'), 'CI for the backend (typecheck, tests), contracts (cargo test, wasm build) and mobile (tsc, expo export).'],
              ]}
            />
          </Section>

          {/* 02 ─────────────────────────────────────────────────────────── */}
          <Section id="architecture" n={2} title="Architecture">
            <p>An offline payment travels through five components:</p>
            <ol className="g-flow" aria-label="Offline payment pipeline">
              <li>
                <span className="g-flow-label">Phone</span>
                <strong>Sign voucher</strong>
                <span>Device key signs amount, toll, nonce and receiver ShortID.</span>
              </li>
              <li>
                <span className="g-flow-label">GSM</span>
                <strong>SMS / Payload QR</strong>
                <span>Sender or a bystander texts the 6-part payload.</span>
              </li>
              <li>
                <span className="g-flow-label">Textbee</span>
                <strong>/api/sms/webhook</strong>
                <span>HMAC, rate limit, replay cache, format checks.</span>
              </li>
              <li>
                <span className="g-flow-label">QStash</span>
                <strong>/api/engine/settle</strong>
                <span>Deduplicated, retried worker; pre-verifies the signature.</span>
              </li>
              <li className="g-flow-dark">
                <span className="g-flow-label">Soroban</span>
                <strong>spend_offline</strong>
                <span>Verifies signer and nonce, resolves ShortID, moves funds.</span>
              </li>
            </ol>
            <div className="g-grid">
              <div className="g-card">
                <h4>Online wallet</h4>
                <p>
                  A normal Stellar account holding PHPC/USDC. Funded through SEP-24 (GCash) and used for online
                  transfers.
                </p>
              </div>
              <div className="g-card">
                <h4>Offline vault</h4>
                <p>
                  A per-user, per-token balance inside the contract. Only this balance can be spent with offline
                  vouchers.
                </p>
              </div>
              <div className="g-card">
                <h4>Two keys per user</h4>
                <p>
                  The <strong>wallet key</strong> controls the Stellar account. The <strong>device key</strong> is
                  registered on-chain and signs only offline vouchers.
                </p>
              </div>
              <div className="g-card">
                <h4>Backend as a dumb pipe</h4>
                <p>
                  The relayer pays gas and submits, but cannot forge, alter or replay a voucher. The contract checks
                  everything again.
                </p>
              </div>
            </div>
            <p>
              The backend never holds user keys. For vault and transfer operations it only <em>assembles</em> Soroban
              transactions. The phone signs and submits them.
            </p>
          </Section>

          {/* 03 ─────────────────────────────────────────────────────────── */}
          <Section id="prerequisites" n={3} title="Prerequisites">
            <Table
              head={['Tool / service', 'Needed for', 'Notes']}
              rows={[
                ['Node.js 20+ and npm 10+', 'Everything', 'CI runs Node 20.'],
                ['Rust (stable) + wasm32v1-none', 'Contract', c('rustup target add wasm32v1-none')],
                [<a key="cli" href="https://developers.stellar.org/docs/tools/cli">Stellar CLI</a>, 'Contract', 'Build, deploy, invoke, generate bindings.'],
                ['PostgreSQL 14+', 'Backend', 'Neon serverless works out of the box.'],
                ['Upstash QStash + Redis', 'Backend', 'Settlement queue, SMS queue, rate limits, OTP and replay caches.'],
                ['Textbee + an Android phone with a SIM', 'SMS', 'Acts as the inbound/outbound SMS gateway.'],
                ['Android Studio, JDK 17, a device or emulator', 'Mobile', 'Local dev builds. EAS can build in the cloud.'],
                ['Expo account + EAS CLI', 'Mobile', 'Only for cloud builds and distribution.'],
              ]}
            />
            <Callout kind="note">
              <p>
                You can run and test the backend and contract without SMS. Use the direct settlement path (
                <a href="#submit">Submitting vouchers</a>) and the browser simulator at <code>/demo-split</code>.
              </p>
            </Callout>
          </Section>

          {/* 04 ─────────────────────────────────────────────────────────── */}
          <Section id="quickstart" n={4} title="Quick start">
            <CodeBlock title="terminal" code={QUICKSTART} />
            <p>
              Open <code>http://localhost:3000/api/health</code>. A healthy server returns{' '}
              <code>{'{ "status": "healthy" }'}</code>. Add <code>?deep=1</code> to include Textbee device status.
            </p>
            <Callout kind="tip">
              <p>
                <code>npm run build:sdk</code> must run again whenever you regenerate <code>packages/pijin_core</code>.
                The backend imports the compiled <code>dist/</code> output.
              </p>
            </Callout>
          </Section>

          {/* 05 ─────────────────────────────────────────────────────────── */}
          <Section id="environment" n={5} title="Environment variables">
            <p>
              Every variable is listed with placeholder values in <code>apps/backend/.env.example</code> and{' '}
              <code>apps/mobile/.env.example</code>. Never commit real secrets. <code>EXPO_PUBLIC_*</code> values are
              compiled into the APK and are public.
            </p>
            <h3 id="env-backend">Backend</h3>
            <Table
              head={['Group', 'Variables', 'Purpose']}
              rows={[
                ['Core', <>{c('DATABASE_URL')}, {c('NEXT_PUBLIC_APP_URL')}, {c('CORS_ORIGIN')}</>, 'Postgres connection and the public base URL (used for SEP-24 webview links and QStash callbacks).'],
                ['Stellar', <>{c('SOROBAN_RPC_URL')}, {c('STELLAR_NETWORK_PASSPHRASE')}, {c('STELLAR_HORIZON_URL')}</>, 'Network endpoints.'],
                ['Contract', <>{c('CONTRACT_ID')}, {c('TOKEN_ID')}, {c('OFFLINE_TOKEN_SYMBOL')}</>, 'Deployed contract, PHPC SAC, and the token row used for offline payments (default PHPC).'],
                ['Keys', <>{c('RELAYER_*')}, {c('REGISTRAR_*')}, {c('TREASURY_PUBLIC_KEY')}</>, 'Gateway that submits spend_offline, ShortID registrar, toll and withdrawal recipient.'],
                ['Assets', <>{c('PHPC_ISSUER_PUBKEY')}, {c('PHPC_DISTRIBUTOR_SECRET')}, {c('USDC_*')}</>, 'Anchor issuer and distributor for SEP-24 payouts and the friendbot helper.'],
                ['SEP-10', <>{c('SECRET_SEP10_SIGNING_SEED')}, {c('SECRET_SEP10_JWT_SECRET')}, {c('SEP10_HOME_DOMAINS')}</>, 'Challenge signing key, JWT secret, accepted home domains, timeouts.'],
                ['SEP-24', c('SECRET_SEP24_INTERACTIVE_URL_JWT_SECRET'), 'Separate secret for 15-minute webview tokens.'],
                ['Textbee', <>{c('TEXTBEE_GATEWAY_URL')}, {c('TEXTBEE_API_KEY')}, {c('TEXTBEE_DEVICE_ID')}, {c('TEXTBEE_WEBHOOK_SECRET')}</>, 'Outbound SMS and inbound webhook HMAC. Optional TEXTBEE_FALLBACK_* for a second SIM.'],
                ['Upstash', <>{c('QSTASH_TOKEN')}, {c('QSTASH_*_SIGNING_KEY')}, {c('UPSTASH_REDIS_REST_*')}</>, 'Queues, signature verification, rate limits.'],
                ['OTP', <>{c('OTP_VERIFICATION_JWT_SECRET')}, {c('REQUIRE_OTP_TOKEN')}, {c('OTP_GLOBAL_LIMIT_PER_HOUR')}</>, 'Phone verification. OTP_TEST_* is an emergency tester fallback; keep it off.'],
                ['Ramps', <>{c('RAMP_ENABLED')}, {c('DEPOSIT_ENABLED')}, {c('WITHDRAW_ENABLED')}, {c('RAMP_MAX_*')}</>, 'Kill switches and per-transaction / daily limits (optional).'],
                ['Demo', <>{c('DEMO_ENABLED')}, {c('DEMO_ACCESS_CODE')}, {c('DEMO_POOL_*')}</>, 'Browser simulator account pool (Testnet only).'],
              ]}
            />
            <h3 id="env-mobile">Mobile</h3>
            <Table
              head={['Variable', 'Purpose']}
              rows={[
                [c('EXPO_PUBLIC_API_BASE_URL'), 'Backend base URL.'],
                [c('EXPO_PUBLIC_ANCHOR_DOMAIN'), 'Host serving /.well-known/stellar.toml for SEP-10/24.'],
                [<>{c('EXPO_PUBLIC_CONTRACT_ID')}, {c('EXPO_PUBLIC_TOKEN_ID')}</>, 'Must match the backend CONTRACT_ID / TOKEN_ID.'],
                [c('EXPO_PUBLIC_TOKEN_DB_ID'), 'Numeric Token.id from the database (first voucher field).'],
                [c('EXPO_PUBLIC_GATEWAY_PUBLIC_KEY'), 'Relayer G-address bound into voucher signatures.'],
                [c('EXPO_PUBLIC_SMS_GATEWAY_NUMBER'), 'Phone number of the Textbee gateway SIM.'],
                [<>{c('EXPO_PUBLIC_PHPC_ISSUER_PUBKEY')}, {c('EXPO_PUBLIC_USDC_ISSUER_PUBKEY')}</>, 'Issuers for trustlines.'],
                [<>{c('EXPO_PUBLIC_SOROBAN_RPC_URL')}, {c('EXPO_PUBLIC_HORIZON_URL')}, {c('EXPO_PUBLIC_STELLAR_NETWORK_PASSPHRASE')}</>, 'Network endpoints.'],
                [c('EXPO_PUBLIC_WALLETCONNECT_*'), 'Optional WalletConnect pairing.'],
              ]}
            />
            <Callout kind="warn">
              <p>
                The contract ID, gateway key and token contract are all inside every voucher signature. If the phone and
                backend disagree on any of them, every offline payment fails verification.
              </p>
            </Callout>
          </Section>

          {/* 06 ─────────────────────────────────────────────────────────── */}
          <Section id="contract" n={6} title="Smart contract">
            <h3>Build and test</h3>
            <CodeBlock title="terminal" code={CONTRACT_BUILD} />
            <h3>Create identities</h3>
            <p>
              You need four Testnet accounts: <strong>admin</strong> (upgrades, gateway and registrar control),{' '}
              <strong>treasury</strong> (receives protocol tolls and withdrawals), <strong>relayer</strong> (pays gas
              and submits <code>spend_offline</code>) and <strong>registrar</strong> (maps ShortIDs).
            </p>
            <CodeBlock title="terminal" code={CONTRACT_KEYS} />
            <h3>Deploy</h3>
            <p>
              The constructor takes the admin and treasury addresses. The admin is also the initial registrar.
            </p>
            <CodeBlock title="terminal" code={CONTRACT_DEPLOY} />
            <h3>Initialise</h3>
            <CodeBlock title="terminal" code={CONTRACT_INIT} />
            <h3>Regenerate the TypeScript bindings</h3>
            <p>Do this after deploying a new contract or changing its interface:</p>
            <CodeBlock title="terminal" code={CONTRACT_BINDINGS} />
            <h3>Upgrade in place</h3>
            <p>Upgrades keep the contract ID and all storage (vaults, nonces, registry):</p>
            <CodeBlock title="terminal" code={CONTRACT_UPGRADE} />
            <h3 id="contract-reference">Function reference</h3>
            <Table
              head={['Function', 'Caller', 'Effect']}
              rows={[
                [c('__constructor(admin, treasury)'), 'Deployer', 'Stores admin and treasury. Admin is the default registrar.'],
                [c('upgrade(new_wasm_hash)'), 'Admin', 'Replaces the WASM, keeping storage.'],
                [c('deposit(sender, token, pubkey, amount)'), 'User', 'Moves tokens into the sender’s vault and registers the offline device key.'],
                [c('withdraw(sender, token, amount)'), 'User', 'Returns vault tokens to the wallet. A full withdrawal frees the storage entry.'],
                [c('get_vault(user, token)'), 'Anyone', 'Vault balance in stroops.'],
                [c('set_offline_key(sender, pubkey)'), 'User', 'Rotates the device key without a deposit.'],
                [c('get_offline_key(sender)'), 'Anyone', 'Currently registered device key.'],
                [c('spend_offline(gateway, sender, token, receiver_short_id, amount, protocol_toll, nonce, signature)'), 'Whitelisted gateway', 'Verifies the device signature and nonce, resolves the ShortID, debits amount + toll, credits the receiver’s vault, transfers the toll to treasury and emits a spend event.'],
                [c('set_registrar(admin, registrar)'), 'Admin', 'Assigns the ShortID registrar.'],
                [c('get_registrar()'), 'Anyone', 'Current registrar.'],
                [c('register_recipient(registrar, short_id, receiver)'), 'Registrar', 'Maps a 6-byte Base62 ShortID to an address. Idempotent for identical mappings.'],
                [c('update_recipient(registrar, short_id, receiver)'), 'Registrar', 'Re-points an existing ShortID.'],
                [c('get_recipient(short_id)'), 'Anyone', 'Resolves a ShortID.'],
                [<>{c('register_gateway')} / {c('remove_gateway')}</>, 'Admin', 'Manages the relayer whitelist.'],
              ]}
            />
            <p>
              Error codes: <code>1</code> AlreadyInitialized, <code>2</code> Unauthorized, <code>3</code>{' '}
              InvalidAmount, <code>4</code> ExpiredVoucher, <code>5</code> NonceReplayed, <code>6</code>{' '}
              InsufficientBalance, <code>7</code> RecipientNotFound, <code>8</code> MathOverflow, <code>9</code>{' '}
              NotWhitelistedGateway, <code>10</code> ShortIdAlreadyRegistered, <code>11</code> RegistrarNotConfigured,{' '}
              <code>12</code> InvalidShortId.
            </p>
          </Section>

          {/* 07 ─────────────────────────────────────────────────────────── */}
          <Section id="assets" n={7} title="Assets & database seed">
            <CodeBlock title="terminal" code={ASSET_MINT} />
            <p>
              Set <code>PHPC_ISSUER_PUBKEY</code>, <code>PHPC_DISTRIBUTOR_SECRET</code> and <code>TOKEN_ID</code> in the
              backend, and the matching <code>EXPO_PUBLIC_*</code> values in the app.
            </p>
            <Callout kind="warn">
              <p>
                The contract <strong>transfers</strong> the protocol toll to the treasury, and withdrawals pay the
                treasury directly. Add PHPC (and USDC) <strong>trustlines to the treasury account</strong>, for example
                in Stellar Laboratory. Without them settlement fails.
              </p>
            </Callout>
            <p>Offline settlement looks the token up by its numeric database id. Seed it once:</p>
            <CodeBlock title="SQL" code={TOKEN_SEED} />
          </Section>

          {/* 08 ─────────────────────────────────────────────────────────── */}
          <Section id="sms" n={8} title="SMS gateway & queues">
            <ol className="g-steps">
              <li>
                <strong>Install Textbee</strong>
                Install the Textbee Android app on a phone with an active SIM and link it to your Textbee account. Copy
                the device ID and API key into <code>TEXTBEE_DEVICE_ID</code>, <code>TEXTBEE_API_KEY</code> and{' '}
                <code>TEXTBEE_GATEWAY_URL</code>.
              </li>
              <li>
                <strong>Register the inbound webhook</strong>
                Point Textbee’s <code>MESSAGE_RECEIVED</code> webhook at{' '}
                <code>https://&lt;host&gt;/api/sms/webhook</code> and use the same signing secret as{' '}
                <code>TEXTBEE_WEBHOOK_SECRET</code>. <code>GET /api/sms/webhook</code> reports which settings are
                present.
              </li>
              <li>
                <strong>Create Upstash resources</strong>
                Create a QStash project and a Redis database. Copy the token, both signing keys and the Redis REST
                credentials.
              </li>
              <li>
                <strong>Expose the backend</strong>
                QStash calls <code>NEXT_PUBLIC_APP_URL/api/engine/settle</code>, so that URL must be public. For local
                development, use a tunnel:
              </li>
            </ol>
            <CodeBlock title="terminal" code={LOCAL_TUNNEL} />
            <p>
              Set the app’s <code>EXPO_PUBLIC_SMS_GATEWAY_NUMBER</code> to the gateway SIM’s number. Outbound receipts
              are queued through <code>/api/sms/dispatch</code>, which QStash throttles to 10 per minute so they never
              crowd out OTP delivery.
            </p>
          </Section>

          {/* 09 ─────────────────────────────────────────────────────────── */}
          <Section id="mobile" n={9} title="Mobile app">
            <CodeBlock title="terminal" code={MOBILE_RUN} />
            <p>
              The app runs as a development build (<code>expo-dev-client</code>), not in Expo Go. Cloud builds use the
              profiles in <code>apps/mobile/eas.json</code>:
            </p>
            <Table
              head={['Profile', 'Output', 'Backend']}
              rows={[
                [c('development'), 'Dev client (internal)', c('pijin-api.vercel.app')],
                [c('preview'), 'Installable APK (internal)', c('preview-pijin.vercel.app')],
                [c('production'), 'Store build', c('pijin-api.vercel.app')],
              ]}
            />
            <CodeBlock title="terminal" code={EAS_BUILD} />
          </Section>

          {/* 10 ─────────────────────────────────────────────────────────── */}
          <Section id="deploy" n={10} title="Deployment">
            <h3>Backend on Vercel</h3>
            <p>Import the repository and use these project settings:</p>
            <CodeBlock title="Vercel project settings" code={VERCEL} />
            <p>
              The compiled bindings in <code>packages/pijin_core/dist</code> are committed, so Vercel does not need to
              build them. Rebuild and commit them whenever you regenerate the bindings.
            </p>
            <ol>
              <li>Add every backend variable from <a href="#env-backend">the table above</a> to the project.</li>
              <li>
                Run <code>npx prisma migrate deploy</code> against the production database before the first deploy and
                after each new migration.
              </li>
              <li>
                Set <code>NEXT_PUBLIC_APP_URL</code> and <code>SEP10_HOME_DOMAINS</code> to the deployed domain, then
                check <code>/.well-known/stellar.toml</code>.
              </li>
              <li>Update the Textbee webhook URL to the production host.</li>
            </ol>
            <h3>Checklist</h3>
            <ul>
              <li>Contract deployed, registrar set, relayer whitelisted.</li>
              <li>PHPC SAC deployed; treasury has trustlines; the <code>token</code> row is seeded.</li>
              <li>Backend and app agree on contract ID, token ID, token DB id and gateway key.</li>
              <li>
                <code>/api/health?deep=1</code> is <code>healthy</code> and <code>/api-docs</code> loads.
              </li>
              <li>An end-to-end voucher settles and shows up on Stellar Expert.</li>
            </ul>
          </Section>

          {/* 11 ─────────────────────────────────────────────────────────── */}
          <Section id="integrate" n={11} title="Integration guide">
            <p>
              Request and response schemas for every endpoint are in the <a href="/api-docs">API reference</a>. This
              section covers how the calls fit together.
            </p>

            <h3 id="auth">Authenticate with SEP-10</h3>
            <p>
              Protected endpoints take a SEP-10 JWT. The challenge is a Stellar transaction signed by the anchor. Your
              wallet co-signs it and exchanges it for a token.
            </p>
            <CodeBlock title="sep10.ts" lang="ts" code={SEP10_SAMPLE} />

            <h3 id="onboarding">Onboard a user</h3>
            <p>This is the order the Pijin app uses:</p>
            <CodeBlock title="sequence" code={ONBOARD_SEQUENCE} />
            <p>
              <code>recipient-registry</code> writes the user’s ShortID on-chain and returns{' '}
              <code>offlineConfig</code>: the contract ID, gateway key, token contract and token DB id that every
              voucher must bind.
            </p>

            <h3 id="vault">Move funds into the offline vault</h3>
            <p>
              <code>/api/engine/deposit</code>, <code>/withdraw</code> and <code>/transfer</code> authenticate with a
              wallet signature over a canonical message, not a JWT:
            </p>
            <Table
              head={['Endpoint', 'Signed message']}
              rows={[
                [c('POST /api/engine/deposit'), c('deposit:<senderPublicKey>:<amountStroops>')],
                [c('POST /api/engine/withdraw'), c('withdraw:<senderPublicKey>:<amountStroops>')],
                [c('POST /api/engine/transfer'), c('transfer:v2:online:<tokenAddress>:<sender>:<recipient>:<amountStroops>')],
              ]}
            />
            <CodeBlock title="deposit.ts" lang="ts" code={WALLET_SIG_SAMPLE} />
            <p>
              After an online transfer, post its hash to <code>/api/wallet/transfers/confirm</code> so it appears in
              history.
            </p>

            <h3 id="vouchers">Build an offline voucher</h3>
            <p>A voucher is six colon-separated fields that fit in one SMS:</p>
            <CodeBlock title="format" code={VOUCHER_FORMAT} />
            <Table
              head={['Field', 'Encoding']}
              rows={[
                ['tokenDbId', 'Decimal Token.id from offlineConfig.tokenDbId'],
                ['senderShortId / receiverShortId', '6 case-sensitive Base62 characters'],
                ['amountBase62', 'Amount in stroops, Base62 (0-9A-Za-z)'],
                ['nonce', '32 random bytes, Base64 without padding'],
                ['signature', '64-byte Ed25519 signature by the device key, Base64 without padding'],
              ]}
            />
            <p>
              The device key signs the XDR of a 7-element <code>ScVec</code>:{' '}
              <code>(amount, protocol_toll, nonce, receiver_short_id, gateway, token, contract)</code>. The protocol
              toll is 0.5 PHPC (<code>5000000</code> stroops). The sender’s vault must cover amount + toll.
            </p>
            <CodeBlock title="voucher.ts" lang="ts" code={VOUCHER_SAMPLE} />

            <h3 id="submit">Submit vouchers</h3>
            <ul>
              <li>
                <strong>SMS (production path):</strong> text the voucher to the gateway number. The webhook verifies,
                rate-limits and enqueues it, and QStash calls the settle worker with a deduplication ID of{' '}
                <code>&lt;senderShortId&gt;_&lt;nonce&gt;</code>.
              </li>
              <li>
                <strong>Payload QR:</strong> show the same string as a QR code. Anyone can scan it and send the SMS but
                cannot change it.
              </li>
              <li>
                <strong>Direct HTTP:</strong> clients that are back online can settle synchronously:
              </li>
            </ul>
            <CodeBlock title="terminal" code={SUBMIT_DIRECT} />
            <Callout kind="warn">
              <p>
                <code>/api/engine/settle</code> accepts only QStash-signed requests in production. Don’t call it from
                clients.
              </p>
            </Callout>

            <h3 id="ramps">Fiat on/off ramps (SEP-24)</h3>
            <CodeBlock title="sequence" code={RAMP_SEQUENCE} />
            <p>
              Discover assets with <code>GET /api/sep24/info</code> and the anchor’s endpoints from{' '}
              <code>/.well-known/stellar.toml</code>. Limits and kill switches return <code>400</code> and{' '}
              <code>503</code>.
            </p>

            <h3 id="reads">Read balances and history</h3>
            <Table
              head={['Endpoint', 'Returns']}
              rows={[
                [c('GET /api/wallet/balance?publicKey&assetCode'), 'Online (Horizon) balance. 0 when unfunded or no trustline.'],
                [c('GET /api/vault-balance?shortId | stellarPublicKey'), 'Offline vault balance from get_vault.'],
                [c('GET /api/wallet/history?shortId&publicKey'), 'Merged offline, online and anchor history (latest 50).'],
                [c('GET /api/users/lookup?shortId'), 'Display name and keys, for confirming a recipient before paying.'],
              ]}
            />
          </Section>

          {/* 12 ─────────────────────────────────────────────────────────── */}
          <Section id="security" n={12} title="Security model">
            <div className="g-grid">
              <div className="g-card">
                <h4>Keys stay on the phone</h4>
                <p>Wallet and device keys never leave the device. The backend only assembles unsigned transactions.</p>
              </div>
              <div className="g-card">
                <h4>Signature-bound vouchers</h4>
                <p>
                  Amount, toll, nonce, receiver, gateway, token and contract are all signed. Changing any one breaks
                  verification.
                </p>
              </div>
              <div className="g-card">
                <h4>Replay protection</h4>
                <p>Redis nonce cache, QStash deduplication, a unique DB nonce and on-chain nonce storage.</p>
              </div>
              <div className="g-card">
                <h4>Authenticated ingress</h4>
                <p>
                  Constant-time HMAC-SHA256 with optional ±300 s timestamp drift, 2 KB body cap and per-phone rate
                  limits.
                </p>
              </div>
              <div className="g-card">
                <h4>Fault isolation</h4>
                <p>
                  Infrastructure failures return 500 so QStash retries. Contract rejections return 200, so they are
                  not retried.
                </p>
              </div>
              <div className="g-card">
                <h4>Least privilege on-chain</h4>
                <p>Separate admin, registrar and gateway roles. Only whitelisted gateways can call spend_offline.</p>
              </div>
            </div>
            <Callout kind="warn">
              <p>
                <strong>Before mainnet:</strong> remove or gate the <code>mock-</code> simulator path in{' '}
                <code>/api/anchor/simulate-payment</code>, keep <code>DEMO_ENABLED</code> and <code>OTP_TEST_MODE</code>{' '}
                off, set <code>REQUIRE_OTP_TOKEN=true</code>, and connect a real fiat anchor in place of the simulated
                GCash flow.
              </p>
            </Callout>
            <p>
              To report a vulnerability, contact the team privately at{' '}
              <a href="mailto:support.pijin@gmail.com">support.pijin@gmail.com</a> before opening a public issue.
            </p>
          </Section>

          {/* 13 ─────────────────────────────────────────────────────────── */}
          <Section id="testing" n={13} title="Testing">
            <CodeBlock title="terminal" code={TEST_CMDS} />
          </Section>

          {/* 14 ─────────────────────────────────────────────────────────── */}
          <Section id="troubleshooting" n={14} title="Troubleshooting">
            <Table
              head={['Symptom', 'Likely cause']}
              rows={[
                [c('Missing CONTRACT_ID'), 'The backend refuses to start without an explicit contract in non-test environments.'],
                ['Webhook returns 401', 'TEXTBEE_WEBHOOK_SECRET differs from the Textbee signing secret, or the timestamp header is more than 300 s off.'],
                ['Settle worker never runs', 'NEXT_PUBLIC_APP_URL is not publicly reachable by QStash, or the QStash token or signing keys are wrong.'],
                [<>Settlement <code>FAILED</code>, signature mismatch</>, 'Phone and backend disagree on contract ID, gateway key or token contract, or the device key on-chain differs (re-run /api/engine/offline-key).'],
                [<>Contract error <code>#9</code></>, 'The relayer is not whitelisted. Run register_gateway.'],
                [<>Contract error <code>#7</code> / <code>#11</code></>, 'The receiver ShortID is not registered, or set_registrar was never run.'],
                [<>Contract error <code>#6</code></>, 'The vault does not cover amount + 0.5 PHPC toll.'],
                ['Toll transfer fails', 'The treasury has no trustline for the token.'],
                [c('Offline payment token is not configured'), 'Seed the token table and check OFFLINE_TOKEN_SYMBOL.'],
                [<>SEP-24 returns <code>503</code></>, 'RAMP_ENABLED, DEPOSIT_ENABLED or WITHDRAW_ENABLED is false.'],
              ]}
            />
          </Section>

          {/* 15 ─────────────────────────────────────────────────────────── */}
          <Section id="contributing" n={15} title="Contributing & license">
            <ol>
              <li>
                Fork <a href="https://github.com/0xreru/Pijin">0xreru/Pijin</a> and branch from <code>main</code>.
              </li>
              <li>
                Keep CI green: <code>npm run typecheck</code>, <code>npm test</code> in <code>apps/backend</code>,{' '}
                <code>cargo test</code> and <code>cargo fmt</code> in <code>contracts</code>. The Husky pre-commit
                hook runs the type checks and formats staged Rust files.
              </li>
              <li>
                Document new endpoints with an <code>@swagger</code> JSDoc block. It appears in{' '}
                <a href="/api-docs">/api-docs</a> automatically.
              </li>
              <li>Open a pull request describing the change and how you tested it.</li>
            </ol>
            <p>
              Pijin is released under the{' '}
              <a href="https://github.com/0xreru/Pijin/blob/main/LICENSE">MIT License</a> © 2026 The Pijin Team.
            </p>
          </Section>
        </article>
      </div>
    </DocsShell>
  );
}
