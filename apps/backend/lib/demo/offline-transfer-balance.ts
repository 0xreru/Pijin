export const PHPC_STROOPS_PER_UNIT = 10_000_000n;
export const OFFLINE_TRANSFER_TOLL_STROOPS = 5_000_000n;

export type OfflineTransferQuote = {
  amountStroops: bigint;
  requiredStroops: bigint;
  shortfallStroops: bigint;
};

export function parsePhpcToStroops(value: string): bigint | null {
  const match = /^(\d+)(?:\.(\d{1,7}))?$/.exec(value.trim());
  if (!match) return null;

  const whole = BigInt(match[1]);
  const fraction = BigInt((match[2] ?? '').padEnd(7, '0') || '0');
  const stroops = whole * PHPC_STROOPS_PER_UNIT + fraction;
  return stroops > 0n ? stroops : null;
}

export function quoteOfflineTransfer(
  amountPhpc: string,
  balanceStroops: bigint,
): OfflineTransferQuote | null {
  const amountStroops = parsePhpcToStroops(amountPhpc);
  if (amountStroops === null) return null;

  const requiredStroops = amountStroops + OFFLINE_TRANSFER_TOLL_STROOPS;
  return {
    amountStroops,
    requiredStroops,
    shortfallStroops:
      requiredStroops > balanceStroops ? requiredStroops - balanceStroops : 0n,
  };
}

export function formatPhpcStroops(stroops: bigint): string {
  const whole = stroops / PHPC_STROOPS_PER_UNIT;
  const fraction = (stroops % PHPC_STROOPS_PER_UNIT)
    .toString()
    .padStart(7, '0')
    .replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
