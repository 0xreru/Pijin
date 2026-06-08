import AsyncStorage from '@react-native-async-storage/async-storage';

const ONBOARDING_COMPLETE_KEY = 'abotpera.onboarding_complete';
const PIN_KEY = 'abotpera.user_pin';

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

export async function clearOnboardingData(): Promise<void> {
  await AsyncStorage.removeItem(ONBOARDING_COMPLETE_KEY);
  await AsyncStorage.removeItem(PIN_KEY);
}
