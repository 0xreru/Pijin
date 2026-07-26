import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createDemoWithdrawRequest,
  demoWithdrawCanonicalMessage,
} from './withdraw-request';

test('serializes demo withdrawal stroops as an exact JSON string', () => {
  const request = createDemoWithdrawRequest(
    'GABC',
    'CABC',
    1_000_000_000n,
  );

  assert.equal(request.amountStroops, '1000000000');
  assert.doesNotThrow(() => JSON.stringify(request));
  assert.equal(
    JSON.stringify(request),
    '{"senderPublicKey":"GABC","tokenAddress":"CABC","amountStroops":"1000000000"}',
  );
});

test('uses the serialized stroop value in the signed canonical message', () => {
  const request = createDemoWithdrawRequest('GABC', 'CABC', 1_000_000_000n);

  assert.equal(
    demoWithdrawCanonicalMessage(request),
    'withdraw:GABC:1000000000',
  );
});
