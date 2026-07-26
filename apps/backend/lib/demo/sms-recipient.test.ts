import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeSmsRecipient } from '../sms';

test('normalizes Philippine and international SMS recipients', () => {
  assert.equal(normalizeSmsRecipient('0917 123 4567'), '+639171234567');
  assert.equal(normalizeSmsRecipient('639171234567'), '+639171234567');
  assert.equal(normalizeSmsRecipient('+1 (415) 555-2671'), '+14155552671');
});

test('rejects demo identifiers and malformed phone numbers', () => {
  assert.equal(normalizeSmsRecipient('demo:aB3x9Q'), null);
  assert.equal(normalizeSmsRecipient('not-a-phone'), null);
  assert.equal(normalizeSmsRecipient('+'), null);
});
