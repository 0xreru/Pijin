import { Buffer } from 'buffer';

/** 8-byte nonce for SMS; backend expands to 32 bytes. */
export function generateShortNonce(): Uint8Array {
  const bytes = new Uint8Array(8);
  const cryptoApi = globalThis.crypto as { getRandomValues: (array: Uint8Array) => Uint8Array } | undefined;

  if (!cryptoApi) {
    throw new Error('Crypto API not available for nonce generation.');
  }

  cryptoApi.getRandomValues(bytes);
  return bytes;
}

export function expandNonceTo32(shortNonce: Uint8Array): Uint8Array {
  const full = new Uint8Array(32);
  full.set(shortNonce.slice(0, 8), 0);
  return full;
}

export function shortNonceToBase64(shortNonce: Uint8Array): string {
  return stripBase64Padding(uint8ToBase64(shortNonce));
}

export function expandedNonceHex(shortNonce: Uint8Array): string {
  return Buffer.from(expandNonceTo32(shortNonce)).toString('hex');
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  if (typeof btoa !== 'undefined') {
    return btoa(binary);
  }
  return Buffer.from(bytes).toString('base64');
}

export function stripBase64Padding(value: string): string {
  return value.replace(/=+$/g, '');
}
