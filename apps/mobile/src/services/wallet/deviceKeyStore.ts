import * as SecureStore from 'expo-secure-store';
import { Keypair } from '@stellar/stellar-base';
import { ensureMigration } from '../storage/migration';

const DEVICE_SECRET_KEY = 'pijn.device.secret';
const ENROLLED_DEVICE_PUBLIC_KEY = 'pijn.device.enrolled_public_key';

/** Returns the existing device key without creating a replacement. */
export async function getExistingDeviceKeypair(): Promise<Keypair | null> {
  try {
    await ensureMigration();
    const secret = await SecureStore.getItemAsync(DEVICE_SECRET_KEY);
    return secret ? Keypair.fromSecret(secret) : null;
  } catch (error) {
    console.error('[DeviceKeyStore] SecureStore error:', error);
    throw new Error('Failed to load the offline device key.');
  }
}

export async function getOrGenerateDeviceKeypair(): Promise<Keypair> {
  try {
    await ensureMigration();
    const secret = await SecureStore.getItemAsync(DEVICE_SECRET_KEY);

    if (secret) {
      return Keypair.fromSecret(secret);
    }

    const newKeypair = Keypair.random();
    await SecureStore.setItemAsync(DEVICE_SECRET_KEY, newKeypair.secret());
    console.log('[DeviceKeyStore] Generated fresh Device Keypair for offline signing.');

    return newKeypair;
  } catch (error) {
    console.error('[DeviceKeyStore] SecureStore error:', error);
    throw new Error('Failed to load or generate the offline device key.');
  }
}

/** Records that this exact public key was confirmed on-chain and in the DB. */
export async function markDeviceKeyEnrolled(publicKey: string): Promise<void> {
  await ensureMigration();
  await SecureStore.setItemAsync(ENROLLED_DEVICE_PUBLIC_KEY, publicKey);
}

export async function clearDeviceKeyEnrollment(): Promise<void> {
  await ensureMigration();
  await SecureStore.deleteItemAsync(ENROLLED_DEVICE_PUBLIC_KEY);
}

/**
 * Loads the device key only when it has completed authenticated enrollment.
 * Offline payment creation must never silently replace a missing key.
 */
export async function getEnrolledDeviceKeypair(): Promise<Keypair> {
  const keypair = await getExistingDeviceKeypair();
  if (!keypair) {
    throw new Error(
      'Offline device key is missing. Connect to the internet and sign in to enroll this device again.'
    );
  }

  const enrolledPublicKey = await SecureStore.getItemAsync(ENROLLED_DEVICE_PUBLIC_KEY);
  if (enrolledPublicKey !== keypair.publicKey()) {
    throw new Error(
      'Offline device key is not synchronized. Connect to the internet and sign in before sending offline payments.'
    );
  }

  return keypair;
}
