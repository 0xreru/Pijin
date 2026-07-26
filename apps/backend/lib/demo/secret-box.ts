import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
} from 'node:crypto';

const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;

export function encryptionKeyFromEnv(
  encoded = process.env.DEMO_POOL_ENCRYPTION_KEY,
): Buffer {
  if (!encoded) {
    const sep10Secret = process.env.SECRET_SEP10_JWT_SECRET;
    if (!sep10Secret) {
      throw new Error(
        'Missing DEMO_POOL_ENCRYPTION_KEY (and no SECRET_SEP10_JWT_SECRET fallback is available)',
      );
    }
    return Buffer.from(
      hkdfSync(
        'sha256',
        Buffer.from(sep10Secret, 'utf8'),
        Buffer.from('pijin-demo-pool', 'utf8'),
        Buffer.from('demo-wallet-secret-encryption-v1', 'utf8'),
        KEY_BYTES,
      ),
    );
  }

  const key = Buffer.from(encoded, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error('DEMO_POOL_ENCRYPTION_KEY must be a Base64-encoded 32-byte key');
  }
  return key;
}

export function encryptDemoSecret(secret: string, key = encryptionKeyFromEnv()): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(secret, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

export function decryptDemoSecret(payload: string, key = encryptionKeyFromEnv()): string {
  const [version, ivEncoded, tagEncoded, ciphertextEncoded, extra] = payload.split('.');
  if (
    version !== VERSION ||
    !ivEncoded ||
    !tagEncoded ||
    !ciphertextEncoded ||
    extra !== undefined
  ) {
    throw new Error('Unsupported or malformed encrypted demo secret');
  }

  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(ivEncoded, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagEncoded, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextEncoded, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export function hashDemoSessionId(sessionId: string): string {
  return createHash('sha256').update(sessionId, 'utf8').digest('hex');
}

export function validateDemoSessionId(value: unknown): string {
  const sessionId = typeof value === 'string' ? value.trim() : '';
  if (
    sessionId.length < 16 ||
    sessionId.length > 128 ||
    !/^[0-9A-Za-z_-]+$/.test(sessionId)
  ) {
    throw new Error('clientSessionId must be 16-128 URL-safe characters');
  }
  return sessionId;
}
