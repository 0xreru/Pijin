import { getApiBaseUrl } from '../../constants/api';
import {
  OfflineProtocolConfig,
  saveOfflineProtocolConfig,
} from '../storage/offlineProtocolStorage';
import { apiFetch } from '../api/client';

type RegistryResponse = {
  status: 'registered' | 'already_registered';
  txHash?: string;
  offlineConfig: OfflineProtocolConfig;
};

/** Ensure this account is payable by short ID and cache its offline signing configuration. */
export async function synchronizeRecipientRegistry(jwt: string): Promise<void> {
  const response = await apiFetch(`${getApiBaseUrl()}/api/engine/recipient-registry`, {
    timeoutMs: 25_000,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.error ?? `Recipient registry synchronization failed (${response.status})`);
  }
  const result = body as RegistryResponse;
  if (!result.offlineConfig) throw new Error('Recipient registry returned no offline configuration');
  await saveOfflineProtocolConfig(result.offlineConfig);
}
