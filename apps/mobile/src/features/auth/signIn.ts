import {
  getMainWalletSecret,
  getPinLockoutRemainingMs,
  getUserPhone,
  getUserPin,
  recordPinFailure,
  resetPinAttempts,
  saveUserPin,
  setOnboardingComplete,
} from '../../services/storage/onboardingStorage';
import { checkUserExists, verifyPinWithServer } from '../../services/api/accounts';
import { ApiError } from '../../services/api/client';
import { getSep10Token, Keypair as StellarKeypair } from '../../services/stellar/anchorService';
import { loadStoredAccount } from '../../services/storage/accountStorage';
import { synchronizeOfflineDeviceKey } from '../../services/wallet/offlineKeySync';
import { synchronizeRecipientRegistry } from '../../services/wallet/recipientRegistrySync';

/**
 * Outcome of a PIN sign-in attempt. UI-free: the caller decides how to present
 * each case (shake, alert, navigate).
 */
export type SignInResult =
  | { status: 'success' }
  /** Local PIN lockout is active. */
  | { status: 'locked'; minutes: number }
  /** PIN mismatch. `lockoutMinutes` is set when this failure triggered a lockout. */
  | { status: 'wrong_pin'; lockoutMinutes?: number }
  /** Server rejected the PIN (401). Same UX as a local mismatch, no local failure count. */
  | { status: 'wrong_pin_server' }
  /** Server-side account lockout (423). */
  | { status: 'account_locked'; retryAfterMinutes: number }
  | { status: 'rate_limited' }
  | { status: 'not_registered' }
  | { status: 'no_phone' }
  /** No local PIN and the server could not be reached. */
  | { status: 'cannot_verify' }
  /** Stored wallet key is missing or does not match the account. */
  | { status: 'needs_restore'; phoneNumber: string }
  /** First sign-in on this device with no connection. */
  | { status: 'connection_required' }
  | { status: 'error' };

type LoginFn = (publicKey: string, shortId: string, jwt?: string) => Promise<void>;

const ceilMinutes = (ms: number) => Math.ceil(ms / 60000);

/**
 * Verifies the PIN (local SecureStore, falling back to the server) and signs in
 * online, or from the cached account when offline.
 */
export async function attemptSignIn(args: {
  pin: string;
  phoneNumber: string;
  login: LoginFn;
}): Promise<SignInResult> {
  const { pin, phoneNumber, login } = args;
  try {
    const lockedMs = await getPinLockoutRemainingMs();
    if (lockedMs > 0) return { status: 'locked', minutes: ceilMinutes(lockedMs) };

    // Tier 1: SecureStore is the only local PIN copy.
    let pinToCompare = await getUserPin();

    // Tier 2: server verification. The server never returns the PIN, it only
    // confirms a match and enforces lockout.
    if (!pinToCompare) {
      const phoneForQuery = phoneNumber || (await getUserPhone());
      if (!phoneForQuery) return { status: 'no_phone' };
      try {
        await verifyPinWithServer(phoneForQuery, pin);
        // Restore the local copy so future logins work offline.
        await saveUserPin(pin);
        pinToCompare = pin;
      } catch (err) {
        if (err instanceof ApiError) {
          if (err.status === 401) return { status: 'wrong_pin_server' };
          if (err.status === 423) {
            const retryAfter = Number((err.body as { retryAfter?: number } | null)?.retryAfter ?? 900);
            return { status: 'account_locked', retryAfterMinutes: Math.ceil(retryAfter / 60) };
          }
          if (err.status === 429) return { status: 'rate_limited' };
          if (err.status === 404) return { status: 'not_registered' };
        }
        console.warn('[SignIn] Could not verify PIN with backend:', err);
        return { status: 'cannot_verify' };
      }
    }

    if (pin !== pinToCompare) {
      const lockoutMs = await recordPinFailure();
      return { status: 'wrong_pin', lockoutMinutes: lockoutMs > 0 ? ceilMinutes(lockoutMs) : undefined };
    }
    await resetPinAttempts();

    // PIN is correct. Load the persisted main wallet for SEP-10 auth.
    const mainWalletSecret = await getMainWalletSecret();
    const mainWalletKeypair = mainWalletSecret ? StellarKeypair.fromSecret(mainWalletSecret) : null;
    const mainWalletPublicKey = mainWalletKeypair?.publicKey();

    try {
      const checkRes = await checkUserExists(phoneNumber);

      if (checkRes.exists && checkRes.stellarPublicKey && checkRes.shortId) {
        if (!mainWalletKeypair || mainWalletPublicKey !== checkRes.stellarPublicKey) {
          return { status: 'needs_restore', phoneNumber };
        }
        const token = await getSep10Token(mainWalletKeypair);
        await synchronizeRecipientRegistry(token);
        await synchronizeOfflineDeviceKey(mainWalletKeypair, token);
        await login(checkRes.stellarPublicKey, checkRes.shortId, token);
      } else {
        return { status: 'not_registered' };
      }
    } catch (networkError) {
      console.warn('[SignIn] Network error during online auth, attempting offline fallback:', networkError);

      // Offline fallback: cached account, only if it matches the stored wallet key.
      const stored = await loadStoredAccount();
      if (stored && mainWalletPublicKey && stored.stellarPublicKey === mainWalletPublicKey) {
        await login(stored.stellarPublicKey, stored.shortId);
      } else {
        return { status: 'connection_required' };
      }
    }

    await setOnboardingComplete(true);
    return { status: 'success' };
  } catch (e) {
    console.error('PIN verification failed:', e);
    return { status: 'error' };
  }
}
