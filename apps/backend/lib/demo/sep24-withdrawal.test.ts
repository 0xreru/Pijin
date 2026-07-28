import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isReadySep24WithdrawalMessage,
  withSep24PostMessageCallback,
} from './sep24-withdrawal';

const TRANSACTION_ID = 'f15dd593-2247-41e7-b0bd-8ce7ec8165a7';

test('accepts the legacy Pijin SEP-24 handoff', () => {
  assert.equal(
    isReadySep24WithdrawalMessage(
      { type: 'success', status: 'pending_user_transfer_start' },
      TRANSACTION_ID,
    ),
    true,
  );
});

test('accepts a JSON-serialized SEP-24 transaction callback', () => {
  assert.equal(
    isReadySep24WithdrawalMessage(
      JSON.stringify({
        transaction: {
          id: TRANSACTION_ID,
          status: 'pending_user_transfer_start',
        },
      }),
      TRANSACTION_ID,
    ),
    true,
  );
});

test('rejects a callback for a different withdrawal', () => {
  assert.equal(
    isReadySep24WithdrawalMessage(
      {
        transaction: {
          id: 'another-withdrawal',
          status: 'pending_user_transfer_start',
        },
      },
      TRANSACTION_ID,
    ),
    false,
  );
});

test('adds the SEP-24 postMessage callback while preserving the signed URL', () => {
  const url = withSep24PostMessageCallback(
    `https://anchor.example/withdraw?transaction_id=${TRANSACTION_ID}&token=signed`,
  );
  const parsed = new URL(url);

  assert.equal(parsed.searchParams.get('callback'), 'postMessage');
  assert.equal(parsed.searchParams.get('transaction_id'), TRANSACTION_ID);
  assert.equal(parsed.searchParams.get('token'), 'signed');
});
