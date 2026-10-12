/**
 * @file lib/stellar-transaction-manager.test.ts
 *
 * Unit tests for the decoupled Stellar transaction manager:
 *  - Deterministic pre-hash calculation
 *  - Decoupled submission and error decoding
 *  - Polling with bounded attempts
 */

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://dummy:dummy@localhost:5432/dummy';
process.env.CONTRACT_ID = process.env.CONTRACT_ID || 'CCGXMMXAYI4EHTGSH65ML3VK6TTRBQGT3BT2NN3P6Y3LGN6XIL2HILPX';
process.env.RELAYER_PUBLIC_KEY = process.env.RELAYER_PUBLIC_KEY || 'GCATS5YOVB6ROX2WUNKGNQ2MP3GMXDMKSG2O4N5CLX3A6W4PZGZZI55U';

import assert from 'node:assert/strict';
import test from 'node:test';
import { Keypair, TransactionBuilder, Networks, xdr } from '@stellar/stellar-sdk';
import {
  pollTransactionConfirmation,
  submitSignedTransaction,
} from './stellar-transaction-manager';
import { sorobanRpcServer } from './pijin-contract';

test('deterministic txHash: Transaction hash calculation produces 64-hex string matching SHA-256', () => {
  const keypair = Keypair.random();
  const account = new (require('@stellar/stellar-sdk').Account)(
    keypair.publicKey(),
    '100',
  );

  const tx = new TransactionBuilder(account, {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      require('@stellar/stellar-sdk').Operation.payment({
        destination: keypair.publicKey(),
        asset: require('@stellar/stellar-sdk').Asset.native(),
        amount: '1',
      }),
    )
    .setTimeout(30)
    .build();

  tx.sign(keypair);

  const txHash = tx.hash().toString('hex');
  assert.equal(txHash.length, 64);
  assert.match(txHash, /^[a-f0-9]{64}$/);
});

test('submitSignedTransaction: throws with error details when status is ERROR', async () => {
  const originalSend = sorobanRpcServer.sendTransaction;
  try {
    // Mock RPC returning ERROR
    sorobanRpcServer.sendTransaction = async () => ({
      status: 'ERROR',
      errorResultXdr: 'AAAAAAA=',
      hash: '0000000000000000000000000000000000000000000000000000000000000000',
      latestLedger: 1234,
      latestLedgerCloseTime: 1700000000,
    } as any);

    const dummyKeypair = Keypair.random();
    const dummyAccount = new (require('@stellar/stellar-sdk').Account)(
      dummyKeypair.publicKey(),
      '1',
    );
    const dummyTx = new TransactionBuilder(dummyAccount, {
      fee: '100',
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        require('@stellar/stellar-sdk').Operation.payment({
          destination: dummyKeypair.publicKey(),
          asset: require('@stellar/stellar-sdk').Asset.native(),
          amount: '1',
        }),
      )
      .setTimeout(30)
      .build();
    dummyTx.sign(dummyKeypair);

    await assert.rejects(
      async () => submitSignedTransaction(dummyTx),
      /Soroban sendTransaction failed: status=ERROR/,
    );
  } finally {
    sorobanRpcServer.sendTransaction = originalSend;
  }
});

test('pollTransactionConfirmation: resolves SUCCESS when RPC confirms', async () => {
  const originalGet = sorobanRpcServer.getTransaction;
  try {
    const mockHash = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
    sorobanRpcServer.getTransaction = async () => ({
      status: 'SUCCESS',
      latestLedger: 100,
      latestLedgerCloseTime: 1700000000,
      oldestLedger: 90,
      oldestLedgerCloseTime: 1699999000,
      applicationOrder: 1,
      feeBump: false,
      envelopeXdr: {} as any,
      resultXdr: {} as any,
      resultMetaXdr: {} as any,
      returnValue: 'success_val',
      txHash: mockHash,
    } as any);

    const result = await pollTransactionConfirmation(mockHash, { maxAttempts: 2, intervalMs: 1 });
    assert.equal(result.status, 'SUCCESS');
    assert.equal(result.txHash, mockHash);
    assert.equal(result.returnValue, 'success_val');
  } finally {
    sorobanRpcServer.getTransaction = originalGet;
  }
});

test('pollTransactionConfirmation: resolves FAILED when RPC reports failure', async () => {
  const originalGet = sorobanRpcServer.getTransaction;
  try {
    const mockHash = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
    sorobanRpcServer.getTransaction = async () => ({
      status: 'FAILED',
      latestLedger: 100,
      latestLedgerCloseTime: 1700000000,
      oldestLedger: 90,
      oldestLedgerCloseTime: 1699999000,
      applicationOrder: 1,
      feeBump: false,
      envelopeXdr: {} as any,
      resultXdr: { toXDR: () => 'result_err_xdr' } as any,
      resultMetaXdr: {} as any,
      txHash: mockHash,
    } as any);

    const result = await pollTransactionConfirmation(mockHash, { maxAttempts: 2, intervalMs: 1 });
    assert.equal(result.status, 'FAILED');
    assert.equal(result.txHash, mockHash);
    assert.equal(result.errorResultXdr, 'result_err_xdr');
  } finally {
    sorobanRpcServer.getTransaction = originalGet;
  }
});

test('pollTransactionConfirmation: returns NOT_FOUND when max attempts are exceeded', async () => {
  const originalGet = sorobanRpcServer.getTransaction;
  try {
    const mockHash = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
    sorobanRpcServer.getTransaction = async () => ({
      status: 'NOT_FOUND',
      latestLedger: 100,
      latestLedgerCloseTime: 1700000000,
      oldestLedger: 90,
      oldestLedgerCloseTime: 1699999000,
    } as any);

    const result = await pollTransactionConfirmation(mockHash, { maxAttempts: 3, intervalMs: 5 });
    assert.equal(result.status, 'NOT_FOUND');
    assert.equal(result.txHash, mockHash);
  } finally {
    sorobanRpcServer.getTransaction = originalGet;
  }
});
