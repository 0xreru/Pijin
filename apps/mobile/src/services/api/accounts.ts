import { apiRequest } from './client';

export type AccountRole = 'CUSTOMER' | 'MERCHANT';

export type RegisteredAccount = {
  id: number;
  shortId: string;
  role: AccountRole;
  stellarPublicKey: string;
  merchantPin: string | null;
  createdAt: string;
};

type RegisterResponse = {
  success: boolean;
  data: RegisteredAccount;
};

export async function registerAccount(input: {
  role: AccountRole;
  stellarPublicKey: string;
  offlineDeviceKey?: string;
  merchantPin?: string;
  merchantPhone?: string;
}): Promise<RegisteredAccount> {
  const role = input.role;
  const body: Record<string, string> = {
    role,
    stellarPublicKey: input.stellarPublicKey,
  };
  if (input.offlineDeviceKey) {
    body.offlineDeviceKey = input.offlineDeviceKey;
  }
  if (role === 'MERCHANT' && input.merchantPin) {
    body.merchantPin = input.merchantPin;
  }
  if (role === 'MERCHANT' && input.merchantPhone) {
    body.merchantPhone = input.merchantPhone;
  }

  const result = await apiRequest<RegisterResponse>('/api/register', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  return result.data;
}
