export type DemoSettlementState =
  | 'NOT_FOUND'
  | 'PENDING'
  | 'SETTLED'
  | 'FAILED';

export type DemoSettlementStatus = {
  status: DemoSettlementState;
  txHash: string | null;
  failureReason: string | null;
};

export function isDemoSettlementNonce(value: string): boolean {
  return /^[A-Za-z0-9+/]{43}$/.test(value);
}

export function isDemoShortId(value: string): boolean {
  return /^[0-9A-Za-z]{6}$/.test(value);
}

export function stellarExpertTestnetTxUrl(txHash: string): string | null {
  if (!/^[0-9a-fA-F]{64}$/.test(txHash)) return null;
  return `https://stellar.expert/explorer/testnet/tx/${txHash}`;
}
