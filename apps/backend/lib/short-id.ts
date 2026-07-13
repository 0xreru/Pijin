import crypto from 'node:crypto';

export const SHORT_ID_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export const SHORT_ID_LENGTH = 6;
export const SHORT_ID_PATTERN = /^[0-9A-Za-z]{6}$/;

export function isValidShortId(value: string): boolean {
  return SHORT_ID_PATTERN.test(value);
}

export function requireShortId(value: unknown, field = 'shortId'): string {
  const shortId = typeof value === 'string' ? value.trim() : '';
  if (!isValidShortId(shortId)) {
    throw new Error(`${field} must be exactly 6 case-sensitive Base62 characters`);
  }
  return shortId;
}

/** Uniform Base62 generation; randomInt avoids modulo bias from byte % 62. */
export function generateBase62Id(): string {
  let result = '';
  for (let index = 0; index < SHORT_ID_LENGTH; index += 1) {
    result += SHORT_ID_ALPHABET[crypto.randomInt(0, SHORT_ID_ALPHABET.length)];
  }
  return result;
}

export function shortIdToBuffer(value: unknown, field = 'shortId'): Buffer {
  return Buffer.from(requireShortId(value, field), 'ascii');
}
