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
  if (!result || result.success !== true) {
    throw new Error('[getUserSettlements] API responded with success: false');
  }
  return result.data;
}

export interface TransactionHistoryItem {
  id: string;
  type: 'SEND' | 'RECEIVE' | 'TRANSFER' | 'WITHDRAWAL';
  tag: 'WALLET' | 'OFFLINE';
  title: string;
  amount: string;
  assetCode: string;
  status: string;
  timestamp: string;
  txHash?: string;
}

interface OnlineTransferConfirmationResponse {
  txHash: string;
  status: 'PENDING' | 'SETTLED' | 'FAILED';
  confirmedAt?: string;
}

interface WalletHistoryResponse {
  transactions: TransactionHistoryItem[];
}

export async function getWalletHistory(
  shortId: string,
  publicKey: string
): Promise<TransactionHistoryItem[]> {
  const query = new URLSearchParams({ shortId, publicKey });
  const result = await apiRequest<WalletHistoryResponse>(
    `/api/wallet/history?${query.toString()}`
  );
  if (!result || !Array.isArray(result.transactions)) {
    throw new Error('[getWalletHistory] API responded with invalid transactions list');
  }
  return result.transactions;
}

export async function confirmOnlineTransfer(
  txHash: string
): Promise<OnlineTransferConfirmationResponse> {
  return apiRequest<OnlineTransferConfirmationResponse>(
    '/api/wallet/transfers/confirm',
    {
      method: 'POST',
      body: JSON.stringify({ txHash }),
    }
  );
}


