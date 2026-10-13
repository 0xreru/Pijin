/**
 * @file lib/reconciliation.test.ts
 *
 * Unit tests for Retry Reconciliation Engine and On-Chain Registry Pre-Flight:
 *  - Phase A: Reconciliation when getTransaction finds txHash (SUCCESS -> SETTLED)
 *  - Phase B: Reconciliation when RPC pruned txHash (NOT_FOUND) but getLedgerEntries finds Nonce -> SETTLED
 *  - Phase C: Reconciliation when Nonce is missing on-chain -> SAFE_TO_RETRY
 *  - On-Chain Registry Pre-Flight validation & auto-registration
 *  - buildNonceLedgerKey validation
 */

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://dummy:dummy@localhost:5432/dummy';
process.env.CONTRACT_ID = process.env.CONTRACT_ID || 'CBYRV2FDGXHMKQILP3EWYI4ILKKQ2HW4NW4NJCFYQY6NEE7463ARLNUD';
process.env.RELAYER_PUBLIC_KEY = process.env.RELAYER_PUBLIC_KEY || 'GDTDK62M4ZJU6QPCEFUSQWOPYED4I4GPHLB4ZZTMBZZL2AO2VK63VQUH';

import assert from 'node:assert/strict';
import test from 'node:test';
import crypto from 'node:crypto';
import { Keypair, rpc } from '@stellar/stellar-sdk';
import {
  buildNonceLedgerKey,
  isNonceCommittedOnChain,
  reconcileExistingSettlement,
  verifyOrRegisterRecipientOnChain,
} from './stellar-reconciliation';
import { pijinContract, sorobanRpcServer } from './pijin-contract';
import { prisma } from './prisma';

test('buildNonceLedgerKey: constructs a valid persistent contractData LedgerKey', () => {
  const nonce = crypto.randomBytes(32);
  const ledgerKey = buildNonceLedgerKey(nonce);
  assert.ok(ledgerKey);
  const xdrBase64 = ledgerKey.toXDR('base64');
  assert.ok(xdrBase64.length > 0);

  // Rejects wrong nonce length
  assert.throws(
    () => buildNonceLedgerKey(Buffer.from([1, 2, 3])),
    /Nonce must be exactly 32 bytes/,
  );
});

test('reconcileExistingSettlement - Phase A: resolves to SETTLED when getTransaction confirms SUCCESS', async () => {
  const originalGetTx = sorobanRpcServer.getTransaction;
  const originalUpdate = prisma.settlement.update;

  let dbUpdated = false;
  let updatedStatus = '';

  try {
    const mockTxHash = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
    const mockNonce = crypto.randomBytes(32).toString('base64');

    sorobanRpcServer.getTransaction = async (hash: string) => {
      assert.equal(hash, mockTxHash);
      return {
        status: rpc.Api.GetTransactionStatus.SUCCESS,
        returnValue: 'mock_success',
      } as any;
    };

    prisma.settlement.update = (async (args: any) => {
      dbUpdated = true;
      updatedStatus = args.data.status;
      return { id: args.where.id, status: args.data.status } as any;
    }) as any;

    const result = await reconcileExistingSettlement({
      id: 999,
      nonce: mockNonce,
      txHash: mockTxHash,
    });

    assert.equal(result.status, 'SETTLED');
    if (result.status === 'SETTLED') {
      assert.equal(result.source, 'RPC_TX_SUCCESS');
      assert.equal(result.txHash, mockTxHash);
    }
    assert.equal(dbUpdated, true);
    assert.equal(updatedStatus, 'SETTLED');
  } finally {
    sorobanRpcServer.getTransaction = originalGetTx;
    prisma.settlement.update = originalUpdate;
  }
});

test('reconcileExistingSettlement - Phase B: resolves to SETTLED when tx is NOT_FOUND but nonce exists in contract storage', async () => {
  const originalGetTx = sorobanRpcServer.getTransaction;
  const originalGetEntries = sorobanRpcServer.getLedgerEntries;
  const originalUpdate = prisma.settlement.update;

  let dbUpdated = false;
  let updatedStatus = '';

  try {
    const mockTxHash = 'abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd';
    const mockNonce = crypto.randomBytes(32).toString('base64');

    // Simulate RPC timeout or pruning
    sorobanRpcServer.getTransaction = async () => ({
      status: rpc.Api.GetTransactionStatus.NOT_FOUND,
    } as any);

    // Simulate storage finding the Nonce entry on-chain
    sorobanRpcServer.getLedgerEntries = async () => ({
      entries: [{ key: {} as any, val: {} as any, liveUntilLedgerSeq: 1000 }],
      latestLedger: 500,
    } as any);

    prisma.settlement.update = (async (args: any) => {
      dbUpdated = true;
      updatedStatus = args.data.status;
      return { id: args.where.id, status: args.data.status } as any;
    }) as any;

    const result = await reconcileExistingSettlement({
      id: 888,
      nonce: mockNonce,
      txHash: mockTxHash,
    });

    assert.equal(result.status, 'SETTLED');
    if (result.status === 'SETTLED') {
      assert.equal(result.source, 'CONTRACT_STORAGE_NONCE');
      assert.equal(result.txHash, mockTxHash);
    }
    assert.equal(dbUpdated, true);
    assert.equal(updatedStatus, 'SETTLED');
  } finally {
    sorobanRpcServer.getTransaction = originalGetTx;
    sorobanRpcServer.getLedgerEntries = originalGetEntries;
    prisma.settlement.update = originalUpdate;
  }
});

test('reconcileExistingSettlement - Phase C: resolves to SAFE_TO_RETRY when tx is NOT_FOUND and nonce is NOT on-chain', async () => {
  const originalGetTx = sorobanRpcServer.getTransaction;
  const originalGetEntries = sorobanRpcServer.getLedgerEntries;
  const originalUpdate = prisma.settlement.update;

  let dbUpdated = false;

  try {
    const mockTxHash = '9999999999999999999999999999999999999999999999999999999999999999';
    const mockNonce = crypto.randomBytes(32).toString('base64');

    sorobanRpcServer.getTransaction = async () => ({
      status: rpc.Api.GetTransactionStatus.NOT_FOUND,
    } as any);

    // Simulate empty entries in storage (nonce not consumed)
    sorobanRpcServer.getLedgerEntries = async () => ({
      entries: [],
      latestLedger: 500,
    } as any);

    prisma.settlement.update = (async () => {
      dbUpdated = true;
      return {} as any;
    }) as any;

    const result = await reconcileExistingSettlement({
      id: 777,
      nonce: mockNonce,
      txHash: mockTxHash,
    });

    assert.equal(result.status, 'SAFE_TO_RETRY');
    assert.equal(dbUpdated, false, 'DB should NOT be marked as SETTLED when safe to retry');
  } finally {
    sorobanRpcServer.getTransaction = originalGetTx;
    sorobanRpcServer.getLedgerEntries = originalGetEntries;
    prisma.settlement.update = originalUpdate;
  }
});

test('verifyOrRegisterRecipientOnChain: detects existing on-chain recipient', async () => {
  const originalGetRecipient = pijinContract.get_recipient;

  try {
    const mockAddress = 'GB3GKMJWEX576Q34EZ4L3KDJV45J6M252T5XGEX5N7R75K4NQQ6H56B6';
    pijinContract.get_recipient = (async ({ short_id }: any) => {
      assert.equal(short_id.toString('ascii'), 'rec001');
      return { result: mockAddress } as any;
    }) as any;

    const result = await verifyOrRegisterRecipientOnChain({
      shortId: 'rec001',
      stellarPublicKey: mockAddress,
      autoRegister: false,
    });

    assert.equal(result.exists, true);
    assert.equal(result.autoRegistered, false);
    assert.equal(result.receiverAddress, mockAddress);
  } finally {
    pijinContract.get_recipient = originalGetRecipient;
  }
});

test('verifyOrRegisterRecipientOnChain: returns error when recipient not found and auto-register disabled', async () => {
  const originalGetRecipient = pijinContract.get_recipient;

  try {
    pijinContract.get_recipient = (async () => ({ result: null }) as any) as any;

    const result = await verifyOrRegisterRecipientOnChain({
      shortId: 'notFnd',
      stellarPublicKey: 'GB3GKMJWEX576Q34EZ4L3KDJV45J6M252T5XGEX5N7R75K4NQQ6H56B6',
      autoRegister: false,
    });

    assert.equal(result.exists, false);
    assert.equal(result.autoRegistered, false);
    assert.match(result.error || '', /not registered on-chain/);
  } finally {
    pijinContract.get_recipient = originalGetRecipient;
  }
});

test('verifyOrRegisterRecipientOnChain: executes auto-registration when missing', async () => {
  const originalGetRecipient = pijinContract.get_recipient;
  const originalRegister = pijinContract.register_recipient;
  const originalSend = sorobanRpcServer.sendTransaction;
  const originalGetTx = sorobanRpcServer.getTransaction;

  const mockRegistrar = Keypair.random();
  const mockRecipientKey = Keypair.random().publicKey();

  try {
    pijinContract.get_recipient = (async () => ({ result: null }) as any) as any;

    let registerCalled = false;
    pijinContract.register_recipient = (async (args: any) => {
      registerCalled = true;
      assert.equal(args.receiver, mockRecipientKey);
      return {
        toXDR: () => {
          const acc = new (require('@stellar/stellar-sdk').Account)(mockRegistrar.publicKey(), '1');
          return new (require('@stellar/stellar-sdk').TransactionBuilder)(acc, {
            fee: '100',
            networkPassphrase: 'Test SDF Network ; September 2015',
          })
            .setTimeout(30)
            .build()
            .toXDR();
        },
      } as any;
    }) as any;

    sorobanRpcServer.sendTransaction = async () => ({
      status: 'PENDING',
      hash: 'mock_tx_hash',
    } as any);

    sorobanRpcServer.getTransaction = async () => ({
      status: rpc.Api.GetTransactionStatus.SUCCESS,
    } as any);

    const result = await verifyOrRegisterRecipientOnChain({
      shortId: 'auto01',
      stellarPublicKey: mockRecipientKey,
      autoRegister: true,
      registrarSecretKey: mockRegistrar.secret(),
    });

    assert.equal(registerCalled, true);
    assert.equal(result.exists, true);
    assert.equal(result.autoRegistered, true);
    assert.equal(result.receiverAddress, mockRecipientKey);
  } finally {
    pijinContract.get_recipient = originalGetRecipient;
    pijinContract.register_recipient = originalRegister;
    sorobanRpcServer.sendTransaction = originalSend;
    sorobanRpcServer.getTransaction = originalGetTx;
  }
});
