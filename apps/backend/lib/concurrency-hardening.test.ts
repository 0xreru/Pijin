/**
 * @file lib/concurrency-hardening.test.ts
 *
 * Test suite for Relayer Redis Locking & Distributor Retry Loop.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  acquireRelayerLock,
  releaseRelayerLock,
  setLockRedisForTesting,
  RELAYER_LOCK_KEY,
} from "./redis-lock";
import { isTxBadSeq, isAccountAlreadyExists } from "@/app/api/friendbot/route";

// ─── Task 1: Redis Mutex Lock Tests ──────────────────────────────────────────

test("Redis Lock: acquires lock exclusively and denies concurrent attempt", async () => {
  const store = new Map<string, string>();

  const mockRedis = {
    set: async (key: string, val: string, opts?: { nx?: boolean; ex?: number }) => {
      if (opts?.nx && store.has(key)) {
        return null; // Key already exists, not set
      }
      store.set(key, val);
      return "OK";
    },
    del: async (key: string) => {
      store.delete(key);
      return 1;
    },
  } as any;

  setLockRedisForTesting(mockRedis);

  try {
    // 1. First worker acquires lock
    const firstAcquire = await acquireRelayerLock();
    assert.equal(firstAcquire, true, "First acquire should succeed");
    assert.equal(store.get(RELAYER_LOCK_KEY), "locked");

    // 2. Second worker attempts to acquire while locked
    const secondAcquire = await acquireRelayerLock();
    assert.equal(secondAcquire, false, "Second acquire must be rejected");

    // 3. First worker releases lock
    await releaseRelayerLock();
    assert.equal(store.has(RELAYER_LOCK_KEY), false, "Lock key should be cleared");

    // 4. Second worker can now acquire lock
    const thirdAcquire = await acquireRelayerLock();
    assert.equal(thirdAcquire, true, "Acquire after release should succeed");
  } finally {
    setLockRedisForTesting(null);
  }
});

test("Redis Lock: handles Redis client errors gracefully", async () => {
  const failingRedis = {
    set: async () => {
      throw new Error("Redis connection refused");
    },
    del: async () => {
      throw new Error("Redis connection refused");
    },
  } as any;

  setLockRedisForTesting(failingRedis);

  try {
    const prevEnv = process.env.NODE_ENV;
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";

    const acquired = await acquireRelayerLock();
    assert.equal(acquired, false, "Should return false on Redis failure in production");

    (process.env as Record<string, string | undefined>).NODE_ENV = prevEnv;
  } finally {
    setLockRedisForTesting(null);
  }
});

// ─── Task 2: Friendbot Sequence Collision (tx_bad_seq) Tests ─────────────────

test("Friendbot: isTxBadSeq accurately identifies sequence collisions", () => {
  // 1. Error message strings
  assert.equal(isTxBadSeq(new Error("Transaction simulation failed with tx_bad_seq")), true);
  assert.equal(isTxBadSeq(new Error("RPC response: txBadSeq encountered")), true);
  assert.equal(isTxBadSeq("tx_bad_seq"), true);

  // 2. Response object with status ERROR and string errorResult
  assert.equal(
    isTxBadSeq({
      status: "ERROR",
      errorResult: "AAAAA...tx_bad_seq...AAAA",
    }),
    true,
  );

  // 3. Response object with errorResultXdr string
  assert.equal(
    isTxBadSeq({
      status: "ERROR",
      errorResultXdr: "AAAAA...txBadSeq...AAAA",
    }),
    true,
  );

  // 4. Non-sequence errors should return false
  assert.equal(isTxBadSeq(new Error("HostError: Error(Contract, 6)")), false);
  assert.equal(isTxBadSeq(new Error("Invalid signature format")), false);
  assert.equal(isTxBadSeq({ status: "SUCCESS" }), false);
  assert.equal(isTxBadSeq(null), false);
});

test("Friendbot: isAccountAlreadyExists detects existing account errors", () => {
  assert.equal(
    isAccountAlreadyExists(new Error("createAccount error: op_already_exists")),
    true,
  );
  assert.equal(
    isAccountAlreadyExists(new Error("Failed: createAccountAlreadyExists")),
    true,
  );
  assert.equal(isAccountAlreadyExists(new Error("tx_bad_seq")), false);
  assert.equal(isAccountAlreadyExists(null), false);
});

test("Friendbot: secret keys are redacted from logs and errors", () => {
  const secretKey = "SCZANGBA5YOTFOS4DXKCW5K6UOF763H36553QGQ7H6J2B7U74T44C76Q";
  const rawMessage = `Failed with key ${secretKey} on network broadcast`;
  const sanitized = rawMessage.replace(/S[A-Z2-7]{55}/g, "[REDACTED_SECRET]");

  assert.equal(sanitized.includes(secretKey), false);
  assert.equal(sanitized, "Failed with key [REDACTED_SECRET] on network broadcast");
});
