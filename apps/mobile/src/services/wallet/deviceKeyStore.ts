import * as SecureStore from 'expo-secure-store';
import { Keypair } from '@stellar/stellar-base';

const DEVICE_SECRET_KEY = 'pijin.device.secret';
const FRIENDBOT_URL = 'https://friendbot.stellar.org';
const RETRY_DELAY_MS = 2_000;

/**
 * Funds a new Testnet account via Friendbot with automatic retry logic.
 *
 * Retries on:
 *  - Network-level failures (e.g. "Network request failed" on flaky mobile/emulator bridges)
 *  - HTTP 5xx server-side errors from the Friendbot service
 *
 * A failure after all retries is logged but NEVER throws — the keypair is
 * already persisted, so the user can be funded later without losing their key.
 */
async function fundWithFriendbot(publicKey: string, retries = 3): Promise<void> {
  const url = `${FRIENDBOT_URL}?addr=${encodeURIComponent(publicKey)}`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`[Friendbot] Attempt ${attempt}/${retries} — funding ${publicKey}`);
      const response = await fetch(url);

      if (response.ok) {
        console.log(`[Friendbot] Success on attempt ${attempt}. Wallet funded with Testnet XLM.`);
        return;
      }

      // Retry on 5xx (server-side transient errors); bail immediately on 4xx.
      if (response.status >= 500) {
        console.warn(`[Friendbot] HTTP ${response.status} on attempt ${attempt}. Will retry…`);
      } else {
        // 4xx means the account already exists or the request is malformed — no point retrying.
        const body = await response.text().catch(() => '');
        console.warn(`[Friendbot] HTTP ${response.status} — not retrying. Body: ${body}`);
        return;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[Friendbot] Network error on attempt ${attempt}: ${message}`);
    }

    // Wait before the next attempt (skip delay after the final attempt).
    if (attempt < retries) {
      await new Promise<void>((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }

  // All retries exhausted — log cleanly without crashing the app.
  console.error(
    `[Friendbot] All ${retries} attempts failed for ${publicKey}. ` +
    'The keypair is saved — funding can be retried later.',
  );
}

export async function getOrGenerateDeviceKeypair(): Promise<Keypair> {
  try {
    // Check if this phone already has an offline key stored in the secure enclave.
    const secret = await SecureStore.getItemAsync(DEVICE_SECRET_KEY);

    if (secret) {
      return Keypair.fromSecret(secret);
    }

    // No key found — generate a brand-new Web3 Session Key and persist it first,
    // so even if Friendbot fails the key is never lost.
    const newKeypair = Keypair.random();
    await SecureStore.setItemAsync(DEVICE_SECRET_KEY, newKeypair.secret());
    console.log('[DeviceKeyStore] Generated fresh Device Keypair for offline signing.');

    // Fund the new account — failure here is non-fatal.
    await fundWithFriendbot(newKeypair.publicKey());

    return newKeypair;
  } catch (error) {
    console.error('[DeviceKeyStore] SecureStore error:', error);
    throw new Error('Failed to load or generate the offline device key.');
  }
}