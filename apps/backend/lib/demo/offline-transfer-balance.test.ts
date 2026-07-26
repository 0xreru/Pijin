import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatPhpcStroops,
  parsePhpcToStroops,
  quoteOfflineTransfer,
} from './offline-transfer-balance';

test('parses PHPC amounts to exact stroops', () => {
  assert.equal(parsePhpcToStroops('10'), 100_000_000n);
  assert.equal(parsePhpcToStroops('10.5'), 105_000_000n);
  assert.equal(parsePhpcToStroops('0.0000001'), 1n);
  assert.equal(parsePhpcToStroops('0'), null);
  assert.equal(parsePhpcToStroops('1.00000001'), null);
});

test('includes the fixed PHPC protocol toll in the balance requirement', () => {
  assert.deepEqual(quoteOfflineTransfer('10', 100_000_000n), {
    amountStroops: 100_000_000n,
    requiredStroops: 105_000_000n,
    shortfallStroops: 5_000_000n,
  });
  assert.equal(quoteOfflineTransfer('10', 105_000_000n)?.shortfallStroops, 0n);
});

test('formats stroops without floating-point rounding', () => {
  assert.equal(formatPhpcStroops(105_000_000n), '10.5');
  assert.equal(formatPhpcStroops(1n), '0.0000001');
});
