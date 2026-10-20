import { createSwaggerSpec } from 'next-swagger-doc';
import { NextResponse } from 'next/server';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const dynamic = 'force-dynamic';

/**
 * @swagger
 * /api/swagger:
 *   get:
 *     tags:
 *       - System
 *     summary: OpenAPI 3.0 specification
 *     description: |
 *       Returns this OpenAPI document as JSON. It is generated at request time from
 *       the `@swagger` JSDoc blocks in `app/api/**` and `app/.well-known/**`, and is
 *       what the interactive reference at `/api-docs` renders.
 *     responses:
 *       '200':
 *         description: OpenAPI 3.0 document.
 */
export async function GET() {
  // next-swagger-doc resolves apiFolder from process.cwd(). In this monorepo,
  // cwd is the repository root locally but the backend root on Vercel.
  const appRoot = existsSync(join(process.cwd(), 'app', 'api')) ? 'app' : 'apps/backend/app';

  const spec = createSwaggerSpec({
    apiFolder: `${appRoot}/api`,
    schemaFolders: [`${appRoot}/.well-known`],
    definition: {
      openapi: '3.0.0',
      info: {
        title: 'Pijin API',
        version: '1.0.0',
        description:
          'Backend API for **Pijin**, the data-free P2P payment system built on Stellar and Soroban.\n\n' +
          '### Authentication\n' +
          'Pijin uses a different credential per trust boundary:\n\n' +
          '| Scheme | Header | Used by |\n' +
          '|---|---|---|\n' +
          '| **SEP-10 JWT** | `Authorization: Bearer <jwt>` | SEP-24 ramps, offline-key enrollment, ShortID registry. Obtain from `GET` + `POST /api/auth`. |\n' +
          '| **Wallet signature** | `Authorization: Bearer <base64 Ed25519 sig>` | `/api/engine/deposit`, `/withdraw`, `/transfer`. Signs a canonical message with the wallet key. |\n' +
          '| **SEP-24 interactive token** | `Authorization: Bearer <jwt>` | Webview-only anchor steps (`/api/anchor/*`). Minted per transaction, valid 15 minutes. |\n' +
          '| **Textbee HMAC** | `x-signature` | Inbound SMS webhook. |\n' +
          '| **QStash signature** | `upstash-signature` | Internal workers (`/api/engine/settle`, `/api/sms/dispatch`). |\n' +
          '| **Demo access code** | `x-demo-access-code` | Browser simulator endpoints (testnet only). |\n\n' +
          '### Offline settlement\n' +
          'Offline vouchers travel as SMS to the Textbee gateway → `POST /api/sms/webhook` → Upstash QStash → ' +
          '`POST /api/engine/settle` → Soroban `spend_offline`. Never call the worker directly.\n\n' +
          '### Amounts\n' +
          'All `*Stroops` fields are integer strings in stroops (1 token = 10,000,000 stroops).\n\n' +
          'Setup and integration guide: [/docs](/docs)',
        contact: {
          name: 'The Pijin Team',
          url: 'https://github.com/0xreru/Pijin',
        },
        license: {
          name: 'MIT',
          url: 'https://github.com/0xreru/Pijin/blob/main/LICENSE',
        },
      },
      servers: [
        {
          url: '/',
          description: 'Current deployment (recommended)',
        },
        {
          url: 'https://pijin.live',
          description: 'Production (Stellar Testnet)',
        },
        {
          url: 'http://localhost:3000',
          description: 'Local development',
        },
      ],
      components: {
        securitySchemes: {
          BearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'SEP-10 JWT minted by `POST /api/auth`.',
          },
          WalletSignature: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'Base64 Ed25519 signature',
            description:
              'Base64-encoded 64-byte Ed25519 signature, made with the user\'s **wallet** secret key, over the ' +
              'endpoint\'s canonical UTF-8 message (documented on each operation).',
          },
          InteractiveToken: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description:
              'Short-lived (15 min) SEP-24 interactive JWT carried in the webview URL `token` query parameter. ' +
              'Signed with `SECRET_SEP24_INTERACTIVE_URL_JWT_SECRET` and bound to one `transaction_id`.',
          },
          QStashSignature: {
            type: 'apiKey',
            in: 'header',
            name: 'upstash-signature',
            description:
              'Signature injected by Upstash QStash. Verified server-side against `QSTASH_CURRENT_SIGNING_KEY` / `QSTASH_NEXT_SIGNING_KEY`.',
          },
          TextbeeHmac: {
            type: 'apiKey',
            in: 'header',
            name: 'x-signature',
            description:
              'HMAC-SHA256 of the raw body, injected by the Textbee SMS gateway. Verified against `TEXTBEE_WEBHOOK_SECRET`. `x-textbee-signature` is also accepted.',
          },
          DemoAccessCode: {
            type: 'apiKey',
            in: 'header',
            name: 'x-demo-access-code',
            description: 'Shared access code (`DEMO_ACCESS_CODE`) for the browser simulator. Testnet only.',
          },
        },
        schemas: {
          ErrorResponse: {
            type: 'object',
            properties: {
              error: { type: 'string', example: 'Bad Request' },
              message: { type: 'string', example: 'Descriptive error detail.' },
            },
          },
          SimpleError: {
            type: 'object',
            properties: {
              error: { type: 'string', example: 'Unauthorized' },
            },
          },
          RampError: {
            type: 'object',
            properties: {
              success: { type: 'boolean', example: false },
              error: { type: 'string' },
            },
          },
          OfflineConfig: {
            type: 'object',
            description: 'Everything the phone needs to sign offline vouchers for this deployment.',
            properties: {
              version: { type: 'integer', example: 1 },
              contractId: { type: 'string', example: 'CBYRV2FDGXHMKQILP3EWYI4ILKKQ2HW4NW4NJCFYQY6NEE7463ARLNUD' },
              gatewayPublicKey: { type: 'string', description: 'Relayer / gateway G-address bound into every voucher signature.' },
              tokenContractId: { type: 'string', example: 'CADDQRI74FSCGNWMK4CLNDUSBDWJHMF2GHZQQVYQ4UIO7KZ7V6UK6C24' },
              tokenDbId: { type: 'string', description: 'Numeric `Token.id`; first field of the SMS payload.', example: '1' },
              tokenSymbol: { type: 'string', example: 'PHPC' },
              networkPassphrase: { type: 'string', example: 'Test SDF Network ; September 2015' },
            },
          },
          DemoAccount: {
            type: 'object',
            properties: {
              publicKey: { type: 'string' },
              shortId: { type: 'string', example: 'aB3x9Q' },
              walletSecret: { type: 'string', description: 'Testnet-only wallet secret for the leased simulator account.' },
              deviceSecret: { type: 'string', description: 'Testnet-only offline device secret.' },
              devicePublicKey: { type: 'string' },
            },
          },
        },
      },
      tags: [
        { name: 'System', description: 'Health check and specification endpoints.' },
        {
          name: 'SEP-1 (Stellar TOML)',
          description: 'Public anchor identity file consumed by wallets, clients, and SEP-compliant services.',
        },
        {
          name: 'Authentication (SEP-10)',
          description:
            'Two-legged Stellar Web Authentication challenge/response flow (SEP-10). Produces the JWT bearer token used by protected endpoints.',
        },
        {
          name: 'Users & Accounts',
          description: 'Account registration, lookup, existence checks, and PIN verification.',
        },
        {
          name: 'OTP',
          description:
            'SMS one-time-password send/verify, backed by Upstash Redis TTL storage and the Textbee SMS gateway.',
        },
        {
          name: 'Anchor (SEP-24)',
          description:
            'Interactive deposit and withdrawal (GCash ↔ PHPC/USDC) as defined by SEP-24: capability advertisement, initiation, status polling, and the webview settlement steps.',
        },
        {
          name: 'Offline Engine',
          description:
            'Vault deposit/withdraw/transfer assembly, offline-key enrollment, the on-chain ShortID registry, and the QStash settlement worker that calls Soroban `spend_offline`.',
        },
        {
          name: 'Wallet & Balances',
          description: 'Horizon and Soroban vault balances, transaction history, and online transfer confirmation.',
        },
        {
          name: 'SMS Gateway',
          description:
            'Textbee inbound webhook (HMAC-authenticated, enqueues settlement jobs to QStash) and the QStash worker that delivers outbound receipts.',
        },
        {
          name: 'Demo & Testnet',
          description:
            '**Testnet only.** Browser simulator session leasing, settlement polling, and a rate-limited XLM funding helper. Disabled unless `DEMO_ENABLED=true` and the network is Testnet.',
        },
      ],
    },
  });

  return NextResponse.json(spec);
}
