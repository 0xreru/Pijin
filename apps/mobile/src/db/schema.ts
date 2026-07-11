/**
 * @file src/db/schema.ts
 *
 * Drizzle ORM table definitions for the local SQLite database.
 *
 * These two tables replace the current AsyncStorage JSON arrays in:
 *   - src/services/storage/transactionStorage.ts  → `transactions` table
 *   - src/services/storage/paymentQueueStorage.ts → `payment_queue` table
 *
 * Column names mirror the existing TypeScript types so migration is
 * a drop-in replacement with minimal changes to callers.
 */

import { sqliteTable, text, real, integer } from 'drizzle-orm/sqlite-core';

// ---------------------------------------------------------------------------
// transactions
// Replaces: transactionStorage.ts (AsyncStorage JSON array)
// Mirrors:  StoredTransaction interface
// ---------------------------------------------------------------------------

export const transactions = sqliteTable('transactions', {
  id:          text('id').primaryKey(),
  stellarPublicKey: text('stellar_public_key'),
  shortId:     text('short_id'),
  title:       text('title').notNull(),
  subtitle:    text('subtitle').notNull(),
  amount:      integer('amount').notNull(),

  /** 'incoming' | 'outgoing' | 'transfer' | 'settlement' */
  type:        text('type').notNull(),

  /** 'WALLET' | 'OFFLINE' */
  tag:         text('tag').notNull(),

  dateGroup:   text('date_group').notNull(),
  timeAgo:     text('time_ago').notNull(),
  description: text('description').notNull(),

  /** ISO 8601 string — used for ordering */
  createdAt:   text('created_at').notNull(),
});

// ---------------------------------------------------------------------------
// payment_queue
// Replaces: paymentQueueStorage.ts (AsyncStorage JSON array)
// Mirrors:  OfflinePaymentPayload + Settlement (Prisma backend model)
// ---------------------------------------------------------------------------

export const paymentQueue = sqliteTable('payment_queue', {
  // ── Local identity ──────────────────────────────────────────────────────
  /** Local SQLite row ID (UUID generated on mobile) */
  id: text('id').primaryKey(),

  /**
   * Replay-attack dedup key.
   *
   * Generated ONCE at payment creation time, stored here, and sent on every
   * retry to the backend. The backend's Settlement table has a @unique
   * constraint on this field — so even if the mobile retries 10 times due
   * to network interruption, the payment is only processed once.
   *
   * Rule: NEVER regenerate the nonce after initial creation.
   */
  nonce: text('nonce').notNull().unique(),

  // ── Settlement payload (mirrors Prisma Settlement model) ────────────────
  /** PHP amount — backend converts to Stellar stroops (7-decimal BigInt) */
  amount:          integer('amount').notNull(),

  /** 'PHP' */
  currency:        text('currency').notNull().default('PHP'),

  /** Customer's shortId (senderShortId in backend) */
  customerShortId: text('customer_short_id').notNull(),

  /** Merchant's shortId (receiverShortId in backend) */
  merchantShortId: text('merchant_short_id').notNull(),

  /** Customer's Stellar public key — optional */
  customerPubKey:  text('customer_pub_key'),

  /** Gateway node public key for SMS relay routing — optional */
  relayerAddress:  text('relayer_address'),

  /** Token symbol sent to backend, e.g. 'PHPC' */
  tokenSymbol:     text('token_symbol').notNull().default('PHPC'),

  /** Raw SMS payload string built by buildSmsPayload.ts */
  smsBody:         text('sms_body').notNull(),

  /** ISO 8601 string — when the offline payment was created */
  createdAt:       text('created_at').notNull(),

  expiresInMinutes: integer('expires_in_minutes').notNull(),

  // ── Sync state ──────────────────────────────────────────────────────────
  /**
   * false = not yet synced to backend
   * true  = backend confirmed receipt (200 OK or 409 Conflict)
   */
  synced:    integer('synced', { mode: 'boolean' }).notNull().default(false),

  /** ISO 8601 string — when the item was successfully synced */
  syncedAt:  text('synced_at'),

  /** Last error message if the sync attempt failed — null on success */
  syncError: text('sync_error'),

  /** Number of times this item has been retried */
  retryCount: integer('retry_count').notNull().default(0),

  /**
   * Status mirror from the backend Settlement model.
   * Populated after a successful sync: 'PENDING' | 'SETTLED' | 'FAILED'
   */
  backendStatus: text('backend_status'),

  /**
   * Stellar transaction hash — filled after the backend confirms SETTLED.
   * null until then.
   */
  txHash: text('tx_hash'),
});

// ---------------------------------------------------------------------------
// TypeScript helper types inferred from the schema
// ---------------------------------------------------------------------------

export type TransactionRow  = typeof transactions.$inferSelect;
export type NewTransactionRow = typeof transactions.$inferInsert;

export type PaymentQueueRow = typeof paymentQueue.$inferSelect;
export type NewPaymentQueueRow = typeof paymentQueue.$inferInsert;
