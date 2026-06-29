/**
 * @file src/db/migrations.ts
 *
 * Bootstrap migration — creates all SQLite tables if they do not yet exist.
 *
 * This file uses raw SQL with `CREATE TABLE IF NOT EXISTS` so it is safe
 * to run on every app startup. It is idempotent: if the tables already
 * exist, nothing changes.
 *
 * Called once from App.tsx before syncService.start():
 *
 *   import { runMigrations } from './src/db/migrations';
 *   await runMigrations();
 *
 * Future schema changes:
 *   Add new `ALTER TABLE` statements below the initial CREATE blocks.
 *   Never modify the existing CREATE TABLE statements — add new columns
 *   via ALTER TABLE with a DEFAULT value so existing rows remain valid.
 */

import { db } from './client';
import { sql } from 'drizzle-orm';

export async function runMigrations(): Promise<void> {
  console.log('[DB] Running migrations...');

  try {
    // ── transactions table ─────────────────────────────────────────────────
    // Replaces: src/services/storage/transactionStorage.ts
    await db.run(sql`
      CREATE TABLE IF NOT EXISTS transactions (
        id          TEXT    PRIMARY KEY NOT NULL,
        title       TEXT    NOT NULL,
        subtitle    TEXT    NOT NULL,
        amount      INTEGER NOT NULL,
        type        TEXT    NOT NULL,
        tag         TEXT    NOT NULL,
        date_group  TEXT    NOT NULL,
        time_ago    TEXT    NOT NULL,
        description TEXT    NOT NULL,
        created_at  TEXT    NOT NULL
      )
    `);

    // ── payment_queue table ────────────────────────────────────────────────
    // Replaces: src/services/storage/paymentQueueStorage.ts
    // Adds nonce, relayer_address, token_symbol, sync tracking columns
    // to support eventual submission to the backend Settlement endpoint.
    await db.run(sql`
      CREATE TABLE IF NOT EXISTS payment_queue (
        id                  TEXT    PRIMARY KEY NOT NULL,
        nonce               TEXT    NOT NULL UNIQUE,
        amount              INTEGER NOT NULL,
        currency            TEXT    NOT NULL DEFAULT 'PHP',
        customer_short_id   TEXT    NOT NULL,
        merchant_short_id   TEXT    NOT NULL,
        customer_pub_key    TEXT,
        relayer_address     TEXT,
        token_symbol        TEXT    NOT NULL DEFAULT 'PHPC',
        sms_body            TEXT    NOT NULL,
        created_at          TEXT    NOT NULL,
        expires_in_minutes  INTEGER NOT NULL,
        synced              INTEGER NOT NULL DEFAULT 0,
        synced_at           TEXT,
        sync_error          TEXT,
        retry_count         INTEGER NOT NULL DEFAULT 0,
        backend_status      TEXT,
        tx_hash             TEXT
      )
    `);

    console.log('[DB] Migrations complete.');
  } catch (error) {
    console.error('[DB] Migration failed:', error);
    throw error;
  }
}
