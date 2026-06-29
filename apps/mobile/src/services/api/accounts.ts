import { apiRequest } from './client';
import { isPhoneRegistered } from '../storage/onboardingStorage';

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

type CheckUserResponse = { exists: boolean };

/**
 * Checks whether a phone number is already registered.
 * @param phone - 10-digit local number (no country code), e.g. "9123456789"
 *
 * TODO: Replace body with real call once backend endpoint is ready:
 *   return apiRequest<CheckUserResponse>(`/api/users/check?phone=63${phone}`);
 */
export async function checkUserExists(phone: string): Promise<CheckUserResponse> {
  // Local mock — checks the on-device registry populated by saveRegisteredPhone().
  const exists = await isPhoneRegistered(phone);
  return { exists };
}
