/**
 * @file src/db/services/transactionDb.ts
 *
 * Drizzle-based replacement for src/services/storage/transactionStorage.ts
 *
 * Provides the same function signatures as the existing AsyncStorage service
 * so callers require minimal changes. Swap the import path to adopt:
 *
 *   // Before:
 *   import { loadTransactions, addTransaction } from '../services/storage/transactionStorage';
 *
 *   // After:
 *   import { loadTransactions, addTransaction } from '../db/services/transactionDb';
 */

import { db } from '../client';
import { transactions, type TransactionRow, type NewTransactionRow } from '../schema';
import { desc } from 'drizzle-orm';
import type { TransactionType } from '../../types/transaction';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Mirrors the existing StoredTransaction interface so existing callers
 * compile without changes when switching import paths.
 */
export type StoredTransaction = TransactionRow & {
  type: TransactionType;
  tag: 'WALLET' | 'OFFLINE';
};

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Returns all transactions ordered by newest first.
 * Equivalent to the current loadTransactions() from AsyncStorage.
 */
export async function loadTransactions(): Promise<StoredTransaction[]> {
  try {
    const rows = await db
      .select()
      .from(transactions)
      .orderBy(desc(transactions.createdAt));

    return rows as StoredTransaction[];
  } catch (error) {
    console.error('[transactionDb] Failed to load transactions:', error);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Inserts a new transaction row. Automatically generates id, dateGroup,
 * timeAgo, subtitle, and createdAt — same behaviour as the AsyncStorage version.
 */
export async function addTransaction(
  tx: Omit<StoredTransaction, 'id' | 'createdAt' | 'dateGroup' | 'timeAgo' | 'subtitle'>
): Promise<StoredTransaction> {
  try {
    const now = new Date();
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const dateGroup = `${months[now.getMonth()]} ${String(now.getDate()).padStart(2, '0')}, ${now.getFullYear()}`;
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

    const newRow: NewTransactionRow = {
      ...tx,
      id:        `TX-${Math.floor(100000000000 + Math.random() * 900000000000)}`,
      dateGroup,
      timeAgo:   'Just now',
      subtitle:  `Today, ${timeStr}`,
      createdAt: now.toISOString(),
    };

    await db.insert(transactions).values(newRow);
    return newRow as StoredTransaction;
  } catch (error) {
    console.error('[transactionDb] Failed to add transaction:', error);
    throw error;
  }
}

/**
 * Saves a full array of transactions, replacing whatever is currently stored.
 * Used for seeding default data on first launch.
 */
export async function saveTransactions(txs: StoredTransaction[]): Promise<void> {
  try {
    // SQLite has no upsert-all shortcut; delete + re-insert is simplest for seeding.
    await db.delete(transactions);
    if (txs.length > 0) {
      await db.insert(transactions).values(txs as NewTransactionRow[]);
    }
  } catch (error) {
    console.error('[transactionDb] Failed to save transactions:', error);
    throw error;
  }
}

/**
 * Removes all transaction rows. Useful for logout/reset flows.
 */
export async function clearTransactions(): Promise<void> {
  try {
    await db.delete(transactions);
  } catch (error) {
    console.error('[transactionDb] Failed to clear transactions:', error);
  }
}
