import * as SecureStore from 'expo-secure-store';
import { getApiBaseUrl } from '../../constants/api';

const JWT_KEY = 'omnifi.auth.jwt';

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

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiRequest<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const url = `${getApiBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
  const jwt = await getStoredJwt();

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(init?.headers ?? {}),
  };

  if (jwt) {
    (headers as Record<string, string>)['Authorization'] = `Bearer ${jwt}`;
  }

  const response = await fetch(url, {
    ...init,
    headers,
  });

  let body: unknown = null;
  const text = await response.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!response.ok) {
    const message =
      typeof body === 'object' &&
      body !== null &&
      'error' in body &&
      typeof (body as { error: unknown }).error === 'string'
        ? (body as { error: string }).error
        : `Request failed (${response.status})`;
    throw new ApiError(message, response.status, body);
  }

  return body as T;
}
