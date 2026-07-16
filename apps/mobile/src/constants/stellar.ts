export const STELLAR_NETWORK_PASSPHRASE =
  (process.env.EXPO_PUBLIC_STELLAR_NETWORK_PASSPHRASE || '').trim().replace(/^['"]|['"]$/g, '') ||
  'Public Global Stellar Network ; September 2015';

export const HORIZON_URL = STELLAR_NETWORK_PASSPHRASE.includes('Public Global')
  ? 'https://horizon.stellar.org'
  : 'https://horizon-testnet.stellar.org';

export const SOROBAN_RPC_URL =
  (process.env.EXPO_PUBLIC_SOROBAN_RPC_URL || '').trim().replace(/^['"]|['"]$/g, '') ||
  'https://rpc.lightsail.network';

export const CONTRACT_ID = (process.env.EXPO_PUBLIC_CONTRACT_ID || '').trim().replace(/^['"]|['"]$/g, '');

export const TOKEN_ID = (process.env.EXPO_PUBLIC_TOKEN_ID || '').trim().replace(/^['"]|['"]$/g, '');

export const TOKEN_DB_ID = (process.env.EXPO_PUBLIC_TOKEN_DB_ID || '').trim().replace(/^['"]|['"]$/g, '') || '1';

export const STROOPS_PER_XLM = 10_000_000;

export function xlmToStroops(amountXlm: number): bigint {
  return BigInt(Math.round(amountXlm * STROOPS_PER_XLM));
}

export function stroopsToXlm(stroops: bigint | string): number {
  return Number(stroops) / STROOPS_PER_XLM;
}

// Backward-compatible aliases for old naming.
export const STROOPS_PER_PHP = STROOPS_PER_XLM;
export const phpToStroops = xlmToStroops;
export const stroopsToPhp = stroopsToXlm;
