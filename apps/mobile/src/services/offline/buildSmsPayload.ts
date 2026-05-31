import {
  buildOfflineSignMessage,
  signOfflinePaymentMessage,
} from './signPayment';
import {
  expandedNonceHex,
  generateShortNonce,
  shortNonceToBase64,
} from './nonce';
import { getOrGenerateDeviceKeypair } from '../wallet/deviceKeyStore';

export type OfflineVoucherInput = {
  customerShortId: string;
  merchantShortId: string;
  amountPhp: number;
};

export type OfflineVoucherResult = {
  smsBody: string;
  nonceB64: string;
  signatureB64: string;
  signMessage: string;
};

export async function buildOfflineSmsVoucher(
  input: OfflineVoucherInput
): Promise<OfflineVoucherResult> {
  const shortNonce = generateShortNonce();
  const nonceB64 = shortNonceToBase64(shortNonce);
  const nonceHex32 = expandedNonceHex(shortNonce);
  const signMessage = buildOfflineSignMessage(
    input.merchantShortId,
    input.amountPhp,
    nonceHex32
  );

  const deviceKeypair = await getOrGenerateDeviceKeypair();
  const secret = deviceKeypair.secret();

  const signatureB64 = signOfflinePaymentMessage(signMessage, secret);
  const smsBody = [
    input.customerShortId,
    input.merchantShortId,
    String(input.amountPhp),
    nonceB64,
    signatureB64,
  ].join(':');

  return {
    smsBody,
    nonceB64,
    signatureB64,
    signMessage,
  };
}
