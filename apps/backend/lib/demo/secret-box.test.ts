import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import {
  decryptDemoSecret,
  encryptDemoSecret,
  hashDemoSessionId,
  validateDemoSessionId,
} from './secret-box';

test('demo secrets round-trip with AES-256-GCM', () => {
  const key = randomBytes(32);
  const encrypted = encryptDemoSecret('SDEMOSECRET', key);

  assert.notEqual(encrypted, 'SDEMOSECRET');
  assert.equal(decryptDemoSecret(encrypted, key), 'SDEMOSECRET');
});

test('tampered demo secrets are rejected', () => {
  const key = randomBytes(32);
  const encrypted = encryptDemoSecret('SDEMOSECRET', key);
  const tampered = `${encrypted.slice(0, -1)}${encrypted.endsWith('A') ? 'B' : 'A'}`;

  assert.throws(() => decryptDemoSecret(tampered, key));
});

test('session identifiers are validated and hashed deterministically', () => {
  const sessionId = validateDemoSessionId('judge-session_123456');
  assert.equal(hashDemoSessionId(sessionId), hashDemoSessionId(sessionId));
  assert.throws(() => validateDemoSessionId('short'));
  assert.throws(() => validateDemoSessionId('judge session with spaces'));
});
