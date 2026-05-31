// @ts-nocheck
import { Buffer } from 'buffer';

if (typeof global.Buffer === 'undefined') {
  global.Buffer = Buffer;
}

const {
  rpc,
  xdr,
  TransactionBuilder,
  Account,
  Address,
  nativeToScVal,
  Contract,
} = require('@stellar/stellar-sdk');

import {
  CONTRACT_ID,
  SOROBAN_RPC_URL,
  STELLAR_NETWORK_PASSPHRASE,
  TOKEN_ID,
  xlmToStroops,
} from '../../constants/stellar';
import { STELLAR_HORIZON_MAINNET_URL } from '../../constants/network';
import { signTransactionXdr } from '../wallet/walletConnector';

function assertContractConfig() {
  if (!CONTRACT_ID || !TOKEN_ID) {
    throw new Error(
      'Missing EXPO_PUBLIC_CONTRACT_ID or EXPO_PUBLIC_TOKEN_ID in apps/mobile/.env'
    );
  }
}

export async function depositToVault(input: {
  customerPublicKey: string;
  amountXlm: number;
  onStage?: (stage: DepositStage) => void;
}): Promise<{ hash?: string }> {
  assertContractConfig();
  const startedAt = Date.now();
  const markStage = (stage: DepositStage) => {
    input.onStage?.(stage);
    console.log(`[deposit] stage=${stage} elapsedMs=${Date.now() - startedAt}`);
  };
  markStage('load-account');

  const server = new rpc.Server(SOROBAN_RPC_URL, { allowHttp: true });
  const sequenceNumber = await resolveAccountSequence(
    server,
    input.customerPublicKey
  );
  if (sequenceNumber === '0') {
    throw new Error('Account not found on Horizon. Fund account first.');
  }

  const sourceAccount = new Account(input.customerPublicKey, sequenceNumber);
  const contract = new Contract(CONTRACT_ID);

  let tx = new TransactionBuilder(sourceAccount, {
    fee: '1000',
    networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        'deposit',
        new Address(input.customerPublicKey).toScVal(),
        new Address(TOKEN_ID).toScVal(),
        nativeToScVal(xlmToStroops(input.amountXlm), { type: 'i128' })
      )
    )
    .setTimeout(180)
    .build();

  let unsignedXdr: string;
  markStage('build-xdr');
  try {
    unsignedXdr = encodeTransactionEnvelopeBase64(tx);
    xdr.TransactionEnvelope.fromXDR(unsignedXdr, 'base64');
  } catch (error) {
    throw new Error(`Deposit stage build-xdr failed: ${String(error)}`);
  }

  let simulation;
  markStage('simulate');
  try {
    simulation = await simulateTransactionRaw(unsignedXdr);
    if (simulation.error) {
      throw new Error(`Simulation failed: ${simulation.error}`);
    }
  } catch (error) {
    throw new Error(`Deposit stage simulate failed: ${String(error)}`);
  }

  markStage('assemble');
  try {
    tx = rpc.assembleTransaction(tx, simulation).build();
  } catch (error) {
    throw new Error(`Deposit stage assemble failed: ${String(error)}`);
  }

  let safeBase64Xdr: string;
  markStage('prepare-sign');
  try {
    safeBase64Xdr = encodeTransactionEnvelopeBase64(tx);
    xdr.TransactionEnvelope.fromXDR(safeBase64Xdr, 'base64');
  } catch (error) {
    throw new Error(`Deposit stage prepare-sign failed: ${String(error)}`);
  }

  let signedXdr: string;
  markStage('wallet-sign');
  try {
    signedXdr = await signTransactionXdr(
      safeBase64Xdr,
      input.customerPublicKey,
      STELLAR_NETWORK_PASSPHRASE
    );
  } catch (error) {
    throw new Error(`Deposit stage wallet-sign failed: ${String(error)}`);
  }

  let sendResponse;
  markStage('send');
  try {
    sendResponse = await sendTransactionRaw(signedXdr);
  } catch (error) {
    throw new Error(`Deposit stage send failed: ${String(error)}`);
  }
  if (sendResponse.errorResultXdr) {
    throw new Error(`Transaction rejected by network. status=${sendResponse.status}`);
  }

  return { hash: sendResponse.hash };
}

export async function waitForTransaction(hash: string): Promise<void> {
  const server = new rpc.Server(SOROBAN_RPC_URL, { allowHttp: true });
  while (true) {
    const response = await server.getTransaction(hash);
    if (response.status !== 'NOT_FOUND') {
      if (response.status !== 'SUCCESS') {
        throw new Error(`Transaction failed: ${response.status}`);
      }
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

async function resolveAccountSequence(server, publicKey) {
  const horizonSequence = await fetchHorizonSequence(publicKey);
  if (horizonSequence) return horizonSequence;
  return '0';
}

async function fetchHorizonSequence(publicKey) {
  try {
    const response = await fetch(`${STELLAR_HORIZON_MAINNET_URL}/accounts/${publicKey}`);
    if (response.status === 404) return null;
    if (!response.ok) return null;
    const data = await response.json();
    return typeof data.sequence === 'string' ? data.sequence : null;
  } catch (error) {
    return null;
  }
}

async function simulateTransactionRaw(transactionXdr: string) {
  const payload = {
    jsonrpc: '2.0',
    id: 1,
    method: 'simulateTransaction',
    params: {
      transaction: transactionXdr,
    },
  };

  const response = await fetch(SOROBAN_RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`RPC simulate HTTP ${response.status}`);
  }

  const json = await response.json();
  if (json.error) {
    throw new Error(json.error.message || 'simulateTransaction RPC error');
  }
  if (!json.result) {
    throw new Error('simulateTransaction missing result');
  }

  return json.result;
}

async function sendTransactionRaw(transactionXdr: string) {
  const payload = {
    jsonrpc: '2.0',
    id: 1,
    method: 'sendTransaction',
    params: {
      transaction: transactionXdr,
    },
  };

  const response = await fetch(SOROBAN_RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`RPC send HTTP ${response.status}`);
  }

  const json = await response.json();
  if (json.error) {
    throw new Error(json.error.message || 'sendTransaction RPC error');
  }
  if (!json.result) {
    throw new Error('sendTransaction missing result');
  }

  return json.result;
}

function encodeTransactionEnvelopeBase64(tx: any): string {
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

export type DepositStage =
  | 'load-account'
  | 'build-xdr'
  | 'simulate'
  | 'assemble'
  | 'prepare-sign'
  | 'wallet-sign'
  | 'send';
