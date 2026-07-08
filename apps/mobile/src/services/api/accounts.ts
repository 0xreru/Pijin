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
 * @param phone - local number (no country code), e.g. "9123456789"
 */
export async function checkUserExists(phone: string): Promise<CheckUserResponse> {
  const cleanLocal = phone.replace(/\D/g, "");
  return apiRequest<CheckUserResponse>(`/api/users/check?phone=63${cleanLocal}`);
}
