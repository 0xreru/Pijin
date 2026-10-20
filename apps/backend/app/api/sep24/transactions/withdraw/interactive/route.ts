/**
 * @swagger
 * /api/sep24/transactions/withdraw/interactive:
 *   post:
 *     tags:
 *       - Anchor (SEP-24)
 *     summary: Initiate an interactive SEP-24 withdrawal
 *     description: |
 *       **Step 1 of the SEP-24 interactive withdrawal (cash-out) flow.**
 *
 *       1. Verifies the SEP-10 JWT and reads the user's Stellar account from `sub`.
 *       2. Creates an `AnchorTransaction` (`type: withdrawal`, `status: incomplete`).
 *       3. Mints a 15-minute interactive JWT (separate secret from SEP-10) bound to that transaction.
 *       4. Returns the `/withdraw` webview URL.
 *
 *       Inside the webview the user enters the amount and GCash number
 *       (`POST /api/anchor/submit-withdraw`), pays PHPC/USDC to the treasury with the
 *       returned memo, then the app confirms it (`POST /api/anchor/confirm-withdraw`).
 *
 *       Returns `503` when `RAMP_ENABLED` or `WITHDRAW_ENABLED` is `false`.
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [asset_code]
 *             properties:
 *               asset_code:
 *                 type: string
 *                 enum: [PHPC, USDC]
 *                 description: Case-insensitive; normalised to uppercase.
 *                 example: PHPC
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             required: [asset_code]
 *             properties:
 *               asset_code:
 *                 type: string
 *     responses:
 *       '200':
 *         description: Withdrawal initiated.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 type:
 *                   type: string
 *                   example: interactive_customer_info_needed
 *                 url:
 *                   type: string
 *                   format: uri
 *                   example: "https://pijin.live/withdraw?transaction_id=550e8400-e29b-41d4-a716-446655440000&token=eyJ..."
 *                 id:
 *                   type: string
 *                   format: uuid
 *       '400':
 *         description: Unparseable body or unsupported `asset_code`.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '401':
 *         description: Missing, malformed, or expired SEP-10 token.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '500':
 *         description: Missing env var or database failure.
 *       '503':
 *         description: Withdrawals are disabled by the ramp kill switch.
 */

export const runtime = 'nodejs';

import jwt, { type JwtPayload } from 'jsonwebtoken';
import { type NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { enforceRampKillSwitch } from '@/lib/ramp-config';

const SUPPORTED_ASSETS = new Set(['PHPC', 'USDC']);
const INTERACTIVE_TOKEN_TTL_SECONDS = 15 * 60;

interface WithdrawalRequestBody {
  asset_code?: unknown;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`[SEP-24 Withdrawal] Missing environment variable: ${name}`);
  }
  return value;
}

function verifySep10Token(request: NextRequest): JwtPayload & { sub: string } {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) {
    throw new Error('Missing bearer token');
  }

  const token = authorization.slice('Bearer '.length).trim();
  const payload = jwt.verify(token, requireEnv('SECRET_SEP10_JWT_SECRET'), {
    algorithms: ['HS256'],
  });

  if (typeof payload === 'string' || typeof payload.sub !== 'string' || !payload.sub.trim()) {
    throw new Error('SEP-10 token is missing a valid sub claim');
  }

  return payload as JwtPayload & { sub: string };
}

async function parseBody(request: NextRequest): Promise<WithdrawalRequestBody> {
  const contentType = request.headers.get('content-type') ?? '';
  if (
    contentType.includes('multipart/form-data') ||
    contentType.includes('application/x-www-form-urlencoded')
  ) {
    const formData = await request.formData();
    return { asset_code: formData.get('asset_code') };
  }
  return (await request.json()) as WithdrawalRequestBody;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const killSwitchResponse = enforceRampKillSwitch('withdraw');
  if (killSwitchResponse) {
    return killSwitchResponse;
  }

  let session: JwtPayload & { sub: string };
  try {
    session = verifySep10Token(request);
  } catch (error: unknown) {
    console.warn(
      '[SEP-24 Withdrawal] SEP-10 authentication failed:',
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      { error: 'unauthorized', message: 'A valid SEP-10 bearer token is required.' },
      { status: 401 },
    );
  }

  let body: WithdrawalRequestBody;
  try {
    body = await parseBody(request);
  } catch {
    return NextResponse.json(
      { error: 'invalid_request', message: 'The request body must be valid JSON or form data.' },
      { status: 400 },
    );
  }

  const assetCode = typeof body.asset_code === 'string' ? body.asset_code.trim().toUpperCase() : '';
  if (!SUPPORTED_ASSETS.has(assetCode)) {
    return NextResponse.json(
      { error: 'invalid_request', message: 'asset_code must be PHPC or USDC.' },
      { status: 400 },
    );
  }

  try {
    const anchorTx = await prisma.anchorTransaction.create({
      data: {
        stellarAccount: session.sub,
        type: 'withdrawal',
        status: 'incomplete',
        assetCode,
      },
    });

    const interactiveToken = jwt.sign(
      { sub: session.sub, transaction_id: anchorTx.id },
      requireEnv('SECRET_SEP24_INTERACTIVE_URL_JWT_SECRET'),
      { algorithm: 'HS256', expiresIn: INTERACTIVE_TOKEN_TTL_SECONDS },
    );

    const appUrl = requireEnv('NEXT_PUBLIC_APP_URL').replace(/\/$/, '');
    const url = new URL('/withdraw', `${appUrl}/`);
    url.searchParams.set('transaction_id', anchorTx.id);
    url.searchParams.set('token', interactiveToken);

    return NextResponse.json(
      {
        type: 'interactive_customer_info_needed',
        url: url.toString(),
        id: anchorTx.id,
      },
      { status: 200 },
    );
  } catch (error: unknown) {
    console.error('[SEP-24 Withdrawal] Failed to initiate withdrawal:', error);
    return NextResponse.json(
      { error: 'server_error', message: 'Unable to initiate the withdrawal.' },
      { status: 500 },
    );
  }
}
