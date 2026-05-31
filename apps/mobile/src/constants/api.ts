const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL?.replace(/\/$/, '') ?? '';

export function getApiBaseUrl(): string {
  if (!apiBaseUrl) {
    throw new Error(
      'Missing EXPO_PUBLIC_API_BASE_URL. Set it in apps/mobile/.env (use ngrok URL or LAN URL reachable from phone).'
    );
  }
  return apiBaseUrl;
}

export const SMS_SIMULATE_SECRET =
  process.env.EXPO_PUBLIC_SMS_SIMULATE_SECRET ?? 'dev-simulate';

export const SMS_GATEWAY_NUMBER = process.env.EXPO_PUBLIC_SMS_GATEWAY_NUMBER ?? '';
