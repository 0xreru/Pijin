/**
 * @file src/services/syncService.ts
 *
 * RxJS-driven offline → online sync service.
 *
 * Subscribes to the existing connectionService.state$ BehaviorSubject.
 * Whenever the device transitions from offline → online, automatically
 * flushes all unsynced items from the SQLite payment_queue table to
 * the backend Settlement API.
 *
 * Lifecycle:
 *   1. Call syncService.start() once from App.tsx after runMigrations().
 *   2. The service runs silently in the background for the app's lifetime.
 *   3. Call syncService.stop() in the App cleanup (return of useEffect).
 *
 * Backend integration:
 *   The actual HTTP call is isolated in the `postToBackend()` function below.
 *   When the backend Settlement endpoint is ready, only that one function
 *   needs to be updated. The RxJS trigger, retry logic, and DB state
 *   management are all backend-agnostic.
 */

import { filter, distinctUntilKeyChanged, switchMap, catchError } from 'rxjs/operators';
import { from, EMPTY, Subscription } from 'rxjs';
import { connectionService } from './connectionService';
import {
  loadPendingQueue,
  markSynced,
  markSyncError,
} from '../db/services/paymentQueueDb';
import type { PaymentQueueRow } from '../db/schema';
import { addTransaction } from '../db/services/transactionDb';

// ---------------------------------------------------------------------------
// Backend integration point
// ---------------------------------------------------------------------------

/**
 * Sends a single queued payment to the backend Settlement endpoint.
 *
 * ── CURRENT STATE ──────────────────────────────────────────────────────────
 * The backend API endpoint is not yet implemented. This function throws
 * so that queue items remain in the local SQLite queue (synced = false)
 * and are retried automatically on the next online transition.
 *
 * ── WHEN BACKEND IS READY ──────────────────────────────────────────────────
 * Replace the throw below with the real fetch() call:
 *
 *   const API_BASE = process.env.EXPO_PUBLIC_API_BASE_URL;
 *
 *   const res = await fetch(`${API_BASE}/api/settlements`, {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({
 *       nonce:           item.nonce,           // dedup key — safe to retry
 *       senderShortId:   item.customerShortId,
 *       receiverShortId: item.merchantShortId,
 *       relayerAddress:  item.relayerAddress ?? null,
 *       tokenSymbol:     item.tokenSymbol,
 *       amountPhp:       item.amount,          // backend converts to stroops
 *       smsBody:         item.smsBody,
 *     }),
 *   });
 *
 *   if (res.status === 409) {
 *     // Nonce already processed — treat as success (idempotent)
 *     return { txHash: null, status: 'SETTLED' };
 *   }
 *
 *   if (!res.ok) {
 *     throw new Error(`Backend returned HTTP ${res.status}`);
 *   }
 *
 *   const data = await res.json();
 *   return { txHash: data.txHash ?? null, status: data.status ?? 'PENDING' };
 */
async function postToBackend(
  _item: PaymentQueueRow
): Promise<{ txHash: string | null; status: string }> {
  // TODO: Implement when backend /api/settlements endpoint is available.
  throw new Error('[SyncService] Backend settlement API not yet configured.');
}

// ---------------------------------------------------------------------------
// SyncService class
// ---------------------------------------------------------------------------

class SyncService {
  private subscription: Subscription | null = null;

  /**
   * Starts the background sync listener.
   * Safe to call multiple times — guards against double-subscription.
   */
  start(): void {
    if (this.subscription) return;

    console.log('[SyncService] Starting...');

    this.subscription = connectionService.state$.pipe(
      // Only react when isOnlineMode actually changes value
      distinctUntilKeyChanged('isOnlineMode'),

      // Only proceed on the offline → ONLINE transition
      filter(state => state.isOnlineMode === true),

      // switchMap cancels any in-flight sync if the state toggles again
      // mid-flush (e.g. connection drops while syncing)
      switchMap(() =>
        from(this.flush()).pipe(
          catchError(err => {
            console.error('[SyncService] Unhandled flush error:', err);
            return EMPTY;
          })
        )
      )
    ).subscribe();

    console.log('[SyncService] Listening for online transitions.');
  }

  /**
   * Stops the sync listener. Call in App.tsx useEffect cleanup.
   */
  stop(): void {
    this.subscription?.unsubscribe();
    this.subscription = null;
    console.log('[SyncService] Stopped.');
  }

  /**
   * Manually trigger a sync flush.
   * Called automatically on online transition, but can also be invoked
   * from the "Sync Now" button in DashboardScreen as a manual override.
   */
  async flush(): Promise<void> {
    const pending = await loadPendingQueue();

    if (pending.length === 0) {
      console.log('[SyncService] No pending items to sync.');
      return;
    }

    console.log(`[SyncService] Flushing ${pending.length} pending item(s)...`);

    let successCount = 0;
    let totalAmount = 0;

    for (const item of pending) {
      try {
        const result = await postToBackend(item);

        await markSynced(item.id, result.txHash, result.status);
        successCount++;
        totalAmount += item.amount;

        console.log(`[SyncService] Item ${item.id} synced. txHash: ${result.txHash}`);
      } catch (err: any) {
        const message = err?.message ?? 'Unknown error';
        await markSyncError(item.id, message);
        console.warn(`[SyncService] Item ${item.id} failed: ${message}`);
        // Continue processing remaining items — do not abort the whole flush
      }
    }

    // If at least one item synced successfully, log a settlement transaction
    // so the UI (via useLiveQuery) auto-updates without any manual refresh.
    if (successCount > 0) {
      try {
        await addTransaction({
          title:       'Synced Offline Payments',
          amount:      totalAmount,
          type:        'settlement',
          tag:         'WALLET',
          description: `Settled ${successCount} offline payment(s) totalling ₱${totalAmount.toFixed(2)} on the Stellar network.`,
        });
      } catch (txErr) {
        console.error('[SyncService] Failed to log settlement transaction:', txErr);
      }
    }

    console.log(
      `[SyncService] Flush complete. Success: ${successCount}/${pending.length}`
    );
  }
}

export const syncService = new SyncService();
