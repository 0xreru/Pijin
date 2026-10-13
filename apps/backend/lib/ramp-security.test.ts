import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import {
  isRampEnabled,
  isDepositEnabled,
  isWithdrawEnabled,
  enforceRampKillSwitch,
  verifyInteractiveToken,
  claimInteractiveTokenOnce,
  validateRampLimits,
  RAMP_CAPS,
} from './ramp-config';

test('Ramp Kill Switches: default enabled', () => {
  delete process.env.RAMP_ENABLED;
  delete process.env.DEPOSIT_ENABLED;
  delete process.env.WITHDRAW_ENABLED;

  assert.equal(isRampEnabled(), true);
  assert.equal(isDepositEnabled(), true);
  assert.equal(isWithdrawEnabled(), true);
  assert.equal(enforceRampKillSwitch('deposit'), null);
  assert.equal(enforceRampKillSwitch('withdraw'), null);
});

test('Ramp Kill Switches: RAMP_ENABLED=false shuts down both deposit and withdraw', () => {
  process.env.RAMP_ENABLED = 'false';

  assert.equal(isRampEnabled(), false);
  assert.equal(isDepositEnabled(), false);
  assert.equal(isWithdrawEnabled(), false);

  const depositBlock = enforceRampKillSwitch('deposit');
  assert.ok(depositBlock);
  assert.equal(depositBlock.status, 503);

  const withdrawBlock = enforceRampKillSwitch('withdraw');
  assert.ok(withdrawBlock);
  assert.equal(withdrawBlock.status, 503);

  delete process.env.RAMP_ENABLED;
});

test('Ramp Kill Switches: individual switches can be toggled', () => {
  process.env.RAMP_ENABLED = 'true';
  process.env.DEPOSIT_ENABLED = 'false';
  process.env.WITHDRAW_ENABLED = 'true';

  assert.equal(isDepositEnabled(), false);
  assert.equal(isWithdrawEnabled(), true);

  const depositBlock = enforceRampKillSwitch('deposit');
  assert.ok(depositBlock);
  assert.equal(depositBlock.status, 503);

  assert.equal(enforceRampKillSwitch('withdraw'), null);

  delete process.env.DEPOSIT_ENABLED;
  delete process.env.WITHDRAW_ENABLED;
});

test('Interactive Token Verification: verifies valid HS256 JWT with sub and transaction_id', () => {
  const secret = 'test-interactive-secret-1234567890';
  process.env.SECRET_SEP24_INTERACTIVE_URL_JWT_SECRET = secret;

  const validToken = jwt.sign(
    {
      sub: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
      transaction_id: '123e4567-e89b-12d3-a456-426614174000',
    },
    secret,
    { algorithm: 'HS256', expiresIn: '15m' },
  );

  const payload = verifyInteractiveToken(`Bearer ${validToken}`);
  assert.equal(payload.sub, 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5');
  assert.equal(payload.transaction_id, '123e4567-e89b-12d3-a456-426614174000');
});

test('Interactive Token Verification: rejects missing or invalid claims', () => {
  const secret = 'test-interactive-secret-1234567890';
  process.env.SECRET_SEP24_INTERACTIVE_URL_JWT_SECRET = secret;

  const missingClaims = jwt.sign(
    { sub: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5' },
    secret,
    { algorithm: 'HS256' },
  );

  assert.throws(() => verifyInteractiveToken(missingClaims), /missing required claims/);
});

test('Ramp Limits: enforces per-transaction caps', async () => {
  const account = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
  
  // Exceeds PHPC per-tx limit
  const overTx = await validateRampLimits(account, 'PHPC', RAMP_CAPS.PHPC.maxPerTx + 1);
  assert.equal(overTx.allowed, false);
  assert.match(overTx.error!, /exceeds the maximum limit/);

  // Negative or zero amount
  const zeroAmount = await validateRampLimits(account, 'PHPC', 0);
  assert.equal(zeroAmount.allowed, false);

  // Within limits
  const validTx = await validateRampLimits(account, 'PHPC', 500);
  assert.equal(validTx.allowed, true);
});

test('Interactive Token Single-Use Claim: returns true in test environment', async () => {
  const res = await claimInteractiveTokenOnce('test-tx-uuid-123');
  assert.equal(res, true);
});
