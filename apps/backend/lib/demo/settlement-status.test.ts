import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isDemoSettlementNonce,
  isDemoShortId,
  stellarExpertTestnetTxUrl,
} from './settlement-status';

test('validates settlement lookup identifiers', () => {
  assert.equal(isDemoSettlementNonce('A'.repeat(42) + '+'), true);
  assert.equal(isDemoSettlementNonce('too-short'), false);
  assert.equal(isDemoShortId('aB3x9Q'), true);
  assert.equal(isDemoShortId('bad-id'), false);
});

test('builds a Stellar Expert Testnet transaction URL for a valid hash', () => {
  const txHash = 'a'.repeat(64);
  assert.equal(
    stellarExpertTestnetTxUrl(txHash),
    `https://stellar.expert/explorer/testnet/tx/${txHash}`,
  );
  assert.equal(stellarExpertTestnetTxUrl('not-a-hash'), null);
});
