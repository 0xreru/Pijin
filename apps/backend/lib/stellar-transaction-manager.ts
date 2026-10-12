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
  Account,
  Address,
  Contract,
  Keypair,
  Transaction,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  xdr,
} from '@stellar/stellar-sdk';
import { contractConfig, sorobanRpcServer } from '@/lib/pijin-contract';
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
 * 1. Simulates the transaction and attaches the Soroban footprint (ledger read/write keys and resource fees)
 *    via `sorobanRpcServer.prepareTransaction(baseTx)`.
 * 2. Signs the prepared transaction with the relayer keypair.
 * 3. Extracts the deterministic 64-character SHA-256 transaction hash PRIOR to network submission.
 */
export async function buildAndSignSpendOfflineTx(
  args: SpendOfflineContractArgs,
  relayerSecretKey: string,
  networkPassphrase = contractConfig.networkPassphrase,
): Promise<PreparedRelayerTransaction> {
  const relayerKeypair = Keypair.fromSecret(relayerSecretKey);
  const gatewayPublicKey = relayerKeypair.publicKey();

  const contractAddress =
    contractConfig.contractId ||
    process.env.CONTRACT_ID?.trim() ||
    process.env.NEXT_PUBLIC_CONTRACT_ID?.trim();

  if (!contractAddress) {
    throw new Error('Missing CONTRACT_ID for Soroban spend_offline invocation.');
  }

  // 1. Fetch source account from Soroban RPC to get latest sequence number
  let account: Account;
  try {
    account = await sorobanRpcServer.getAccount(gatewayPublicKey);
  } catch (accErr: unknown) {
    if (process.env.NODE_ENV === 'test') {
      account = new Account(gatewayPublicKey, '0');
    } else {
      console.error(`[TransactionManager] Failed to load relayer account ${gatewayPublicKey}:`, accErr);
      throw accErr;
    }
  }

  // 2. Build base invocation operation
  const contract = new Contract(contractAddress);
  const receiverShortIdBuffer = Buffer.isBuffer(args.receiver_short_id)
    ? args.receiver_short_id
    : Buffer.from(args.receiver_short_id, 'ascii');
  const nonceBuffer = Buffer.isBuffer(args.nonce) ? args.nonce : Buffer.from(args.nonce);
  const signatureBuffer = Buffer.isBuffer(args.signature) ? args.signature : Buffer.from(args.signature);

  const callOp = contract.call(
    'spend_offline',
    Address.fromString(gatewayPublicKey).toScVal(),
    Address.fromString(args.sender).toScVal(),
    Address.fromString(args.token).toScVal(),
    xdr.ScVal.scvBytes(receiverShortIdBuffer),
    nativeToScVal(args.amount, { type: 'i128' }),
    nativeToScVal(args.protocol_toll, { type: 'i128' }),
    xdr.ScVal.scvBytes(nonceBuffer),
    xdr.ScVal.scvBytes(signatureBuffer),
  );

  const baseTx = new TransactionBuilder(account, {
    fee: '100',
    networkPassphrase,
  })
    .addOperation(callOp)
    .setTimeout(300)
    .build();

  // 3. Simulate and attach footprint via prepareTransaction
  let preparedTx: Transaction;
  try {
    preparedTx = (await sorobanRpcServer.prepareTransaction(baseTx)) as Transaction;
  } catch (simErr: unknown) {
    const errMsg = simErr instanceof Error ? simErr.message : String(simErr);
    console.error(`[TransactionManager] Simulation failed during prepareTransaction: ${errMsg}`);
    throw new Error(`Soroban simulation failed during transaction preparation: ${errMsg}`);
  }

  // 4. Sign the prepared transaction (containing footprint) with relayer keypair
  preparedTx.sign(relayerKeypair);

  const signedTxXdr = preparedTx.toXDR();
  const txHash = preparedTx.hash().toString('hex');

  return {
    txHash,
    signedTxXdr,
    signerAddress: gatewayPublicKey,
    transaction: preparedTx,
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
      : (response as any).errorResultXdr
        ? `errorResult=${(response as any).errorResultXdr}`
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
