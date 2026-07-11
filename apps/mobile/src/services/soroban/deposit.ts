import { Buffer } from 'buffer';
import {
  rpc,
  xdr,
  TransactionBuilder,
  Transaction,
  Account,
  Address,
  nativeToScVal,
  Contract,
  StrKey,
} from '@stellar/stellar-sdk';

import {
  CONTRACT_ID,
  SOROBAN_RPC_URL,
  STELLAR_NETWORK_PASSPHRASE,
  TOKEN_ID,
  xlmToStroops,
  HORIZON_URL,
} from '../../constants/stellar';
import { getOrGenerateDeviceKeypair } from '../wallet/deviceKeyStore';

// Ensure Buffer is available globally for XDR serialization in Hermes.
if (typeof global.Buffer === 'undefined') {
  global.Buffer = Buffer;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max polling rounds before declaring the transaction timed out. */
const POLL_MAX_ATTEMPTS = 15;

/** Milliseconds between each polling round. */
const POLL_INTERVAL_MS = 2_000;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type DepositStage =
  | 'load-account'
  | 'build-xdr'
  | 'simulate'
  | 'assemble'
  | 'prepare-sign'
  | 'wallet-sign'
  | 'send';

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

function assertContractConfig(): void {
  if (!CONTRACT_ID || !TOKEN_ID) {
    throw new Error(
      'Missing EXPO_PUBLIC_CONTRACT_ID or EXPO_PUBLIC_TOKEN_ID in apps/mobile/.env'
    );
  }
}

// ---------------------------------------------------------------------------
// Core deposit lifecycle
// ---------------------------------------------------------------------------

/**
 * Executes the full Soroban deposit lifecycle:
 *   load-account → build-xdr → simulate → assemble → prepare-sign → wallet-sign → send
 *
 * Returns the transaction hash on success so the caller can poll with
 * `waitForTransaction`.
 */
export async function depositToVault(input: {
  customerPublicKey: string;
  offlineDevicePublicKey: string;
  amountPhp: number;
  onStage?: (stage: DepositStage) => void;
}): Promise<{ hash?: string }> {
  assertContractConfig();

  const startedAt = Date.now();
  const markStage = (stage: DepositStage): void => {
    input.onStage?.(stage);
    console.log(`[deposit] stage=${stage} elapsedMs=${Date.now() - startedAt}`);
  };

  const server = new rpc.Server(SOROBAN_RPC_URL, { allowHttp: true });

  // ── 1. Resolve account sequence ────────────────────────────────────────
  markStage('load-account');
  const sequenceNumber = await resolveAccountSequence(input.customerPublicKey);
  if (sequenceNumber === '0') {
    throw new Error('Account not found on Horizon. Fund account first.');
  }

  const sourceAccount = new Account(input.customerPublicKey, sequenceNumber);
  const contract = new Contract(CONTRACT_ID);

  // ── 2. Build unsigned transaction ──────────────────────────────────────
  markStage('build-xdr');
  const pubkeyRaw = StrKey.decodeEd25519PublicKey(input.offlineDevicePublicKey);
  const pubkeyScVal = xdr.ScVal.scvBytes(Buffer.from(pubkeyRaw));

  let tx: Transaction = new TransactionBuilder(sourceAccount, {
    fee: '1000',
    networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        'deposit',
        new Address(input.customerPublicKey).toScVal(),
        new Address(TOKEN_ID).toScVal(),
        pubkeyScVal,
        nativeToScVal(xlmToStroops(input.amountPhp), { type: 'i128' })
      )
    )
    .setTimeout(180)
    .build();

  // Validate the XDR is well-formed before proceeding.
  try {
    const unsignedXdr = encodeTransactionEnvelopeBase64(tx);
    xdr.TransactionEnvelope.fromXDR(unsignedXdr, 'base64');
  } catch (error) {
    throw new Error(`Deposit stage build-xdr failed: ${String(error)}`);
  }

  // ── 3. Simulate via SDK ────────────────────────────────────────────────
  markStage('simulate');
  let simulation: rpc.Api.SimulateTransactionResponse;
  try {
    simulation = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(simulation)) {
      throw new Error(`Simulation failed: ${simulation.error}`);
    }
  } catch (error) {
    throw new Error(`Deposit stage simulate failed: ${String(error)}`);
  }

  // ── 4. Assemble (attach resource fees + footprint) ─────────────────────
  markStage('assemble');
  try {
    tx = rpc.assembleTransaction(tx, simulation).build();
  } catch (error) {
    throw new Error(`Deposit stage assemble failed: ${String(error)}`);
  }

  // ── 5. Encode assembled XDR for wallet signing ─────────────────────────
  markStage('prepare-sign');
  let safeBase64Xdr: string;
  try {
    safeBase64Xdr = encodeTransactionEnvelopeBase64(tx);
    // Validate the assembled XDR round-trips correctly.
    xdr.TransactionEnvelope.fromXDR(safeBase64Xdr, 'base64');
  } catch (error) {
    throw new Error(`Deposit stage prepare-sign failed: ${String(error)}`);
  }

  // ── 6. Request wallet signature ────────────────────────────────────────
  markStage('wallet-sign');
  let signedXdrBase64: string;
  try {
    const deviceKeypair = await getOrGenerateDeviceKeypair();
    const devicePublicKey = deviceKeypair.publicKey();
    if (devicePublicKey !== input.customerPublicKey) {
      throw new Error(
        `Keypair mismatch: Device public key is ${devicePublicKey}, but input public key is ${input.customerPublicKey}`
      );
    }

    const signedTx = TransactionBuilder.fromXDR(safeBase64Xdr, STELLAR_NETWORK_PASSPHRASE) as Transaction;
    signedTx.sign(deviceKeypair);
    signedXdrBase64 = encodeTransactionEnvelopeBase64(signedTx);
  } catch (error) {
    throw new Error(`Deposit stage wallet-sign failed: ${String(error)}`);
  }

  // ── 7. Dispatch via SDK ────────────────────────────────────────────────
  markStage('send');
  try {
    // Deserialize the signed XDR back into a Transaction object so the SDK
    // can dispatch it via its own typed sendTransaction method.
    const signedTx = TransactionBuilder.fromXDR(
      signedXdrBase64,
      STELLAR_NETWORK_PASSPHRASE
    ) as Transaction;

    const sendResponse = await server.sendTransaction(signedTx);

    if (sendResponse.status === 'ERROR') {
      throw new Error(
        `Transaction rejected by network. errorResult=${sendResponse.errorResult?.toXDR('base64') ?? 'unknown'}`
      );
    }

    return { hash: sendResponse.hash };
  } catch (error) {
    throw new Error(`Deposit stage send failed: ${String(error)}`);
  }
}

// ---------------------------------------------------------------------------
// Transaction status polling
// ---------------------------------------------------------------------------

/**
 * Polls the Soroban RPC for the final status of a submitted transaction.
 *
 * Caps polling at `POLL_MAX_ATTEMPTS` rounds (default: 15 × 2 s = 30 s) to
 * prevent infinite CPU spin and battery drain if the ledger drops the
 * transaction.
 *
 * @throws If the transaction fails, or if it is still NOT_FOUND after timeout.
 */
export async function waitForTransaction(hash: string): Promise<void> {
  const server = new rpc.Server(SOROBAN_RPC_URL, { allowHttp: true });

  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt += 1) {
    const response = await server.getTransaction(hash);

    if (response.status !== 'NOT_FOUND') {
      if (response.status !== 'SUCCESS') {
        throw new Error(`Transaction failed with status: ${response.status}`);
      }
      return; // SUCCESS – exit cleanly.
    }

    // Still pending – wait before next poll.
    await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(
    `Transaction ${hash} not confirmed after ${POLL_MAX_ATTEMPTS * (POLL_INTERVAL_MS / 1000)} seconds. ` +
      'The network may be congested. Check the transaction status manually.'
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolves the current sequence number for a Stellar account from Horizon.
 * Returns `'0'` when the account does not yet exist on-ledger.
 */
async function resolveAccountSequence(publicKey: string): Promise<string> {
  const horizonSequence = await fetchHorizonSequence(publicKey);
  return horizonSequence ?? '0';
}

async function fetchHorizonSequence(publicKey: string): Promise<string | null> {
  try {
    const response = await fetch(`${HORIZON_URL}/accounts/${publicKey}`);
    if (response.status === 404) return null;
    if (!response.ok) return null;
    const data = (await response.json()) as { sequence?: unknown };
    return typeof data.sequence === 'string' ? data.sequence : null;
  } catch {
    return null;
  }
}

/**
 * Serializes a built `Transaction` into a base64-encoded XDR envelope string
 * suitable for wallet signing or RPC dispatch.
 */
function encodeTransactionEnvelopeBase64(tx: Transaction): string {
  const raw = tx.toEnvelope().toXDR();
  const bytes = toUint8Array(raw);
  return Buffer.from(bytes).toString('base64');
}

function toUint8Array(raw: unknown): Uint8Array {
  if (raw instanceof Uint8Array) {
    return raw;
  }
  if (typeof raw === 'string') {
    // js-xdr may return a binary string (1 char = 1 byte).
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) {
      out[i] = raw.charCodeAt(i) & 0xff;
    }
    return out;
  }
  return new Uint8Array(raw as ArrayLike<number>);
}
