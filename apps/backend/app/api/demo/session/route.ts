import { NextRequest, NextResponse } from 'next/server';
import {
  assertDemoAccessCode,
  assertDemoEnabled,
  assertDemoTestnet,
  DemoDisabledError,
  DemoUnauthorizedError,
} from '@/lib/demo/config';
import {
  claimDemoPair,
  DemoPoolExhaustedError,
  retireDemoPair,
} from '@/lib/demo/pool';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function noStore<T>(body: T, status = 200): NextResponse<T> {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store, private',
      Pragma: 'no-cache',
    },
  });
}

function authorize(request: NextRequest): void {
  assertDemoEnabled();
  assertDemoTestnet();
  assertDemoAccessCode(request.headers.get('x-demo-access-code'));
}

function errorResponse(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : 'Demo session request failed';
  if (error instanceof DemoDisabledError) return noStore({ error: message }, 404);
  if (error instanceof DemoUnauthorizedError) return noStore({ error: message }, 401);
  if (error instanceof DemoPoolExhaustedError) return noStore({ error: message }, 409);
  if (message.includes('clientSessionId')) return noStore({ error: message }, 400);

  console.error('[DemoSession]', message);
  return noStore({ error: 'Unable to allocate a demo session' }, 500);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    authorize(request);
    const body = await request.json();
    return noStore(await claimDemoPair(body?.clientSessionId));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  try {
    authorize(request);
    const body = await request.json();
    await retireDemoPair(body?.clientSessionId);
    return noStore({ success: true });
  } catch (error) {
    return errorResponse(error);
  }
}
