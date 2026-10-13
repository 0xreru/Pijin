/**
 * Single source of truth for backend hosts.
 *
 * Canonical production API: https://pijin-api.vercel.app (also the SEP-10 anchor
 * home domain). Builds set EXPO_PUBLIC_API_BASE_URL via eas.json; the default
 * below is the same value so a missing variable can't point testers elsewhere.
 */

export const DEFAULT_API_BASE_URL = 'https://pijin-api.vercel.app';

function cleanUrl(raw: string | undefined): string | null {
  const value = raw?.trim().replace(/^['"]|['"]$/g, '').replace(/\/$/, '');
  return value ? value : null;
}

function resolveApiBaseUrl(): string {
  const configured = cleanUrl(process.env.EXPO_PUBLIC_API_BASE_URL);
  if (!configured) {
    if (__DEV__) console.warn(`[api] EXPO_PUBLIC_API_BASE_URL not set; using ${DEFAULT_API_BASE_URL}`);
    return DEFAULT_API_BASE_URL;
  }
  // Release builds must talk to an https host; anything else is a misconfigured build.
  if (!__DEV__ && !configured.startsWith('https://')) {
    console.error(`[api] Refusing non-https API base URL in release build: ${configured}`);
    return DEFAULT_API_BASE_URL;
  }
  return configured;
}

const apiBaseUrl = resolveApiBaseUrl();

export function getApiBaseUrl(): string {
  return apiBaseUrl;
}

/** SEP-10/SEP-24 home domain: explicit override, otherwise the API host. */
export function getAnchorDomain(): string {
  const override = cleanUrl(process.env.EXPO_PUBLIC_ANCHOR_DOMAIN);
  if (override) return override.replace(/^https?:\/\//, '');
  return apiBaseUrl.replace(/^https?:\/\//, '');
}

export const SMS_SIMULATE_SECRET =
  process.env.EXPO_PUBLIC_SMS_SIMULATE_SECRET ?? 'dev-simulate';

export const SMS_GATEWAY_NUMBER = process.env.EXPO_PUBLIC_SMS_GATEWAY_NUMBER ?? '';
