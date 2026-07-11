import * as SecureStore from 'expo-secure-store';
import { Keypair } from '@stellar/stellar-base';
import { ensureMigration } from '../storage/migration';

const DEVICE_SECRET_KEY = 'pijn.device.secret';

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
