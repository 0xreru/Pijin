import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AccountRole } from '../api/accounts';

const STORAGE_KEY = 'abotpera.account';

export type StoredAccount = {
  shortId: string;
  role: AccountRole;
  stellarPublicKey: string;
  merchantPin?: string | null;
};

export async function saveStoredAccount(account: StoredAccount): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(account));
}

export async function loadStoredAccount(): Promise<StoredAccount | null> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as StoredAccount;
  } catch {
    return null;
  }
}

export async function clearStoredAccount(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}
