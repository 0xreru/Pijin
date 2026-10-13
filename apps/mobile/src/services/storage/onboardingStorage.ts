import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { ensureMigration } from './migration';

const ONBOARDING_COMPLETE_KEY = 'pijn.onboarding_complete';
const PIN_KEY = 'pijn.user_pin';
// PIN_KEY is the legacy plaintext AsyncStorage location; it is only read to migrate and delete it.
const PIN_SECURE_KEY = 'pijn.user_pin_secure';
const PHONE_NUMBER_KEY = 'pijn.user_phone';
const FIRST_NAME_KEY = 'pijn.user_first_name';
const LAST_NAME_KEY = 'pijn.user_last_name';
const EMAIL_KEY = 'pijn.user_email';
const MAIN_WALLET_SECRET_KEY = 'pijn.main_wallet.secret';
// Stores a JSON array of every phone that has completed registration on this device.
// Used by the local mock for checkUserExists until a real backend endpoint exists.
const REGISTERED_PHONES_KEY = 'pijn.registered_phones';

export async function setOnboardingComplete(complete: boolean): Promise<void> {
  await ensureMigration();
  await AsyncStorage.setItem(ONBOARDING_COMPLETE_KEY, complete ? 'true' : 'false');
}

export async function isOnboardingComplete(): Promise<boolean> {
  await ensureMigration();
  const value = await AsyncStorage.getItem(ONBOARDING_COMPLETE_KEY);
  return value === 'true';
}

/**
 * Persists the PIN in SecureStore (Keystore/Keychain) — the only local PIN store.
 * Also drops the legacy plaintext AsyncStorage copy older builds wrote.
 */
export async function saveUserPin(pin: string): Promise<void> {
  await ensureMigration();
  await SecureStore.setItemAsync(PIN_SECURE_KEY, pin);
  await AsyncStorage.removeItem(PIN_KEY);
}

/**
 * Reads the PIN from SecureStore. A PIN left in AsyncStorage by an older build is
 * moved into SecureStore on first read and the plaintext copy deleted.
 */
export async function getUserPin(): Promise<string | null> {
  await ensureMigration();
  try {
    const secure = await SecureStore.getItemAsync(PIN_SECURE_KEY);
    if (secure) {
      // Cheap no-op once migrated; covers a crash between the two writes.
      await AsyncStorage.removeItem(PIN_KEY);
      return secure;
    }
  } catch {
    // Fall through to the legacy copy.
  }
  const legacy = await AsyncStorage.getItem(PIN_KEY);
  if (!legacy) return null;
  try {
    await SecureStore.setItemAsync(PIN_SECURE_KEY, legacy);
    await AsyncStorage.removeItem(PIN_KEY);
  } catch {
    // Keep the legacy copy so the user isn't locked out; retry next read.
  }
  return legacy;
}

/** Removes the PIN from every local store (call on account wipe / logout). */
export async function clearUserPin(): Promise<void> {
  try {
    await ensureMigration();
    await SecureStore.deleteItemAsync(PIN_SECURE_KEY);
  } catch {
    // Ignore — key may not exist
  }
  await AsyncStorage.removeItem(PIN_KEY);
}

// ---------------------------------------------------------------------------
// Local PIN attempt lockout (mirrors the server: 5 wrong tries → 15 min).
// The counter holds no secret, so AsyncStorage is fine.
// ---------------------------------------------------------------------------

const PIN_ATTEMPTS_KEY = 'pijn.pin_attempts';
export const PIN_MAX_ATTEMPTS = 5;
export const PIN_LOCKOUT_MS = 15 * 60 * 1000;

interface PinAttemptState {
  failures: number;
  lockedUntil: number;
}

async function readPinAttempts(): Promise<PinAttemptState> {
  try {
    const raw = await AsyncStorage.getItem(PIN_ATTEMPTS_KEY);
    if (!raw) return { failures: 0, lockedUntil: 0 };
    const parsed = JSON.parse(raw) as Partial<PinAttemptState>;
    return {
      failures: Number(parsed.failures) || 0,
      lockedUntil: Number(parsed.lockedUntil) || 0,
    };
  } catch {
    return { failures: 0, lockedUntil: 0 };
  }
}

/** Milliseconds left on the local lockout, or 0 when entry is allowed. */
export async function getPinLockoutRemainingMs(): Promise<number> {
  const { lockedUntil } = await readPinAttempts();
  return Math.max(0, lockedUntil - Date.now());
}

/** Records a wrong PIN. Returns the lockout length in ms if this attempt tripped it, else 0. */
export async function recordPinFailure(): Promise<number> {
  const state = await readPinAttempts();
  // A lapsed lockout starts a fresh window.
  const failures = state.lockedUntil && state.lockedUntil <= Date.now() ? 1 : state.failures + 1;
  const locked = failures >= PIN_MAX_ATTEMPTS;
  const next: PinAttemptState = {
    failures: locked ? 0 : failures,
    lockedUntil: locked ? Date.now() + PIN_LOCKOUT_MS : 0,
  };
  await AsyncStorage.setItem(PIN_ATTEMPTS_KEY, JSON.stringify(next));
  return locked ? PIN_LOCKOUT_MS : 0;
}

export async function resetPinAttempts(): Promise<void> {
  await AsyncStorage.removeItem(PIN_ATTEMPTS_KEY);
}

export async function saveMainWalletSecret(secret: string): Promise<void> {
  await ensureMigration();
  await SecureStore.setItemAsync(MAIN_WALLET_SECRET_KEY, secret);
}

export async function getMainWalletSecret(): Promise<string | null> {
  try {
    await ensureMigration();
    return await SecureStore.getItemAsync(MAIN_WALLET_SECRET_KEY);
  } catch {
    return null;
  }
}

export async function clearMainWalletSecret(): Promise<void> {
  try {
    await ensureMigration();
    await SecureStore.deleteItemAsync(MAIN_WALLET_SECRET_KEY);
  } catch {
    // Ignore - key may not exist
  }
}

export async function saveUserPhone(phone: string): Promise<void> {
  await ensureMigration();
  await AsyncStorage.setItem(PHONE_NUMBER_KEY, phone);
}

export async function getUserPhone(): Promise<string | null> {
  await ensureMigration();
  return await AsyncStorage.getItem(PHONE_NUMBER_KEY);
}

export async function saveUserFirstName(name: string): Promise<void> {
  await ensureMigration();
  await AsyncStorage.setItem(FIRST_NAME_KEY, name);
}

export async function getUserFirstName(): Promise<string | null> {
  await ensureMigration();
  return await AsyncStorage.getItem(FIRST_NAME_KEY);
}

export async function saveUserLastName(name: string): Promise<void> {
  await ensureMigration();
  await AsyncStorage.setItem(LAST_NAME_KEY, name);
}

export async function getUserLastName(): Promise<string | null> {
  await ensureMigration();
  return await AsyncStorage.getItem(LAST_NAME_KEY);
}

export async function saveUserEmail(email: string): Promise<void> {
  await ensureMigration();
  await AsyncStorage.setItem(EMAIL_KEY, email);
}

export async function getUserEmail(): Promise<string | null> {
  await ensureMigration();
  return await AsyncStorage.getItem(EMAIL_KEY);
}

export async function clearOnboardingData(): Promise<void> {
  await ensureMigration();
  await clearUserPin();
  await AsyncStorage.multiRemove([
    ONBOARDING_COMPLETE_KEY,
    PIN_ATTEMPTS_KEY,
    PHONE_NUMBER_KEY,
    FIRST_NAME_KEY,
    LAST_NAME_KEY,
    EMAIL_KEY,
    REGISTERED_PHONES_KEY,
  ]);
}

// ---------------------------------------------------------------------------
// Local phone registry — tracks which numbers have completed onboarding on
// this device. Powers the local-only mock of checkUserExists.
// ---------------------------------------------------------------------------

export async function getRegisteredPhones(): Promise<string[]> {
  try {
    await ensureMigration();
    const raw = await AsyncStorage.getItem(REGISTERED_PHONES_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

/**
 * Records a phone number as having completed registration.
 * Safe to call multiple times — deduplicates automatically.
 */
export async function saveRegisteredPhone(phone: string): Promise<void> {
  await ensureMigration();
  const phones = await getRegisteredPhones();
  if (!phones.includes(phone)) {
    await AsyncStorage.setItem(REGISTERED_PHONES_KEY, JSON.stringify([...phones, phone]));
  }
}

/** Returns true if this phone has previously completed registration on this device. */
export async function isPhoneRegistered(phone: string): Promise<boolean> {
  await ensureMigration();
  const phones = await getRegisteredPhones();
  return phones.includes(phone);
}
