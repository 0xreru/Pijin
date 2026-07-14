import { createSwaggerSpec } from 'next-swagger-doc';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const spec = createSwaggerSpec({
    apiFolder: 'app/api',
    definition: {
      openapi: '3.0.0',
      info: {
        title: 'Pijin API',
        version: '1.0.0',
        description:
          'Backend API for the **Pijin** P2P offline payment system built on Stellar.\n\n' +
          '### Authentication\n' +
          'Most protected endpoints require a **SEP-10 JWT** obtained from `POST /api/auth`.\n' +
          'Pass it as `Authorization: Bearer <token>`.\n\n' +
          '### Offline Engine\n' +
          'The `/api/engine/settle` worker is triggered exclusively by **Upstash QStash** — ' +
          'never call it directly in production.',
        contact: {
          name: 'Pijin Engineering',
        },
      },
      servers: [
        {
          url: process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001',
          description: 'Current environment',
        },
        {
          url: 'https://pijin-api.vercel.app',
          description: 'Production (Vercel)',
        },
        {
          url: 'http://localhost:3001',
          description: 'Localhost',
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
          QStashSignature: {
            type: 'apiKey',
            in: 'header',
            name: 'upstash-signature',
            description:
              'HMAC-SHA256 signature injected by Upstash QStash. Verified server-side by `verifySignatureAppRouter`.',
          },
          TextbeeHmac: {
            type: 'apiKey',
            in: 'header',
            name: 'x-signature',
            description:
              'HMAC-SHA256 signature injected by the Textbee SMS gateway. Verified against `TEXTBEE_WEBHOOK_SECRET`.',
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
        },
      },
      tags: [
        { name: 'System', description: 'Health check and infrastructure endpoints.' },
        {
          name: 'Authentication (SEP-10)',
          description:
            'Two-legged Stellar Web Authentication challenge/response flow (SEP-10). Produces a JWT bearer token consumed by all protected endpoints.',
        },
        {
          name: 'Anchor (SEP-24)',
          description:
            'Interactive deposit & withdrawal flow as defined by SEP-24. Includes capability advertisement, transaction initiation, status polling, and the settlement simulation step.',
        },
        {
          name: 'Offline Engine',
          description:
            'QStash-triggered settlement worker. Verifies Ed25519 signatures, calls the Pijin Soroban contract, and dispatches SMS notifications.',
        },
        {
          name: 'Wallet & Balances',
          description: 'Stellar on-chain and Soroban vault balance queries, and unified transaction history.',
        },
        {
          name: 'OTP',
          description:
            'SMS one-time-password (OTP) send/verify endpoints backed by Upstash Redis TTL storage and Textbee SMS gateway.',
        },
        {
          name: 'Users & Accounts',
          description: 'Account registration, lookup, and existence checks.',
        },
        {
          name: 'SEP-1 (Stellar TOML)',
          description:
            'Public anchor identity file consumed by wallets, clients, and SEP-compliant services.',
        },
        {
          name: 'SMS Gateway',
          description:
            'Textbee inbound SMS webhook. Dual-layer HMAC + URL-secret auth shield; enqueues settlement jobs to Upstash QStash.',
        },
      ],
    },
  });

  return NextResponse.json(spec);
}
