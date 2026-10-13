/**
 * @file lib/rate-limit.ts
 *
 * Shared Upstash limiter factory and client-IP extraction.
 *
 * NOTE: limits are per IP. Testers on the same venue Wi-Fi share one public IP,
 * so per-IP budgets here are intentionally generous.
 */

import { NextRequest, NextResponse } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

type Window = Parameters<typeof Ratelimit.slidingWindow>[1];

let redisClient: Redis | null = null;

export function getRedis(): Redis {
  if (!redisClient) redisClient = Redis.fromEnv();
  return redisClient;
}

export function createLimiter(prefix: string, tokens: number, window: Window): Ratelimit {
  return new Ratelimit({
    redis: getRedis(),
    limiter: Ratelimit.slidingWindow(tokens, window),
    analytics: false,
    prefix,
  });
}

/** First hop of `x-forwarded-for` (the client), falling back to `x-real-ip`. */
export function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || req.headers.get("x-real-ip")?.trim() || "127.0.0.1";
}

/** Returns a 429 response when the limit is exceeded, otherwise null. */
export async function enforceLimit(limiter: Ratelimit, key: string): Promise<NextResponse | null> {
  const { success, reset } = await limiter.limit(key);
  if (success) return null;
  const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
  return NextResponse.json(
    { error: "Too many requests. Please try again later." },
    { status: 429, headers: { "Retry-After": String(retryAfter) } },
  );
}
