import 'react-native-get-random-values';
import { loadStoredAccount } from '../storage/accountStorage';
import { stripBase64Padding } from './nonce';

export async function buildCustomerOfflineQr(amount: string, merchantShortId: string): Promise<string> {
  const trimmedAmount = amount.trim();
  const trimmedMerchant = merchantShortId.trim();

  if (!trimmedAmount) {
    throw new Error('Amount is required.');
  }
  if (!trimmedMerchant) {
    throw new Error('Merchant short ID is required.');
  }

  const account = await loadStoredAccount();
  if (!account?.shortId) {
    throw new Error('Customer short ID is missing.');
  }
  if (account.role !== 'CUSTOMER') {
    throw new Error('Only customer accounts can generate offline QR payloads.');
  }

  const bytes = new Uint8Array(8);
  const cryptoApi = globalThis.crypto as { getRandomValues: (array: Uint8Array) => Uint8Array } | undefined;
  if (!cryptoApi) {
    throw new Error('Crypto API not available for nonce generation.');
  }
  cryptoApi.getRandomValues(bytes);
  const nonceB64 = stripBase64Padding(Buffer.from(bytes).toString('base64'));

  return [account.shortId, trimmedMerchant, trimmedAmount, nonceB64].join(':');
}
