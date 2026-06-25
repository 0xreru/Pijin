import { apiRequest } from './client';

export type SettlementRecord = {
  id: number;
  nonce: string;
  customerShortId: string;
  merchantShortId: string;
  amountPhp: string;
  txHash: string | null;
  status: string;
  createdAt: string;
};

type TransactionsResponse = {
  success: boolean;
  data: SettlementRecord[];
};

export async function getUserSettlements(
  shortId: string
): Promise<SettlementRecord[]> {
  const query = new URLSearchParams({ shortId });
  const result = await apiRequest<TransactionsResponse>(
    `/api/transactions?${query.toString()}`
  );
  return result.data;
}

