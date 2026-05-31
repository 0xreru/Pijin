export type WalletMode = 'personal' | 'merchant';

export type WalletBalance = {
  label: string;
  amount: number;
  tone: 'online' | 'offline';
};
