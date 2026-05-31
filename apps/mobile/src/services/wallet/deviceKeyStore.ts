import * as SecureStore from 'expo-secure-store';
import { Keypair } from '@stellar/stellar-base';

const DEVICE_SECRET_KEY = 'abotpera.device.secret';

export async function getOrGenerateDeviceKeypair(): Promise<Keypair> {
  try {
    // Check if this phone already has an offline key
    let secret = await SecureStore.getItemAsync(DEVICE_SECRET_KEY);
    
    // If not, dynamically generate a fresh Web3 Session Key and lock it in the enclave
    if (!secret) {
      const newKeypair = Keypair.random();
      secret = newKeypair.secret();
      await SecureStore.setItemAsync(DEVICE_SECRET_KEY, secret);
      console.log("Generated fresh Device Keypair for offline signing.");
    }

    return Keypair.fromSecret(secret);
  } catch (error) {
    console.error("SecureStore Error:", error);
    throw new Error("Failed to load or generate the offline device key.");
  }
}