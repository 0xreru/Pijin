import { Buffer } from 'buffer';
import { loadStoredAccount } from '../storage/accountStorage';
import { generateShortNonce, shortNonceToBase64 } from './nonce';

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

  const shortNonce = generateShortNonce();
  const nonceB64 = shortNonceToBase64(shortNonce);

  return [account.shortId, trimmedMerchant, trimmedAmount, nonceB64].join(':');
}
