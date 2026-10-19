/**
 * @file lib/sms-health.ts
 *
 * TextBee device status for `/api/health?deep=1`. Uses the TextBee device list
 * (`GET /gateway/devices`) and caches the answer in Redis for 30s so health
 * polling never hammers the gateway. Unknown response shapes degrade to
 * `status: "unknown"` instead of failing.
 */

import { getRedis } from "@/lib/rate-limit";

const DEVICES_URL = "https://api.textbee.dev/api/v1/gateway/devices";
const CACHE_KEY = "pijin:health:textbee";
const CACHE_TTL_SECONDS = 30;
const STALE_HEARTBEAT_MS = 10 * 60 * 1000;

export type DeviceStatus = {
  role: "primary" | "fallback";
  deviceId: string | null;
  status: "online" | "offline" | "disabled" | "unknown" | "unconfigured";
  lastHeartbeat?: string;
  detail?: string;
};

type DeviceRecord = Record<string, unknown>;

function heartbeatOf(device: DeviceRecord): string | undefined {
  const value = device.lastHeartbeat ?? device.updatedAt;
  return typeof value === "string" ? value : undefined;
}

export function classifyDevice(device: DeviceRecord | undefined, now = Date.now()): Pick<DeviceStatus, "status" | "lastHeartbeat" | "detail"> {
  if (!device) return { status: "unknown", detail: "Device not found in TextBee account" };
  if (device.enabled === false) return { status: "disabled", lastHeartbeat: heartbeatOf(device) };
  const lastHeartbeat = heartbeatOf(device);
  if (!lastHeartbeat) return { status: "unknown", detail: "No heartbeat reported" };
  const age = now - Date.parse(lastHeartbeat);
  if (Number.isNaN(age)) return { status: "unknown", lastHeartbeat };
  return { status: age <= STALE_HEARTBEAT_MS ? "online" : "offline", lastHeartbeat };
}

async function fetchDevices(apiKey: string): Promise<DeviceRecord[]> {
  const response = await fetch(DEVICES_URL, {
    headers: { "x-api-key": apiKey },
    signal: AbortSignal.timeout(3000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const json = (await response.json()) as { data?: unknown };
  return Array.isArray(json?.data) ? (json.data as DeviceRecord[]) : [];
}

async function loadStatuses(): Promise<DeviceStatus[]> {
  const targets: Array<{ role: DeviceStatus["role"]; deviceId?: string; apiKey?: string }> = [
    { role: "primary", deviceId: process.env.TEXTBEE_DEVICE_ID?.trim(), apiKey: process.env.TEXTBEE_API_KEY },
    {
      role: "fallback",
      deviceId: process.env.TEXTBEE_FALLBACK_DEVICE_ID?.trim(),
      apiKey: process.env.TEXTBEE_FALLBACK_API_KEY || process.env.TEXTBEE_API_KEY,
    },
  ];

  const devicesByKey = new Map<string, Promise<DeviceRecord[]>>();
  return Promise.all(
    targets.map(async ({ role, deviceId, apiKey }): Promise<DeviceStatus> => {
      if (!deviceId || !apiKey) return { role, deviceId: deviceId ?? null, status: "unconfigured" };
      try {
        if (!devicesByKey.has(apiKey)) devicesByKey.set(apiKey, fetchDevices(apiKey));
        const devices = await devicesByKey.get(apiKey)!;
        const device = devices.find((d) => d._id === deviceId || d.id === deviceId);
        return { role, deviceId, ...classifyDevice(device) };
      } catch (err) {
        return { role, deviceId, status: "unknown", detail: err instanceof Error ? err.message : String(err) };
      }
    }),
  );
}

export async function getTextbeeStatus(): Promise<DeviceStatus[]> {
  const redis = getRedis();
  try {
    const cached = await redis.get<DeviceStatus[]>(CACHE_KEY);
    if (cached) return cached;
  } catch {
    // Cache is best-effort.
  }
  const statuses = await loadStatuses();
  try {
    await redis.set(CACHE_KEY, statuses, { ex: CACHE_TTL_SECONDS });
  } catch {
    // Cache is best-effort.
  }
  return statuses;
}
