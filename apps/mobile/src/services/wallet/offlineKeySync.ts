import { Keypair, TransactionBuilder } from '@stellar/stellar-sdk';
import { getApiBaseUrl } from '../../constants/api';
import {
  clearDeviceKeyEnrollment,
  getOrGenerateDeviceKeypair,
  markDeviceKeyEnrolled,
} from './deviceKeyStore';

type PrepareResponse =
  | { status: 'synced' }
  | { status: 'rotation_required'; xdr: string };

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim().replace(/^['"]|['"]$/g, '');
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

async function keyRequest<T>(
  method: 'POST' | 'PATCH',
  jwt: string,
  offlineDeviceKey: string,
): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}/api/engine/offline-key`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({ offlineDeviceKey }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.error ?? `Offline key synchronization failed (${response.status})`);
  }
  return body as T;
}

async function submitAndConfirm(xdrEnvelope: string, mainWallet: Keypair): Promise<void> {
  const rpcUrl = requiredEnv('EXPO_PUBLIC_SOROBAN_RPC_URL');
  const networkPassphrase = requiredEnv('EXPO_PUBLIC_STELLAR_NETWORK_PASSPHRASE');
  const transaction = TransactionBuilder.fromXDR(xdrEnvelope, networkPassphrase);
  transaction.sign(mainWallet);

  const submitted = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'sendTransaction',
      params: { transaction: transaction.toXDR() },
    }),
  }).then((response) => response.json());

  if (submitted.error || submitted.result?.status === 'ERROR') {
    throw new Error(
      submitted.error?.message ??
      `Offline key transaction was rejected: ${JSON.stringify(submitted.result)}`,
    );
  }

  const hash = submitted.result?.hash;
  if (!hash) throw new Error('Offline key transaction returned no hash');

  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 1500));
    const polled = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'getTransaction',
        params: { hash },
      }),
    }).then((response) => response.json());

    if (polled.error) throw new Error(polled.error.message ?? 'Could not confirm offline key transaction');
    if (polled.result?.status === 'SUCCESS') return;
    if (polled.result?.status === 'FAILED') {
      throw new Error(`Offline key transaction failed on-chain (${hash})`);
    }
  }

  throw new Error('Timed out waiting for offline key synchronization');
}

/**
 * Reconciles the local device public key with Soroban and the backend DB.
 * The main wallet signs any required rotation; the device secret never leaves
 * SecureStore.
 */
export async function synchronizeOfflineDeviceKey(
  mainWallet: Keypair,
  jwt: string,
): Promise<void> {
  const deviceKeypair = await getOrGenerateDeviceKeypair();
  const offlineDeviceKey = deviceKeypair.publicKey();
  await clearDeviceKeyEnrollment();
  const prepared = await keyRequest<PrepareResponse>('POST', jwt, offlineDeviceKey);

  if (prepared.status === 'rotation_required') {
    await submitAndConfirm(prepared.xdr, mainWallet);
    await keyRequest<{ status: 'synced' }>('PATCH', jwt, offlineDeviceKey);
  }

  await markDeviceKeyEnrolled(offlineDeviceKey);
}
