import * as SecureStore from 'expo-secure-store';
import { getApiBaseUrl } from '../../constants/api';

const JWT_KEY = 'pijin.auth.jwt';

export const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RETRY_AFTER_MS = 10_000;

export async function getStoredJwt(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(JWT_KEY);
  } catch {
    return null;
  }
}

export async function setStoredJwt(token: string | null): Promise<void> {
  try {
    if (token) {
      await SecureStore.setItemAsync(JWT_KEY, token);
    } else {
      await SecureStore.deleteItemAsync(JWT_KEY);
    }
  } catch {}
}

/**
 * `status` is the HTTP status, or 0 when no response arrived
 * (`kind` = 'timeout' | 'network').
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: unknown,
    public readonly kind: 'http' | 'timeout' | 'network' = 'http'
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export type ApiRequestInit = RequestInit & {
  /** Per-attempt timeout. Default 15s. */
  timeoutMs?: number;
  /** Extra attempts on network errors, timeouts, 408, 429 and 5xx. Default 2 for GET/HEAD, 0 otherwise. */
  retries?: number;
  /** Attach the stored SEP-10 JWT when the caller set no Authorization header. Default true. */
  auth?: boolean;
};

// ---------------------------------------------------------------------------
// Re-authentication
// ---------------------------------------------------------------------------

type ReauthHandler = () => Promise<string | null>;
let reauthHandler: ReauthHandler | null = null;
let reauthInFlight: Promise<string | null> | null = null;

/**
 * Registers how to obtain a fresh SEP-10 JWT after a 401 (see AuthContext).
 * Concurrent 401s share one re-auth attempt.
 */
export function setReauthHandler(handler: ReauthHandler | null): void {
  reauthHandler = handler;
}

async function refreshJwt(): Promise<string | null> {
  if (!reauthHandler) return null;
  if (!reauthInFlight) {
    reauthInFlight = reauthHandler()
      .then(async (token) => {
        if (token) await setStoredJwt(token);
        return token;
      })
      .catch((err) => {
        console.warn('[api] Re-authentication failed:', err);
        return null;
      })
      .finally(() => {
        reauthInFlight = null;
      });
  }
  return reauthInFlight;
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function backoffMs(attempt: number, retryAfterHeader: string | null): number {
  const retryAfter = Number(retryAfterHeader);
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1000, MAX_RETRY_AFTER_MS);
  }
  return 500 * 2 ** attempt + Math.random() * 250;
}

/**
 * fetch with a timeout, for any URL (Soroban RPC, Horizon, anchor).
 * Throws ApiError(kind 'timeout' | 'network') when no response arrives.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const callerSignal = init.signal;
  const onCallerAbort = () => controller.abort();
  callerSignal?.addEventListener?.('abort', onCallerAbort);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (callerSignal?.aborted) throw err;
    if (controller.signal.aborted) {
      throw new ApiError('The server took too long to respond. Please try again.', 0, undefined, 'timeout');
    }
    throw new ApiError('Network error. Please check your connection and try again.', 0, err, 'network');
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener?.('abort', onCallerAbort);
  }
}

function hasAuthorizationHeader(headers: Record<string, string>): boolean {
  return Object.keys(headers).some((key) => key.toLowerCase() === 'authorization');
}

/**
 * Backend request returning the raw Response (for callers that inspect status
 * codes or headers). Adds timeout, retry with backoff for idempotent requests,
 * JWT attachment, and one silent re-auth + retry on 401.
 */
export async function apiFetch(path: string, init: ApiRequestInit = {}): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, retries, auth = true, ...requestInit } = init;
  const url = /^https?:\/\//.test(path)
    ? path
    : `${getApiBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
  const method = (requestInit.method ?? 'GET').toUpperCase();
  const maxRetries = retries ?? (method === 'GET' || method === 'HEAD' ? 2 : 0);

  const baseHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((requestInit.headers as Record<string, string> | undefined) ?? {}),
  };
  // Never overwrite a caller-supplied Authorization (e.g. engine routes sign requests).
  const attachJwt = auth && !hasAuthorizationHeader(baseHeaders);
  let jwt = attachJwt ? await getStoredJwt() : null;
  let reauthed = false;

  for (let attempt = 0; ; attempt++) {
    const headers = { ...baseHeaders };
    if (jwt) headers.Authorization = `Bearer ${jwt}`;

    let response: Response;
    try {
      response = await fetchWithTimeout(url, { ...requestInit, headers }, timeoutMs);
    } catch (err) {
      if (err instanceof ApiError && attempt < maxRetries) {
        await sleep(backoffMs(attempt, null));
        continue;
      }
      throw err;
    }

    if (response.status === 401 && jwt && !reauthed) {
      reauthed = true;
      const fresh = await refreshJwt();
      if (fresh) {
        jwt = fresh;
        attempt--; // the re-auth retry doesn't count against network retries
        continue;
      }
    }

    if (isRetryableStatus(response.status) && attempt < maxRetries) {
      await sleep(backoffMs(attempt, response.headers.get('Retry-After')));
      continue;
    }

    return response;
  }
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function errorMessageFor(status: number, body: unknown): string {
  if (typeof body === 'object' && body !== null && 'error' in body) {
    const error = (body as { error: unknown }).error;
    if (typeof error === 'string') return error;
  }
  if (status === 429) return 'Too many requests. Please wait a moment and try again.';
  if (status >= 500) return 'The service is busy. Please try again shortly.';
  return `Request failed (${status})`;
}

/** Backend request that parses JSON and throws ApiError on non-2xx. */
export async function apiRequest<T>(path: string, init?: ApiRequestInit): Promise<T> {
  const response = await apiFetch(path, init);
  const body = await readBody(response);

  if (!response.ok) {
    throw new ApiError(errorMessageFor(response.status, body), response.status, body);
  }

  return body as T;
}
