import { Keypair } from '@stellar/stellar-base';
import { Buffer } from 'buffer';
import { stripBase64Padding } from './nonce';

/**
 * Signs the exact UTF-8 string the backend verifies:
 * `${merchantShortId}:${amountPhp}:${nonceHex32}`
 */
export async function signOfflinePaymentMessage(
  message: string,
  keypair: Keypair
): Promise<string> {
  // Yield control to the event loop to prevent UI stutter/thread blocking
  await new Promise((resolve) => setTimeout(resolve, 0));

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
