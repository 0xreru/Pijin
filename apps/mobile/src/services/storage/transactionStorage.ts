import AsyncStorage from '@react-native-async-storage/async-storage';
import { TransactionType } from '../../types/transaction';

const STORAGE_KEY = 'abotpera.transactions_v1';

export interface StoredTransaction {
  id: string;
  title: string;
  subtitle: string;
  amount: number;
  type: TransactionType;
  tag: 'WALLET' | 'OFFLINE';
  dateGroup: string;
  timeAgo: string;
  description: string;
  createdAt: string;
}

const DEFAULT_TRANSACTIONS: StoredTransaction[] = [
  {
    id: 'deposit-1',
    title: 'Deposited from G-Xchange Inc. / Gcash',
    subtitle: 'Today, 06:13 PM',
    amount: 25000,
    type: 'incoming',
    tag: 'WALLET',
    dateGroup: 'June 03, 2026',
    timeAgo: '1 day ago',
    description: 'You deposited ₱25,000.00 using G-Xchange Inc. / GCash account ending in 8245 via Pijin.',
    createdAt: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    id: 'family-1',
    title: 'Family Support',
    subtitle: 'Today, 7:24 AM',
    amount: 500,
    type: 'incoming',
    tag: 'WALLET',
    dateGroup: 'June 03, 2026',
    timeAgo: '1 day ago',
    description: 'Received support funds of ₱500.00 from family.',
    createdAt: new Date(Date.now() - 3600000 * 10).toISOString(),
  },
  {
    id: 'online-offline-1',
    title: 'Online to Offline Transfer',
    subtitle: 'Yesterday, 02:30 PM',
    amount: -376,
    type: 'transfer',
    tag: 'WALLET',
    dateGroup: 'June 02, 2026',
    timeAgo: '2 days ago',
    description: 'Moved ₱376.00 from online wallet to offline vault.',
    createdAt: new Date(Date.now() - 86400000).toISOString(),
  },
  {
    id: 'sari-store-1',
    title: 'Sari-Sari Store',
    subtitle: 'Yesterday, 08:24 AM',
    amount: -120,
    type: 'outgoing',
    tag: 'OFFLINE',
    dateGroup: 'June 02, 2026',
    timeAgo: '2 days ago',
    description: 'Paid ₱120.00 at Sari-Sari Store using offline local escrow.',
    createdAt: new Date(Date.now() - 86400000 - 3600000 * 2).toISOString(),
  },
  {
    id: 'wet-market-1',
    title: 'Wet Market',
    subtitle: 'Yesterday, 01:30 AM',
    amount: -376,
    type: 'outgoing',
    tag: 'OFFLINE',
    dateGroup: 'June 02, 2026',
    timeAgo: '2 days ago',
    description: 'Paid ₱376.00 at Wet Market using offline local escrow.',
    createdAt: new Date(Date.now() - 86400000 - 3600000 * 8).toISOString(),
  }
];

export async function loadTransactions(): Promise<StoredTransaction[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) {
      // Seed defaults
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_TRANSACTIONS));
      return DEFAULT_TRANSACTIONS;
    }
    return JSON.parse(raw) as StoredTransaction[];
  } catch (error) {
    console.error('[transaction-storage] failed to load transactions:', error);
    return [];
  }
}

export async function saveTransactions(txs: StoredTransaction[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(txs));
  } catch (error) {
    console.error('[transaction-storage] failed to save transactions:', error);
  }
}

export async function addTransaction(tx: Omit<StoredTransaction, 'id' | 'createdAt' | 'dateGroup' | 'timeAgo'>): Promise<StoredTransaction> {
  try {
    const txs = await loadTransactions();
    const now = new Date();
    
    // Formatting date helper
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const dateGroup = `${months[now.getMonth()]} ${String(now.getDate()).padStart(2, '0')}, ${now.getFullYear()}`;
    
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const subtitle = `Today, ${timeStr}`;

    const newTx: StoredTransaction = {
      ...tx,
      id: `TX-${Math.floor(100000000000 + Math.random() * 900000000000)}`,
      dateGroup,
      timeAgo: 'Just now',
      subtitle,
      createdAt: now.toISOString(),
    };

    const updated = [newTx, ...txs];
    await saveTransactions(updated);
    return newTx;
  } catch (error) {
    console.error('[transaction-storage] failed to add transaction:', error);
    throw error;
  }
}

export async function clearTransactions(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.error('[transaction-storage] failed to clear transactions:', error);
  }
}
