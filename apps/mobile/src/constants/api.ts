const apiBaseUrl =
  process.env.EXPO_PUBLIC_API_BASE_URL?.trim().replace(/^['"]|['"]$/g, '').replace(/\/$/, '') ||
  'https://pijin-api.vercel.app';

export function getApiBaseUrl(): string {
  return apiBaseUrl;
}

export const SMS_SIMULATE_SECRET =
  process.env.EXPO_PUBLIC_SMS_SIMULATE_SECRET ?? 'dev-simulate';

export const SMS_GATEWAY_NUMBER = process.env.EXPO_PUBLIC_SMS_GATEWAY_NUMBER ?? '';
