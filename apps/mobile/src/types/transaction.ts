export type TransactionType = 'incoming' | 'outgoing' | 'transfer' | 'settlement';

export type Transaction = {
  id: string;
  title: string;
  subtitle: string;
  amount: number;
  displayAmount?: string;
  type: TransactionType;
};

export type SettlementStep = {
  label: string;
  status: 'done' | 'active' | 'pending';
};
