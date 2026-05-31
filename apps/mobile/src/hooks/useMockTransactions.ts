import { Transaction } from '../types/transaction';

// TODO: MVP placeholder only. Replace with Horizon payments or backend/Soroban escrow transaction history.
const recentTransactions: Transaction[] = [
  {
    id: 'family',
    title: 'Family',
    subtitle: 'Today, 7:24 AM',
    amount: -500,
    type: 'incoming',
  },
  {
    id: 'online-offline',
    title: 'Online to Offline',
    subtitle: 'Yesterday',
    amount: -376,
    type: 'transfer',
  },
];

const offlineTransactions: Transaction[] = [
  {
    id: 'sari-store',
    title: 'Sari-Sari Store',
    subtitle: 'Today, 08:24 AM',
    amount: -120,
    type: 'outgoing',
  },
  {
    id: 'wet-market',
    title: 'Wet Market',
    subtitle: 'Today, 01:30 AM',
    amount: -376,
    type: 'outgoing',
  },
];

export function useMockTransactions(scope: 'all' | 'offline' = 'all') {
  return scope === 'offline' ? offlineTransactions : recentTransactions;
}
