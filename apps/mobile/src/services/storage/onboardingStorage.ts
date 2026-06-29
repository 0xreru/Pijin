import AsyncStorage from '@react-native-async-storage/async-storage';

const ONBOARDING_COMPLETE_KEY = 'abotpera.onboarding_complete';
const PIN_KEY = 'abotpera.user_pin';
const PHONE_NUMBER_KEY = 'abotpera.user_phone';
const FIRST_NAME_KEY = 'abotpera.user_first_name';
const LAST_NAME_KEY = 'abotpera.user_last_name';
const EMAIL_KEY = 'abotpera.user_email';
// Stores a JSON array of every phone that has completed registration on this device.
// Used by the local mock for checkUserExists until a real backend endpoint exists.
const REGISTERED_PHONES_KEY = 'abotpera.registered_phones';

export async function setOnboardingComplete(complete: boolean): Promise<void> {
  await AsyncStorage.setItem(ONBOARDING_COMPLETE_KEY, complete ? 'true' : 'false');
}

export async function isOnboardingComplete(): Promise<boolean> {
  const value = await AsyncStorage.getItem(ONBOARDING_COMPLETE_KEY);
  return value === 'true';
}

export async function saveUserPin(pin: string): Promise<void> {
  await AsyncStorage.setItem(PIN_KEY, pin);
}

export async function getUserPin(): Promise<string | null> {
  return await AsyncStorage.getItem(PIN_KEY);
}

export async function saveUserPhone(phone: string): Promise<void> {
  await AsyncStorage.setItem(PHONE_NUMBER_KEY, phone);
}

export async function getUserPhone(): Promise<string | null> {
  return await AsyncStorage.getItem(PHONE_NUMBER_KEY);
}

export async function saveUserFirstName(name: string): Promise<void> {
  await AsyncStorage.setItem(FIRST_NAME_KEY, name);
}

export async function getUserFirstName(): Promise<string | null> {
  return await AsyncStorage.getItem(FIRST_NAME_KEY);
}

export async function saveUserLastName(name: string): Promise<void> {
  await AsyncStorage.setItem(LAST_NAME_KEY, name);
}

export async function getUserLastName(): Promise<string | null> {
  return await AsyncStorage.getItem(LAST_NAME_KEY);
}

export async function saveUserEmail(email: string): Promise<void> {
  await AsyncStorage.setItem(EMAIL_KEY, email);
}

export async function getUserEmail(): Promise<string | null> {
  return await AsyncStorage.getItem(EMAIL_KEY);
}

export async function clearOnboardingData(): Promise<void> {
  await AsyncStorage.multiRemove([
    ONBOARDING_COMPLETE_KEY,
    PIN_KEY,
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
  const phones = await getRegisteredPhones();
  if (!phones.includes(phone)) {
    await AsyncStorage.setItem(REGISTERED_PHONES_KEY, JSON.stringify([...phones, phone]));
  }
}

/** Returns true if this phone has previously completed registration on this device. */
export async function isPhoneRegistered(phone: string): Promise<boolean> {
  const phones = await getRegisteredPhones();
  return phones.includes(phone);
}
