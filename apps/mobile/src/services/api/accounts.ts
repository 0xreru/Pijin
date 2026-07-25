import { apiRequest } from './client';

export type RegisteredAccount = {
  id: number;
  shortId: string;
  role: string;
  stellarPublicKey: string;
  offlineDeviceKey: string | null;
  pin: string | null;
  phoneNumber: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  createdAt: string;
};

type RegisterResponse = {
  success: boolean;
  data: RegisteredAccount;
};

export async function registerAccount(input: {
  stellarPublicKey: string;
  offlineDeviceKey?: string;
  pin?: string;
  phoneNumber?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
}): Promise<RegisteredAccount> {
  const body: Record<string, string> = {
    role: 'USER', // Mobile always registers as USER role
    stellarPublicKey: input.stellarPublicKey,
  };
  
  if (input.offlineDeviceKey) {
    body.offlineDeviceKey = input.offlineDeviceKey;
  }
  if (input.pin) {
    body.pin = input.pin;
  }
  if (input.phoneNumber) {
    body.phoneNumber = input.phoneNumber;
  }
  if (input.firstName) {
    body.firstName = input.firstName;
  }
  if (input.lastName) {
    body.lastName = input.lastName;
  }
  if (input.email) {
    body.email = input.email;
  }

  const result = await apiRequest<RegisterResponse>('/api/register', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  return result.data;
}

type CheckUserResponse = {
  exists: boolean;
  stellarPublicKey?: string;
  shortId?: string;
  pin?: string | null;
};

/**
 * Checks whether a phone number is already registered.
 * @param phone - full E.164 string, e.g. "+639123456789" or "+12125551234"
 *   The backend strips all non-digits via /\D/g, so sending E.164 is safe.
 */
export async function checkUserExists(phone: string): Promise<CheckUserResponse> {
  // Pass the full E.164 number — the backend strips '+' via /\D/g automatically.
  return apiRequest<CheckUserResponse>(`/api/users/check?phone=${encodeURIComponent(phone)}`);
}

type LookupUserResponse = {
  found: boolean;
  shortId?: string;
  stellarPublicKey?: string;
  offlineDeviceKey?: string | null;
  displayName?: string;
  firstName?: string;
  lastName?: string;
};

/**
 * Looks up a user by their shortId.
 * @param shortId - The exact, case-sensitive 6-character Base62 short ID to resolve.
 */
export async function lookupUserByShortId(shortId: string): Promise<LookupUserResponse> {
  return apiRequest<LookupUserResponse>(`/api/users/lookup?shortId=${encodeURIComponent(shortId)}`);
}
