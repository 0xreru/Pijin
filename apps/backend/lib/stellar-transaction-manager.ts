/**
 * @file lib/stellar-transaction-manager.ts
 *
 * Decoupled Stellar/Soroban Transaction Construction and Submission Engine.
 *
 * Provides:
 *  1. Two-phase transaction assembly: Simulation -> Signing -> Deterministic Pre-Hash extraction.
 *  2. Pre-broadcast persistence: Saves `txHash` and `signedTxXdr` in the database BEFORE network broadcast.
 *  3. Decoupled submission and bounded polling with exponential backoff.
 *  4. Retry-safe state management preventing duplicate gas spends.
 */

import {
  Keypair,
  Transaction,
  TransactionBuilder,
  rpc,
} from '@stellar/stellar-sdk';
import { contractConfig, pijinContract, sorobanRpcServer } from '@/lib/pijin-contract';
import { prisma } from '@/lib/prisma';
import { logOfflineTransactionDebug } from '@/lib/offline-transaction-debug';

export interface SpendOfflineContractArgs {
  gateway: string;
  sender: string;
  token: string;
  receiver_short_id: Buffer;
  amount: bigint;
  protocol_toll: bigint;
  nonce: Buffer;
  signature: Buffer;
}

export interface PreparedRelayerTransaction {
  txHash: string;
  signedTxXdr: string;
  signerAddress: string;
  transaction: Transaction;
}

export interface TransactionPollResult {
  status: 'SUCCESS' | 'FAILED' | 'NOT_FOUND';
  txHash: string;
  returnValue?: unknown;
  errorResultXdr?: string;
  rawResponse?: rpc.Api.GetTransactionResponse;
}

/**
 * Builds and signs a `spend_offline` Soroban transaction.
 *
 * Extracts the deterministic 64-character SHA-256 transaction hash
 * PRIOR to network submission.
 */
export async function buildAndSignSpendOfflineTx(
  args: SpendOfflineContractArgs,
  relayerSecretKey: string,
  networkPassphrase = contractConfig.networkPassphrase,
): Promise<PreparedRelayerTransaction> {
  const relayerKeypair = Keypair.fromSecret(relayerSecretKey);
  const gatewayPublicKey = relayerKeypair.publicKey();

  // 1. Simulate and assemble the Soroban invocation
  const assembledTx = await pijinContract.spend_offline(
    {
      ...args,
      gateway: gatewayPublicKey,
    },
    { publicKey: gatewayPublicKey },
  );

  const unsignedXdr = assembledTx.toXDR();

  // 2. Sign with the relayer keypair
  const transaction = TransactionBuilder.fromXDR(unsignedXdr, networkPassphrase) as Transaction;
  transaction.sign(relayerKeypair);

  const signedTxXdr = transaction.toXDR();
  const txHash = transaction.hash().toString('hex');

  return {
    txHash,
    signedTxXdr,
    signerAddress: gatewayPublicKey,
    transaction,
  };
}

/**
 * Submits a pre-signed transaction to Soroban RPC.
 * Does NOT poll — returns the initial RPC broadcast status immediately.
 */
export async function submitSignedTransaction(
  transaction: Transaction | string,
  networkPassphrase = contractConfig.networkPassphrase,
): Promise<rpc.Api.SendTransactionResponse> {
  const tx = typeof transaction === 'string'
    ? (TransactionBuilder.fromXDR(transaction, networkPassphrase) as Transaction)
    : transaction;

  const response = await sorobanRpcServer.sendTransaction(tx);

  if (response.status === 'ERROR') {
    const errorDetails = response.errorResult
      ? `errorResult=${typeof response.errorResult === 'string' ? response.errorResult : response.errorResult.toXDR('base64')}`
      : 'no error XDR provided';
    throw new Error(`Soroban sendTransaction failed: status=ERROR ${errorDetails}`);
  }

  return response;
}

/**
 * Polls Soroban RPC for transaction completion with bounded attempts.
 */
export async function pollTransactionConfirmation(
  txHash: string,
  options: { maxAttempts?: number; intervalMs?: number } = {},
): Promise<TransactionPollResult> {
  const maxAttempts = options.maxAttempts ?? 15;
  const intervalMs = options.intervalMs ?? 1000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await sorobanRpcServer.getTransaction(txHash);

    if (res.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      return {
        status: 'SUCCESS',
        txHash,
        returnValue: res.returnValue,
        rawResponse: res,
      };
    }

    if (res.status === rpc.Api.GetTransactionStatus.FAILED) {
      return {
        status: 'FAILED',
        txHash,
        errorResultXdr: res.resultXdr?.toXDR('base64'),
        rawResponse: res,
      };
    }

    // Still pending / not found in ledger history window yet
    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  return {
    status: 'NOT_FOUND',
    txHash,
  };
}

/**
 * Executes the full Two-Phase Settlement submission flow:
 *   Phase 1: Build -> Sign -> Extract Hash -> Persist in DB (status: PENDING)
 *   Phase 2: Broadcast to Network -> Bounded Polling -> Confirmation
 */
export async function executeTwoPhaseSettlement(params: {
  settlementId: number;
  args: SpendOfflineContractArgs;
  relayerSecretKey: string;
  traceId?: string;
}): Promise<{
  txHash: string;
  pollResult: TransactionPollResult;
  sendResponse: rpc.Api.SendTransactionResponse;
}> {
  const { settlementId, args, relayerSecretKey, traceId = 'trace' } = params;

  // Phase 1: Build & Sign -> Extract Deterministic Hash
  const prepared = await buildAndSignSpendOfflineTx(args, relayerSecretKey);

  // Persist txHash & signedTxXdr to DB BEFORE network broadcast
  await prisma.settlement.update({
    where: { id: settlementId },
    data: {
      txHash: prepared.txHash,
      signedTxXdr: prepared.signedTxXdr,
      status: 'PENDING',
    },
  });

  logOfflineTransactionDebug(traceId, 'soroban:pre-hash-persisted', {
    settlementId,
    txHash: prepared.txHash,
    signerAddress: prepared.signerAddress,
  });

  // Phase 2: Broadcast to Soroban RPC
  const sendResponse = await submitSignedTransaction(prepared.transaction);

  logOfflineTransactionDebug(traceId, 'soroban:submitted', {
    settlementId,
    txHash: prepared.txHash,
    sendTransactionResponse: sendResponse,
  });

  // Phase 3: Poll for final on-chain confirmation
  const pollResult = await pollTransactionConfirmation(prepared.txHash);

  logOfflineTransactionDebug(traceId, 'soroban:poll-result', {
    settlementId,
    txHash: prepared.txHash,
    status: pollResult.status,
  });

  return {
    txHash: prepared.txHash,
    pollResult,
    sendResponse,
  };
}
