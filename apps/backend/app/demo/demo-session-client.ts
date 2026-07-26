import type { DemoSettlementStatus } from '@/lib/demo/settlement-status';

export const DEMO_SESSION_STORAGE_KEY = 'pijin.demo.session.v1';
export const DEMO_ACCESS_STORAGE_KEY = 'pijin.demo.access.v1';

export type DemoSessionAccount = {
  publicKey: string;
  shortId: string;
  walletSecret: string;
  deviceSecret: string;
  devicePublicKey: string;
};

export type DemoSessionPayload = {
  sessionId: string;
  pairId: string;
  expiresAt: string;
  sender: DemoSessionAccount;
  receiver: DemoSessionAccount;
};

export function demoAccessCode(searchParams?: URLSearchParams): string {
  const fromUrl = searchParams?.get('access')?.trim();
  if (fromUrl) {
    sessionStorage.setItem(DEMO_ACCESS_STORAGE_KEY, fromUrl);
    return fromUrl;
  }
  return sessionStorage.getItem(DEMO_ACCESS_STORAGE_KEY) ?? '';
}

export async function claimDemoSession(
  sessionId: string,
  accessCode: string,
): Promise<DemoSessionPayload> {
  const response = await fetch('/api/demo/session', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessCode ? { 'x-demo-access-code': accessCode } : {}),
    },
    cache: 'no-store',
    body: JSON.stringify({ clientSessionId: sessionId }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.error ?? `Demo session allocation failed (${response.status})`);
  }
  return body as DemoSessionPayload;
}

export async function retireDemoSession(
  sessionId: string,
  accessCode: string,
): Promise<void> {
  const response = await fetch('/api/demo/session', {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      ...(accessCode ? { 'x-demo-access-code': accessCode } : {}),
    },
    cache: 'no-store',
    body: JSON.stringify({ clientSessionId: sessionId }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body?.error ?? `Demo session retirement failed (${response.status})`);
  }
}

export async function getDemoSettlementStatus(
  nonce: string,
  senderShortId: string,
  accessCode: string,
): Promise<DemoSettlementStatus> {
  const searchParams = new URLSearchParams({ nonce, senderShortId });
  const response = await fetch(`/api/demo/settlement?${searchParams}`, {
    headers: accessCode ? { 'x-demo-access-code': accessCode } : {},
    cache: 'no-store',
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      body?.error ?? `Settlement status request failed (${response.status})`,
    );
  }
  return body as DemoSettlementStatus;
}
