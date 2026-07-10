/**
 * @file src/db/client.ts
 *
 * Single source of truth for the Drizzle ORM database connection.
 *
 * Usage:
 *   import { db } from '../db/client';
 *   const rows = await db.select().from(transactions);
 *
 * The `enableChangeListener: true` option is required for `useLiveQuery`
 * to work — it registers a native SQLite update hook that fires whenever
 * any row is inserted, updated, or deleted, allowing Drizzle to push
 * reactive updates to subscribed React components automatically.
 */

import { drizzle } from 'drizzle-orm/expo-sqlite';
import { openDatabaseSync } from 'expo-sqlite';
import * as schema from './schema';

/**
 * Open the native SQLite database file.
 *
 * `enableChangeListener: true` — required for useLiveQuery reactivity.
 * The file `pijin.db` is created automatically on first run inside
 * the app's private storage directory on the device.
 */
const expoDb = openDatabaseSync('pijin.db', {
  enableChangeListener: true,
});

/**
 * Drizzle database instance.
 *
 * Pass `schema` so that Drizzle can resolve relations and provide
 * fully-typed query builders (db.query.transactions.findMany(), etc.)
 */
export const db = drizzle(expoDb, { schema });
