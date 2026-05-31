import { Keypair } from '@stellar/stellar-base';
import { stripBase64Padding } from './nonce';

/**
 * Signs the exact UTF-8 string the backend verifies:
 * `${merchantShortId}:${amountPhp}:${nonceHex32}`
 */
export function signOfflinePaymentMessage(
  message: string,
  secretKey: string
): string {
  const keypair = Keypair.fromSecret(secretKey);
  const signature = keypair.sign(Buffer.from(message, 'utf8'));
  return stripBase64Padding(signature.toString('base64'));
}

export function buildOfflineSignMessage(
  merchantShortId: string,
  amountPhp: number,
  nonceHex32: string
): string {
  return `${merchantShortId}:${amountPhp}:${nonceHex32}`;
}
