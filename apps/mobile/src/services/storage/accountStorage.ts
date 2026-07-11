import AsyncStorage from '@react-native-async-storage/async-storage';
import { ensureMigration } from './migration';

const STORAGE_KEY = 'pijn.account';

export type StoredAccount = {
  shortId: string;
  role: string;
  stellarPublicKey: string;
};

export async function saveStoredAccount(account: StoredAccount): Promise<void> {
  await ensureMigration();
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(account));
}

export async function loadStoredAccount(): Promise<StoredAccount | null> {
  await ensureMigration();
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
  await ensureMigration();
  await AsyncStorage.removeItem(STORAGE_KEY);
}
