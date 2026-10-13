/**
 * @file lib/pin.ts
 *
 * PIN hashing and verification.
 *  - New PINs are stored as `scrypt$<N>$<r>$<p>$<saltB64>$<hashB64>`.
 *  - Rows created before hashing hold the plaintext PIN; `verifyPin` still
 *    accepts them and reports `needsRehash` so the caller can upgrade the row.
 */

import crypto from "node:crypto";

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 32;
const SALT_LEN = 16;
const PREFIX = "scrypt$";

export const PIN_PATTERN = /^\d{4,6}$/;

export function isValidPinFormat(pin: unknown): pin is string {
  return typeof pin === "string" && PIN_PATTERN.test(pin);
}

export function isHashedPin(stored: string): boolean {
  return stored.startsWith(PREFIX);
}

function scrypt(pin: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(pin, salt, KEY_LEN, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

export async function hashPin(pin: string): Promise<string> {
  const salt = crypto.randomBytes(SALT_LEN);
  const key = await scrypt(pin, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P);
  return `${PREFIX}${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) {
    // Still burn a comparison so length mismatches don't return faster.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

export async function verifyPin(
  pin: string,
  stored: string,
): Promise<{ ok: boolean; needsRehash: boolean }> {
  if (!isHashedPin(stored)) {
    return { ok: constantTimeEqual(pin, stored), needsRehash: true };
  }

  const parts = stored.split("$");
  if (parts.length !== 6) return { ok: false, needsRehash: false };
  const [, nStr, rStr, pStr, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, "base64");
  const actual = await scrypt(pin, Buffer.from(saltB64, "base64"), Number(nStr), Number(rStr), Number(pStr));
  const ok = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  return { ok, needsRehash: ok && Number(nStr) !== SCRYPT_N };
}
