import AsyncStorage from '@react-native-async-storage/async-storage';
import { Address } from '@stellar/stellar-sdk';
import { ensureMigration } from './migration';

const STORAGE_KEY = 'pijn.offline_protocol_config';

export type OfflineProtocolConfig = {
  version: number;
  contractId: string;
  gatewayPublicKey: string;
  tokenContractId: string;
  tokenDbId: string;
  tokenSymbol: string;
  networkPassphrase: string;
};

function validate(config: OfflineProtocolConfig): OfflineProtocolConfig {
  if (config.version !== 1) throw new Error('Unsupported offline protocol configuration');
  Address.fromString(config.contractId);
  Address.fromString(config.gatewayPublicKey);
  Address.fromString(config.tokenContractId);
  if (!/^\d+$/.test(config.tokenDbId)) throw new Error('Invalid offline token database ID');
  if (!config.tokenSymbol || !config.networkPassphrase) {
    throw new Error('Incomplete offline protocol configuration');
  }
  return config;
}

export async function saveOfflineProtocolConfig(config: OfflineProtocolConfig): Promise<void> {
  await ensureMigration();
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(validate(config)));
}

export async function loadOfflineProtocolConfig(): Promise<OfflineProtocolConfig | null> {
  await ensureMigration();
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return validate(JSON.parse(raw) as OfflineProtocolConfig);
  } catch {
    return null;
  }
}

export async function clearOfflineProtocolConfig(): Promise<void> {
  await ensureMigration();
  await AsyncStorage.removeItem(STORAGE_KEY);
}
