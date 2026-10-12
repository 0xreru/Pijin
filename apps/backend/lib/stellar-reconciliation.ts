/**
 * @file lib/stellar-reconciliation.ts
 *
 * Retry Reconciliation Engine & On-Chain Registry Pre-Flight Validation.
 *
 * Responsibilities:
 *  1. Reconcile ambiguous RPC outcomes (timeouts, pending transactions, network drops)
 *     and duplicate deliveries via a 3-phase check:
 *       - Phase A: Query Soroban RPC for `txHash` (status: SUCCESS -> SETTLED).
 *       - Phase B: Query Soroban Contract Storage for `DataKey::Nonce(nonce)` via `getLedgerEntries()`.
 *                  If nonce is committed on-chain, transaction succeeded (even if pruned by RPC) -> SETTLED.
 *       - Phase C: If nonce is missing on-chain, it is safe to retry without risking duplicate spend.
 *  2. Disambiguate `NonceReplayed` contract errors.
 *  3. On-chain recipient registry pre-flight verification & optional auto-registration.
 */

import {
  Address,
  Keypair,
  Transaction,
  TransactionBuilder,
  rpc,
  xdr,
} from '@stellar/stellar-sdk';
import { contractConfig, pijinContract, sorobanRpcServer } from '@/lib/pijin-contract';
import { prisma } from '@/lib/prisma';
import { restoreBase64Padding } from '@/lib/offline-voucher';
import { pollTransactionConfirmation } from '@/lib/stellar-transaction-manager';
import { logOfflineTransactionDebug } from '@/lib/offline-transaction-debug';

export interface SettlementCandidate {
  id: number;
  nonce: string;
  txHash?: string | null;
  status?: string;
  amountStroops?: bigint;
}

export type ReconciliationResult =
  | {
      status: 'SETTLED';
      source: 'RPC_TX_SUCCESS' | 'CONTRACT_STORAGE_NONCE';
      txHash?: string | null;
    }
  | {
      status: 'SAFE_TO_RETRY';
      reason: string;
      txHash?: string | null;
    }
  | {
      status: 'FAILED';
      reason: string;
      errorResultXdr?: string;
    };

/**
 * Builds the persistent contract storage `LedgerKey` for `DataKey::Nonce(BytesN<32>)`.
 */
export function buildNonceLedgerKey(
  nonce: Buffer | string,
  contractId = contractConfig.contractId,
): xdr.LedgerKey {
  const nonceBuffer =
    typeof nonce === 'string'
      ? Buffer.from(restoreBase64Padding(nonce), 'base64')
      : nonce;

  if (nonceBuffer.length !== 32) {
    throw new Error(`Nonce must be exactly 32 bytes, got ${nonceBuffer.length}`);
  }

  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: Address.fromString(contractId).toScAddress(),
      key: xdr.ScVal.scvVec([
        xdr.ScVal.scvSymbol('Nonce'),
        xdr.ScVal.scvBytes(nonceBuffer),
      ]),
      durability: xdr.ContractDataDurability.persistent(),
    }),
  );
}

/**
 * Queries Soroban RPC contract storage to check whether a specific nonce has
 * already been committed to the contract state.
 */
export async function isNonceCommittedOnChain(
  nonce: Buffer | string,
  contractId = contractConfig.contractId,
): Promise<boolean> {
  const ledgerKey = buildNonceLedgerKey(nonce, contractId);
  try {
    const response = await sorobanRpcServer.getLedgerEntries(ledgerKey);
    return Boolean(response.entries && response.entries.length > 0);
  } catch (err) {
    console.warn('[Reconciliation] Failed to query getLedgerEntries for nonce:', err);
    return false;
  }
}

/**
 * Reconciles an existing or ambiguous settlement record against Soroban state.
 *
 * Phase A: If `txHash` exists, call `sorobanRpcServer.getTransaction(txHash)`.
 *          If SUCCESS, update DB to SETTLED and return.
 * Phase B: If NOT_FOUND or missing hash, query contract storage for `DataKey::Nonce(nonce)`.
 *          If nonce exists on-chain, transaction succeeded (pruned by RPC) -> update DB to SETTLED.
 * Phase C: If nonce is missing on-chain, it is safe to retry.
 */
export async function reconcileExistingSettlement(
  candidate: SettlementCandidate,
  traceId = 'reconcile',
): Promise<ReconciliationResult> {
  const { id, nonce, txHash } = candidate;

  // ── Phase A: Inspect Recorded Transaction Hash via RPC ─────────────────────
  if (txHash) {
    try {
      const txResponse = await sorobanRpcServer.getTransaction(txHash);

      if (txResponse.status === rpc.Api.GetTransactionStatus.SUCCESS) {
        await prisma.settlement.update({
          where: { id },
          data: { status: 'SETTLED', failReason: null },
        });

        logOfflineTransactionDebug(traceId, 'reconcile:rpc-success', {
          settlementId: id,
          txHash,
          source: 'RPC_TX_SUCCESS',
        });

        return {
          status: 'SETTLED',
          source: 'RPC_TX_SUCCESS',
          txHash,
        };
      }

      if (txResponse.status === rpc.Api.GetTransactionStatus.FAILED) {
        logOfflineTransactionDebug(traceId, 'reconcile:rpc-failed-candidate', {
          settlementId: id,
          txHash,
        });
      }
    } catch (rpcErr) {
      console.warn(`[Reconciliation] getTransaction threw for txHash=${txHash}:`, rpcErr);
    }
  }

  // ── Phase B: Query Contract Storage for Nonce Entry ─────────────────────────
  try {
    const nonceCommitted = await isNonceCommittedOnChain(nonce);

    if (nonceCommitted) {
      await prisma.settlement.update({
        where: { id },
        data: { status: 'SETTLED', failReason: null },
      });

      logOfflineTransactionDebug(traceId, 'reconcile:storage-nonce-found', {
        settlementId: id,
        nonce,
        txHash,
        source: 'CONTRACT_STORAGE_NONCE',
      });

      return {
        status: 'SETTLED',
        source: 'CONTRACT_STORAGE_NONCE',
        txHash,
      };
    }
  } catch (storageErr) {
    console.warn(`[Reconciliation] Nonce storage lookup failed for settlementId=${id}:`, storageErr);
  }

  // ── Phase C: Nonce Missing On-Chain -> Safe to Retry ─────────────────────────
  logOfflineTransactionDebug(traceId, 'reconcile:safe-to-retry', {
    settlementId: id,
    nonce,
    txHash,
  });

  return {
    status: 'SAFE_TO_RETRY',
    reason: 'Nonce is not committed on-chain; transaction was not included in ledger.',
    txHash,
  };
}

export interface RegistryCheckResult {
  exists: boolean;
  autoRegistered: boolean;
  receiverAddress?: string;
  error?: string;
}

/**
 * Phase 2.4: Pre-Flight On-Chain Registry Check
 *
 * Verifies that the recipient short ID is registered on the Pijin smart contract
 * before spending gas on `spend_offline`. If missing, attempts automatic on-chain
 * registration using the configured `REGISTRAR_SECRET_KEY`.
 */
export async function verifyOrRegisterRecipientOnChain(params: {
  shortId: string;
  stellarPublicKey: string;
  autoRegister?: boolean;
  registrarSecretKey?: string;
  traceId?: string;
}): Promise<RegistryCheckResult> {
  const {
    shortId,
    stellarPublicKey,
    autoRegister = true,
    registrarSecretKey = process.env.REGISTRAR_SECRET_KEY?.trim(),
    traceId = 'registry',
  } = params;

  const shortIdBytes = Buffer.from(shortId, 'ascii');

  // 1. Simulate get_recipient on smart contract
  try {
    const queryTx = await pijinContract.get_recipient({ short_id: shortIdBytes });
    const existingAddress = queryTx.result as string | null | undefined;

    if (existingAddress) {
      if (existingAddress === stellarPublicKey) {
        return {
          exists: true,
          autoRegistered: false,
          receiverAddress: existingAddress,
        };
      }

      // Address mismatch on-chain
      return {
        exists: false,
        autoRegistered: false,
        receiverAddress: existingAddress,
        error: `Short ID ${shortId} is bound to ${existingAddress}, expected ${stellarPublicKey}`,
      };
    }
  } catch (queryErr) {
    console.warn(`[Registry] get_recipient simulation threw for shortId=${shortId}:`, queryErr);
  }

  // 2. Not found on-chain: Attempt Auto-Registration if permitted
  if (!autoRegister || !registrarSecretKey) {
    return {
      exists: false,
      autoRegistered: false,
      error: `Short ID ${shortId} is not registered on-chain and auto-registration is disabled or unconfigured.`,
    };
  }

  try {
    const registrarKeypair = Keypair.fromSecret(registrarSecretKey);
    const registrarPub = registrarKeypair.publicKey();

    logOfflineTransactionDebug(traceId, 'registry:auto-register-start', {
      shortId,
      stellarPublicKey,
      registrarPublicKey: registrarPub,
    });

    const assembled = await pijinContract.register_recipient(
      {
        registrar: registrarPub,
        short_id: shortIdBytes,
        receiver: stellarPublicKey,
      },
      { publicKey: registrarPub },
    );

    const unsignedXdr = assembled.toXDR();
    const transaction = TransactionBuilder.fromXDR(
      unsignedXdr,
      contractConfig.networkPassphrase,
    ) as Transaction;
    transaction.sign(registrarKeypair);

    const sendRes = await sorobanRpcServer.sendTransaction(transaction);
    if (sendRes.status === 'ERROR') {
      const errDetails = sendRes.errorResult
        ? (typeof sendRes.errorResult === 'string' ? sendRes.errorResult : sendRes.errorResult.toXDR('base64'))
        : 'unknown error';
      throw new Error(`Registrar sendTransaction failed: status=ERROR ${errDetails}`);
    }

    const txHash = transaction.hash().toString('hex');
    const pollResult = await pollTransactionConfirmation(txHash, { maxAttempts: 15, intervalMs: 1000 });

    if (pollResult.status !== 'SUCCESS') {
      throw new Error(`Auto-registration polling finished with status: ${pollResult.status}`);
    }

    logOfflineTransactionDebug(traceId, 'registry:auto-register-success', {
      shortId,
      stellarPublicKey,
      txHash,
    });

    return {
      exists: true,
      autoRegistered: true,
      receiverAddress: stellarPublicKey,
    };
  } catch (regErr) {
    const errorMsg = regErr instanceof Error ? regErr.message : String(regErr);
    console.error(`[Registry] Failed to auto-register recipient ${shortId}:`, errorMsg);
    return {
      exists: false,
      autoRegistered: false,
      error: errorMsg,
    };
  }
}
