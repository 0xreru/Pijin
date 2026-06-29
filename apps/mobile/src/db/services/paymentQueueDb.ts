/**
 * @file src/db/services/paymentQueueDb.ts
 *
 * Drizzle-based replacement for src/services/storage/paymentQueueStorage.ts
 *
 * Key differences from the AsyncStorage version:
 *   1. Each queued payment has a `nonce` UUID generated at creation time.
 *      This nonce is sent to the backend Settlement endpoint on every retry,
 *      guaranteeing exactly-once processing via the backend's @unique constraint.
 *   2. Items are never deleted after sync — they are marked `synced = true`
 *      so there is a complete audit trail of all offline payments.
 *   3. `retryCount` and `syncError` track failure history for debugging.
 *
 * To adopt, swap the import path in callers:
 *
 *   // Before:
 *   import { loadOfflinePaymentsQueue, appendToOfflinePaymentsQueue } from '../services/storage/paymentQueueStorage';
 *
 *   // After:
 *   import { loadPendingQueue, enqueuePayment } from '../db/services/paymentQueueDb';
 */

import { db } from '../client';
import { paymentQueue, type PaymentQueueRow, type NewPaymentQueueRow } from '../schema';
import { eq, and } from 'drizzle-orm';
import type { OfflinePaymentPayload } from '../../types/payment';

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Returns all unsynced queue items (synced = false).
 * Used by syncService to determine what needs to be flushed to the backend.
 */
export async function loadPendingQueue(): Promise<PaymentQueueRow[]> {
  try {
    return db
      .select()
      .from(paymentQueue)
      .where(eq(paymentQueue.synced, false));
  } catch (error) {
    console.error('[paymentQueueDb] Failed to load pending queue:', error);
    return [];
  }
}

/**
 * Returns ALL queue items including synced ones.
 * Useful for audit/history displays.
 */
export async function loadFullQueue(): Promise<PaymentQueueRow[]> {
  try {
    return db.select().from(paymentQueue);
  } catch (error) {
    console.error('[paymentQueueDb] Failed to load full queue:', error);
    return [];
  }
}

/**
 * Returns the count of unsynced items.
 * Used for the queue badge counter in the dashboard.
 */
export async function getPendingCount(): Promise<number> {
  try {
    const rows = await loadPendingQueue();
    return rows.length;
  } catch (error) {
    console.error('[paymentQueueDb] Failed to get pending count:', error);
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

function generateUUID(): string {
  const bytes = new Uint8Array(16);
  const cryptoObj = typeof crypto !== 'undefined' ? crypto : (typeof global !== 'undefined' ? (global as any).crypto : null);
  if (cryptoObj && cryptoObj.getRandomValues) {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  // Set version 4 and variant RFC4122
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  let uuid = '';
  for (let i = 0; i < 16; i++) {
    const hex = bytes[i].toString(16).padStart(2, '0');
    uuid += hex;
    if (i === 3 || i === 5 || i === 7 || i === 9) {
      uuid += '-';
    }
  }
  return uuid;
}

/**
 * Adds a new offline payment to the queue.
 *
 * IMPORTANT: A `nonce` UUID is generated here and stored permanently.
 * This nonce is the dedup key for the backend. Never call this function
 * twice for the same logical payment — always use the stored nonce on retries.
 *
 * Accepts the existing OfflinePaymentPayload type for backwards compatibility.
 */
export async function enqueuePayment(
  payload: OfflinePaymentPayload,
  trx?: any
): Promise<PaymentQueueRow> {
  try {
    const client = trx || db;
    const nonce = generateUUID();

    const newRow: NewPaymentQueueRow = {
      id:              `Q-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      nonce,
      amount:          payload.amount,
      currency:        payload.currency,
      customerShortId: payload.customerShortId,
      merchantShortId: payload.merchantShortId,
      customerPubKey:  payload.customerPublicKey ?? null,
      relayerAddress:  null, // set by transport layer if available
      tokenSymbol:     'PHPC',
      smsBody:         payload.smsBody,
      createdAt:       payload.createdAt,
      expiresInMinutes: payload.expiresInMinutes,
      synced:          false,
      syncedAt:        null,
      syncError:       null,
      retryCount:      0,
      backendStatus:   null,
      txHash:          null,
    };

    await client.insert(paymentQueue).values(newRow);

    const inserted = await client
      .select()
      .from(paymentQueue)
      .where(eq(paymentQueue.id, newRow.id));

    if (!inserted || inserted.length === 0) {
      throw new Error(`Failed to retrieve enqueued payment with ID: ${newRow.id}`);
    }

    return inserted[0];
  } catch (error) {
    console.error('[paymentQueueDb] Failed to enqueue payment:', error);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Sync state updates (called by syncService.ts)
// ---------------------------------------------------------------------------

/**
 * Marks an item as successfully synced.
 * Called by syncService after the backend returns 200 OK or 409 Conflict.
 */
export async function markSynced(
  id: string,
  txHash: string | null,
  backendStatus: string
): Promise<void> {
  try {
    await db
      .update(paymentQueue)
      .set({
        synced:        true,
        syncedAt:      new Date().toISOString(),
        syncError:     null,
        backendStatus,
        txHash,
      })
      .where(eq(paymentQueue.id, id));
  } catch (error) {
    console.error('[paymentQueueDb] Failed to mark item synced:', error);
    throw error;
  }
}

/**
 * Records a sync failure. Item stays in the queue (synced = false)
 * and will be retried on the next connection restore event.
 */
export async function markSyncError(id: string, errorMessage: string): Promise<void> {
  try {
    // Read current retry count first
    const rows = await db
      .select({ retryCount: paymentQueue.retryCount })
      .from(paymentQueue)
      .where(eq(paymentQueue.id, id));

    const currentRetryCount = rows[0]?.retryCount ?? 0;

    await db
      .update(paymentQueue)
      .set({
        syncError:  errorMessage,
        retryCount: currentRetryCount + 1,
      })
      .where(eq(paymentQueue.id, id));
  } catch (error) {
    console.error('[paymentQueueDb] Failed to mark sync error:', error);
  }
}

/**
 * Clears all synced items from the queue.
 * Safe to call periodically to keep the table from growing unbounded.
 * Does NOT delete unsynced items.
 */
export async function clearSyncedItems(): Promise<void> {
  try {
    await db
      .delete(paymentQueue)
      .where(eq(paymentQueue.synced, true));
  } catch (error) {
    console.error('[paymentQueueDb] Failed to clear synced items:', error);
  }
}
