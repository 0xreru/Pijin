import * as SecureStore from 'expo-secure-store';
import { deriveKeysFromMnemonic } from '../../services/wallet/mnemonic';
import { checkUserExists } from '../../services/api/accounts';
import { getSep10Token } from '../../services/stellar/anchorService';
import { ensureTrustline } from '../../services/stellar/trustlineService';
import { saveMainWalletSecret, setOnboardingComplete } from '../../services/storage/onboardingStorage';
import { ensureMigration } from '../../services/storage/migration';
import { synchronizeRecipientRegistry } from '../../services/wallet/recipientRegistrySync';
import { synchronizeOfflineDeviceKey } from '../../services/wallet/offlineKeySync';

export const MNEMONIC_WORD_COUNT = 12;

export type RestoreResult =
  | { status: 'success' }
  | { status: 'invalid_phrase' }
  | { status: 'error'; message: string };

type LoginFn = (publicKey: string, shortId: string, jwt?: string) => Promise<void>;

export function normalizeMnemonic(phrase: string): string {
  return phrase.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Restores a wallet from its 12-word phrase: derives keys, checks they match the
 * account registered for `phoneNumber`, stores them, and signs in.
 */
export async function restoreWalletFromPhrase(args: {
  phrase: string;
  phoneNumber: string | undefined;
  login: LoginFn;
}): Promise<RestoreResult> {
  const cleanPhrase = normalizeMnemonic(args.phrase);
  if (cleanPhrase.split(' ').length !== MNEMONIC_WORD_COUNT) return { status: 'invalid_phrase' };

  try {
    const { mainWalletKeypair, deviceKeypair } = deriveKeysFromMnemonic(cleanPhrase);
    const derivedPublicKey = mainWalletKeypair.publicKey();

    if (!args.phoneNumber) throw new Error('Phone number is missing from route params.');
    const checkRes = await checkUserExists(args.phoneNumber);

    if (!checkRes.exists || !checkRes.stellarPublicKey || !checkRes.shortId) {
      throw new Error('Account not found on the network.');
    }
    if (derivedPublicKey !== checkRes.stellarPublicKey) {
      throw new Error('The seed phrase provided does not match this account. Please check your spelling and order.');
    }

    await saveMainWalletSecret(mainWalletKeypair.secret());
    await ensureMigration();
    await SecureStore.setItemAsync('pijn.device.secret', deviceKeypair.secret());

    try {
      await ensureTrustline(checkRes.stellarPublicKey, mainWalletKeypair, 'PHPC');
    } catch (err) {
      console.warn('[RestoreWallet] Could not ensure PHPC trustline during restore:', err);
    }

    const token = await getSep10Token(mainWalletKeypair);
    await synchronizeRecipientRegistry(token);
    await synchronizeOfflineDeviceKey(mainWalletKeypair, token);
    await args.login(checkRes.stellarPublicKey, checkRes.shortId, token);
    await setOnboardingComplete(true);

    return { status: 'success' };
  } catch (e: any) {
    console.error('[RestoreWallet] Error:', e);
    return { status: 'error', message: e?.message || 'Failed to restore wallet. Please try again.' };
  }
}
