import { Address, Keypair, nativeToScVal, xdr } from '@stellar/stellar-sdk';
import { requireShortId, shortIdToBuffer } from '@/lib/short-id';

const BASE62_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE62 = 62n;

export type ParsedOfflineVoucher = {
  tokenId: number;
  tokenIdStr: string;
  senderShortId: string;
  receiverShortId: string;
  amountBase62: string;
  amountStroops: bigint;
  nonceB64: string;
  signatureB64: string;
  nonce: Buffer;
  signature: Buffer;
};

export function restoreBase64Padding(value: string): string {
  return value + '='.repeat((4 - (value.length % 4)) % 4);
}

export function decodeBase62(value: string): bigint {
  if (!value) throw new Error('Amount encoding is empty');
  let result = 0n;
  for (const character of value) {
    const index = BASE62_ALPHABET.indexOf(character);
    if (index < 0) throw new Error(`Invalid Base62 character: '${character}'`);
    result = result * BASE62 + BigInt(index);
  }
  return result;
}

export function parseOfflineVoucher(smsPayload: string): ParsedOfflineVoucher {
  const parts = smsPayload.trim().split(':');
  if (parts.length !== 6) {
    throw new Error(`Malformed SMS payload: expected 6 parts, got ${parts.length}`);
  }

  const [tokenIdStr, rawSenderShortId, rawReceiverShortId, amountBase62, nonceB64, signatureB64] = parts;
  const tokenId = Number.parseInt(tokenIdStr, 10);
  if (!/^\d+$/.test(tokenIdStr) || !Number.isSafeInteger(tokenId) || tokenId <= 0) {
    throw new Error('Invalid token ID');
  }

  const senderShortId = requireShortId(rawSenderShortId, 'senderShortId');
  const receiverShortId = requireShortId(rawReceiverShortId, 'receiverShortId');
  const amountStroops = decodeBase62(amountBase62);
  if (amountStroops <= 0n) throw new Error('Amount must be greater than zero');

  const nonce = Buffer.from(restoreBase64Padding(nonceB64), 'base64');
  const signature = Buffer.from(restoreBase64Padding(signatureB64), 'base64');
  if (nonce.length !== 32) throw new Error(`Nonce must decode to 32 bytes, got ${nonce.length}`);
  if (signature.length !== 64) {
    throw new Error(`Signature must decode to 64 bytes, got ${signature.length}`);
  }

  return {
    tokenId,
    tokenIdStr,
    senderShortId,
    receiverShortId,
    amountBase62,
    amountStroops,
    nonceB64,
    signatureB64,
    nonce,
    signature,
  };
}

/** Must remain byte-for-byte identical to the Rust `ToXdr` tuple. */
export function buildOfflineSignatureXdr(input: {
  amountStroops: bigint;
  tollStroops: bigint;
  nonce: Uint8Array;
  receiverShortId: string;
  gatewayPublicKey: string;
  tokenContractId: string;
}): Buffer {
  const tuple = xdr.ScVal.scvVec([
    nativeToScVal(input.amountStroops, { type: 'i128' }),
    nativeToScVal(input.tollStroops, { type: 'i128' }),
    xdr.ScVal.scvBytes(Buffer.from(input.nonce)),
    xdr.ScVal.scvBytes(shortIdToBuffer(input.receiverShortId, 'receiverShortId')),
    Address.fromString(input.gatewayPublicKey).toScVal(),
    Address.fromString(input.tokenContractId).toScVal(),
  ]);
  return Buffer.from(tuple.toXDR());
}

export function verifyOfflineVoucherSignature(
  offlineDevicePublicKey: string,
  xdrBytes: Uint8Array,
  signature: Uint8Array,
): boolean {
  return Keypair.fromPublicKey(offlineDevicePublicKey).verify(
    Buffer.from(xdrBytes),
    Buffer.from(signature),
  );
}
