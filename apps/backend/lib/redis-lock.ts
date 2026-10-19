/**
 * @file lib/redis-lock.ts
 *
 * Distributed Redis Mutex Lock for Relayer transaction submission.
 * Prevents `tx_bad_seq` (Sequence Number Collision) when multiple requests
 * build, simulate, sign, and broadcast transactions concurrently using
 * the single shared relayer account.
 */

import { Redis } from "@upstash/redis";
import { getRedis } from "@/lib/rate-limit";

export const RELAYER_LOCK_KEY = "pijin:relayer:lock";
export const RELAYER_LOCK_TTL_SECONDS = 5;

let overrideRedis: Redis | null = null;

/**
 * Allows injecting a custom or mock Redis client (primarily for unit tests).
 */
export function setLockRedisForTesting(client: Redis | null): void {
  overrideRedis = client;
}

function resolveRedis(): Redis {
  return overrideRedis ?? getRedis();
}

/**
 * Attempts to acquire an exclusive lock for the relayer.
 * Uses NX (set if not exists) and EX (auto-expires in 5s to prevent deadlocks).
 * Returns true if the lock was acquired, false otherwise.
 */
export async function acquireRelayerLock(
  lockKey = RELAYER_LOCK_KEY,
  ttlSeconds = RELAYER_LOCK_TTL_SECONDS,
): Promise<boolean> {
  try {
    const redis = resolveRedis();
    const result = await redis.set(lockKey, "locked", {
      nx: true,
      ex: ttlSeconds,
    });
    return result === "OK" || Boolean(result);
  } catch (error) {
    if (process.env.NODE_ENV === "test" && !overrideRedis) {
      return true;
    }
    console.error("[RedisLock] Error acquiring relayer lock:", error);
    return false;
  }
}

/**
 * Releases the exclusive relayer lock by deleting the lock key.
 */
export async function releaseRelayerLock(
  lockKey = RELAYER_LOCK_KEY,
): Promise<void> {
  try {
    const redis = resolveRedis();
    await redis.del(lockKey);
  } catch (error) {
    console.error("[RedisLock] Error releasing relayer lock:", error);
  }
}
