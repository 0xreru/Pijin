export const runtime = 'nodejs';

import jwt, { type JwtPayload } from 'jsonwebtoken';
import { type NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';

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
