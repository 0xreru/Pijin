import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mergeDemoHistory,
  type DemoHistoryItem,
} from '../../app/demo/demo-events';

function item(
  id: string,
  tag: DemoHistoryItem['tag'],
  timestamp: string,
): DemoHistoryItem {
  return {
    id,
    type: 'TRANSFER',
    tag,
    title: id,
    amount: '1',
    assetCode: 'PHPC',
    status: 'SETTLED',
    timestamp,
  };
}

test('merges authoritative and local demo history by channel and recency', () => {
  const remote = [
    item('remote', 'WALLET', '2026-07-26T01:00:00.000Z'),
    item('offline', 'OFFLINE', '2026-07-26T03:00:00.000Z'),
  ];
  const local = [
    item('local', 'WALLET', '2026-07-26T02:00:00.000Z'),
    { ...item('remote', 'WALLET', '2026-07-26T04:00:00.000Z'), title: 'duplicate' },
  ];

  assert.deepEqual(
    mergeDemoHistory(remote, local, 'WALLET').map(({ id, title }) => ({ id, title })),
    [
      { id: 'local', title: 'local' },
      { id: 'remote', title: 'remote' },
    ],
  );
});

test('caps recent demo history at five items', () => {
  const local = Array.from({ length: 8 }, (_, index) =>
    item(
      String(index),
      'OFFLINE',
      new Date(Date.UTC(2026, 6, 26, 0, index)).toISOString(),
    ),
  );

  assert.deepEqual(
    mergeDemoHistory([], local, 'OFFLINE').map(({ id }) => id),
    ['7', '6', '5', '4', '3'],
  );
});
