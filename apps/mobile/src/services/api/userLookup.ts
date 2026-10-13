import { getApiBaseUrl } from '../../constants/api';
import { apiFetch } from './client';

export interface LookedUpUser {
  shortId: string;
  stellarPublicKey: string;
  offlineDeviceKey: string | null;
  displayName: string;
}

const CACHE_TTL_MS = 60_000;
const MAX_CACHE_ENTRIES = 50;

const cache = new Map<string, { user: LookedUpUser; at: number }>();
const inFlight = new Map<string, Promise<LookedUpUser | null>>();

/** A numeric query of 7+ digits is a phone number; anything else is a Short ID. */
export function isPhoneQuery(q: string): boolean {
  return /^\d+$/.test(q) && q.length >= 7;
}

/**
 * Resolves a Short ID or phone number via GET /api/users/lookup.
 * Successful hits are cached for 60s and concurrent identical lookups share one
 * request, so double-taps and repeat checks (search modal → Continue) cost one call.
 * Returns null when no account exists; throws on any other failure.
 */
export function lookupUser(rawQuery: string): Promise<LookedUpUser | null> {
  const q = rawQuery.trim();
  const hit = cache.get(q);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return Promise.resolve(hit.user);

  const pending = inFlight.get(q);
  if (pending) return pending;

  const paramKey = isPhoneQuery(q) ? 'phone' : 'shortId';
  const request = (async () => {
    const res = await apiFetch(
      `${getApiBaseUrl()}/api/users/lookup?${paramKey}=${encodeURIComponent(q)}`,
      { retries: 0 },
    );
    if (res.status === 404) return null;
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as { error?: string }).error ?? `Lookup failed (HTTP ${res.status})`);
    }
    const data = await res.json();
    if (!data.found) return null;
    const user: LookedUpUser = {
      shortId: data.shortId,
      stellarPublicKey: data.stellarPublicKey,
      offlineDeviceKey: data.offlineDeviceKey ?? null,
      displayName: data.displayName,
    };
    if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value as string);
    cache.set(q, { user, at: Date.now() });
    return user;
  })().finally(() => inFlight.delete(q));

  inFlight.set(q, request);
  return request;
}
