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
import { desc, eq, like, ne } from 'drizzle-orm';
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
      .where(ne(transactions.type, 'settlement'))
      .orderBy(desc(transactions.createdAt));

    const processedRows = rows.map(tx => {
      let processedTx = {
        ...tx,
        title: tx.title.replace('Paid to', 'Sent to')
      };

      const feeMatch = tx.description?.match(/with ₱([0-9.]+) processing fee/);
      if (feeMatch && tx.type === 'outgoing' && tx.tag === 'OFFLINE') {
        const feeStr = feeMatch[1];
        const feeNum = parseFloat(feeStr);
        if (!isNaN(feeNum) && feeNum > 0) {
          processedTx.amount = tx.amount + feeNum;
        }
      }

      return processedTx as StoredTransaction;
    });

    return processedRows;
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
  tx: Omit<StoredTransaction, 'id' | 'createdAt' | 'dateGroup' | 'timeAgo' | 'subtitle'> & { id?: string },
  trx?: any
): Promise<StoredTransaction> {
  try {
    const client = trx || db;
    const now = new Date();
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const dateGroup = `${months[now.getMonth()]} ${String(now.getDate()).padStart(2, '0')}, ${now.getFullYear()}`;
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

    const newRow: NewTransactionRow = {
      ...tx,
      id:        tx.id || `TX-${Math.floor(100000000000 + Math.random() * 900000000000)}`,
      dateGroup,
      timeAgo:   'Just now',
      subtitle:  `Today, ${timeStr}`,
      createdAt: now.toISOString(),
    };

    await client.insert(transactions).values(newRow);
    return newRow as StoredTransaction;
  } catch (error) {
    console.error('[transactionDb] Failed to add transaction:', error);
    throw error;
  }
}

/**
 * Inserts multiple transaction rows atomically within a single database transaction.
 * Automatically generates id, dateGroup, timeAgo, subtitle, and createdAt.
 */
export async function addTransactions(
  txs: Omit<StoredTransaction, 'id' | 'createdAt' | 'dateGroup' | 'timeAgo' | 'subtitle'>[]
): Promise<StoredTransaction[]> {
  try {
    const now = new Date();
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const dateGroup = `${months[now.getMonth()]} ${String(now.getDate()).padStart(2, '0')}, ${now.getFullYear()}`;
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

    return await db.transaction(async (trx) => {
      const insertedRows: StoredTransaction[] = [];
      for (const tx of txs) {
        const newRow: NewTransactionRow = {
          ...tx,
          id:        `TX-${Math.floor(100000000000 + Math.random() * 900000000000)}`,
          dateGroup,
          timeAgo:   'Just now',
          subtitle:  `Today, ${timeStr}`,
          createdAt: now.toISOString(),
        };
        await trx.insert(transactions).values(newRow);
        insertedRows.push(newRow as StoredTransaction);
      }
      return insertedRows;
    });
  } catch (error) {
    console.error('[transactionDb] Failed to add transactions atomically:', error);
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
    await db.transaction(async (trx) => {
      await trx.delete(transactions);
      if (txs.length > 0) {
        await trx.insert(transactions).values(txs as NewTransactionRow[]);
      }
    });
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

/**
 * Atomic upsert of server settlement transactions into local SQLite database.
 * Matches requirements for smart sync (latest 50 records).
 */
export async function upsertServerTransactions(
  shortId: string,
  serverTxs: any[], // Use any to avoid circular import if needed, or cast internally
  publicKey?: string
): Promise<void> {
  try {
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    
    await db.transaction(async (trx) => {
      for (const sTx of serverTxs) {
        const amountNum = parseFloat(sTx.amountPhp);
        const isIncoming = sTx.merchantShortId === shortId;
        const type = isIncoming ? 'incoming' : 'outgoing';
        const title = isIncoming
          ? `Received from ${sTx.customerShortId} (Offline)`
          : `Sent to ${sTx.merchantShortId} (Offline)`;
        
        const now = new Date(sTx.createdAt);
        const dateGroup = `${months[now.getMonth()]} ${String(now.getDate()).padStart(2, '0')}, ${now.getFullYear()}`;
        const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        const subtitle = `${dateGroup.split(',')[0]} at ${timeStr}`;

        const txId = `TX-SVR-${sTx.id}`;

        // Prepare row
        const rowData: NewTransactionRow = {
          id: txId,
          stellarPublicKey: publicKey || null,
          shortId,
          title,
          subtitle,
          amount: isIncoming ? amountNum : -amountNum,
          type,
          tag: 'OFFLINE',
          dateGroup,
          timeAgo: 'Synced',
          description: sTx.txHash ? `Stellar Tx Hash: ${sTx.txHash}` : `Status: ${sTx.status}`,
          createdAt: sTx.createdAt,
        };

        // Check if row already exists
        const existing = await trx
          .select()
          .from(transactions)
          .where(eq(transactions.id, txId))
          .limit(1);

        if (existing.length > 0) {
          // Update the existing row
          await trx
            .update(transactions)
            .set(rowData)
            .where(eq(transactions.id, txId));
        } else {
          // Insert new row
          await trx.insert(transactions).values(rowData);
        }
      }
    });
  } catch (error) {
    console.error('[transactionDb] Failed to upsert server transactions:', error);
    throw error;
  }
}

/**
 * Atomic upsert of server history transactions into local SQLite database.
 */
export async function upsertHistoryTransactions(
  historyTxs: any[],
  shortId: string,
  publicKey: string
): Promise<void> {
  try {
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    
    await db.transaction(async (trx) => {
      for (const hTx of historyTxs) {
        const amountNum = parseFloat(hTx.amount);
        let type: 'incoming' | 'outgoing' | 'transfer' = 'incoming';
        if (hTx.type === 'SEND' || hTx.type === 'WITHDRAWAL') {
          type = 'outgoing';
        } else if (hTx.type === 'TRANSFER') {
          type = 'transfer';
        }
        
        const now = new Date(hTx.timestamp);
        const dateGroup = `${months[now.getMonth()]} ${String(now.getDate()).padStart(2, '0')}, ${now.getFullYear()}`;
        const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        const subtitle = `${dateGroup.split(',')[0]} at ${timeStr}`;

        const txId = `TX-SVR-${hTx.id}`;

        // Prepare row
        const rowData: NewTransactionRow = {
          id: txId,
          stellarPublicKey: publicKey,
          shortId,
          title: hTx.title,
          subtitle,
          amount: amountNum,
          type,
          // Direction (SEND/RECEIVE) is independent from the transaction
          // channel. Prefer the backend's authoritative tag, with the legacy
          // inference retained only for staged deployments.
          tag: hTx.tag === 'WALLET' || hTx.tag === 'OFFLINE'
            ? hTx.tag
            : (hTx.type === 'SEND' || hTx.type === 'RECEIVE') ? 'OFFLINE' : 'WALLET',
          dateGroup,
          timeAgo: 'Synced',
          description: hTx.txHash ? `Stellar Tx Hash: ${hTx.txHash}` : `Status: ${hTx.status}`,
          createdAt: hTx.timestamp,
        };

        // Check if row already exists
        const existing = await trx
          .select()
          .from(transactions)
          .where(eq(transactions.id, txId))
          .limit(1);

        if (existing.length > 0) {
          // Update the existing row
          await trx
            .update(transactions)
            .set(rowData)
            .where(eq(transactions.id, txId));
        } else {
          // Insert new row
          await trx.insert(transactions).values(rowData);
          
          // Deduplicate local offline transaction if it exists
          if (hTx.nonce) {
            const localOffId = `TX-OFF-${hTx.nonce}`;
            await trx.delete(transactions).where(eq(transactions.id, localOffId));
          }
        }
      }
    });
  } catch (error) {
    console.error('[transactionDb] Failed to upsert history transactions:', error);
    throw error;
  }
}

/**
 * Clears only server-derived cache rows so they can be re-fetched with current
 * authoritative tags. Locally-created WALLET/OFFLINE history must survive the
 * one-time migration.
 */
export async function correctLegacyTags(): Promise<void> {
  try {
    await db.delete(transactions).where(like(transactions.id, 'TX-SVR-%'));
  } catch (error) {
    console.error('[transactionDb] Failed to refresh legacy server tags:', error);
  }
}

/**
 * Scans the local SQLite database for OFFLINE transactions with unresolved Short IDs
 * (e.g., "Sent to aB3x9Q (Offline)") and attempts to resolve them to the actual name
 * using the backend lookup API.
 */
export async function resolveOfflineTransactionNames(): Promise<void> {
  try {
    const API_URL = process.env.EXPO_PUBLIC_API_BASE_URL || 'https://pijin-api.vercel.app';
    
    // Find all OFFLINE transactions
    const unresolvedTxs = await db
      .select()
      .from(transactions)
      .where(eq(transactions.tag, 'OFFLINE'));

    for (const tx of unresolvedTxs) {
      // Regex to extract the short ID from the title
      const match = tx.title.match(/Sent to ([A-Za-z0-9_.-]+) \(Offline\)/) || 
                    tx.title.match(/Received from ([A-Za-z0-9_.-]+) \(Offline\)/);
      if (match && match[1]) {
        const shortId = match[1];
        try {
          const res = await fetch(`${API_URL}/api/users/lookup?shortId=${encodeURIComponent(shortId)}`);
          if (res.ok) {
            const data = await res.json();
            if (data.found && data.displayName) {
              const newTitle = tx.title.includes('Sent to') 
                ? `Sent to ${data.displayName} (Offline)`
                : `Received from ${data.displayName} (Offline)`;
              
              await db
                .update(transactions)
                .set({ title: newTitle })
                .where(eq(transactions.id, tx.id));
              console.log(`[transactionDb] Resolved ${shortId} to ${data.displayName}`);
            }
          }
        } catch (lookupErr) {
          console.warn(`[transactionDb] Failed to lookup ${shortId}:`, lookupErr);
        }
      }
    }
  } catch (err) {
    console.error('[transactionDb] Error in resolveOfflineTransactionNames:', err);
  }
}

