import { Buffer } from 'buffer';
import { Address, Keypair, xdr, nativeToScVal } from '@stellar/stellar-sdk';
import crypto from 'node:crypto';

const BASE62_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE62 = BigInt(62);

export type SmsPayloadParams = {
  senderSecretKey: string;
  senderShortId: string;
  receiverShortId: string;
  amountStroops: bigint;
  gatewayPubKey: string;
  tokenContractId: string;
  tokenSymbol: string;
  tokenIdStr: string;
};

export function encodeBase62(num: bigint): string {
  if (num < 0n) throw new RangeError('encodeBase62: input must be a non-negative BigInt');
  if (num === 0n) return '0';
  let result = '';
  let n = num;
  while (n > 0n) {
    result = BASE62_ALPHABET[Number(n % BASE62)] + result;
    n = n / BASE62;
  }
  return result;
}

export function stripBase64Padding(b64: string): string {
  return b64.replace(/=+$/, '');
}

function buildXdrTuple(
  amountStroops: bigint,
  tollStroops: bigint,
  nonce32: Uint8Array,
  receiverShortId: string,
  gatewayPubKey: string,
  tokenContractId: string,
): Buffer {
  const amountScVal  = nativeToScVal(amountStroops, { type: 'i128' });
  const tollScVal     = nativeToScVal(tollStroops, { type: 'i128' });
  const nonceScVal   = xdr.ScVal.scvBytes(Buffer.from(nonce32));
  const receiverScVal = xdr.ScVal.scvBytes(Buffer.from(receiverShortId, 'ascii'));
  const gatewayScVal  = Address.fromString(gatewayPubKey).toScVal();
  const tokenScVal    = Address.fromString(tokenContractId).toScVal();

  const tuple = xdr.ScVal.scvVec([
    amountScVal,
    tollScVal,
    nonceScVal,
    receiverScVal,
    gatewayScVal,
    tokenScVal,
  ]);

  return Buffer.from(tuple.toXDR());
}

export async function generateOfflineSmsPayload(
  params: SmsPayloadParams,
): Promise<{ smsPayload: string; debug: any }> {
  const {
    senderSecretKey,
    senderShortId,
    receiverShortId,
    amountStroops,
    gatewayPubKey,
    tokenContractId,
    tokenIdStr,
    tokenSymbol,
  } = params;

  const nonce32 = new Uint8Array(32);
  crypto.webcrypto.getRandomValues(nonce32);
  
  const isPHPC = tokenSymbol === 'PHPC';
  const tollStroops = isPHPC ? 5000000n : 0n;
  
  const xdrBuffer = buildXdrTuple(
    amountStroops,
    tollStroops,
    nonce32,
    receiverShortId,
    gatewayPubKey,
    tokenContractId,
  );

  const senderKeypair = Keypair.fromSecret(senderSecretKey);
  const signatureBytes = senderKeypair.sign(xdrBuffer);

  const amountBase62 = encodeBase62(amountStroops);
  const nonceB64 = stripBase64Padding(Buffer.from(nonce32).toString('base64'));
  const signatureB64 = stripBase64Padding(Buffer.from(signatureBytes).toString('base64'));

  const smsPayload = [
    tokenIdStr,
    senderShortId,
    receiverShortId,
    amountBase62,
    nonceB64,
    signatureB64,
  ].join(':');

  return {
    smsPayload,
    debug: {
      amountStroops: amountStroops.toString(),
      amountBase62,
      nonceHex: Buffer.from(nonce32.slice(0, 8)).toString('hex'),
      nonceB64,
      signatureB64,
      xdrLength: xdrBuffer.length
    }
  };
}
