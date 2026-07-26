export type DemoRole = 'sender' | 'receiver';
export type DemoEventPhase = 'pending' | 'success' | 'error' | 'info';
export type DemoActivityTag = 'WALLET' | 'OFFLINE';

export type DemoEvent = {
  type: 'pijin:demo-event';
  id: string;
  sessionId: string;
  role: DemoRole;
  phase: DemoEventPhase;
  title: string;
  message: string;
  timestamp: string;
  tag?: DemoActivityTag;
  amount?: string;
  assetCode?: string;
  txHash?: string;
};

export type DemoHistoryItem = {
  id: string;
  type: 'SEND' | 'RECEIVE' | 'TRANSFER' | 'WITHDRAWAL';
  tag: DemoActivityTag;
  title: string;
  amount: string;
  assetCode: string;
  status: string;
  timestamp: string;
  txHash?: string;
};

const STORAGE_PREFIX = 'pijin.demo.activity.v1';
export const DEMO_EVENT_TYPE = 'pijin:demo-event';
export const DEMO_REFRESH_TYPE = 'pijin:demo-refresh';

function storageKey(sessionId: string, publicKey: string) {
  return `${STORAGE_PREFIX}:${sessionId}:${publicKey}`;
}

export function createDemoEvent(
  input: Omit<DemoEvent, 'type' | 'timestamp'> & { timestamp?: string },
): DemoEvent {
  return {
    ...input,
    type: DEMO_EVENT_TYPE,
    timestamp: input.timestamp ?? new Date().toISOString(),
  };
}

export function isDemoEvent(value: unknown): value is DemoEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Partial<DemoEvent>;
  return (
    event.type === DEMO_EVENT_TYPE &&
    typeof event.id === 'string' &&
    typeof event.sessionId === 'string' &&
    (event.role === 'sender' || event.role === 'receiver') &&
    ['pending', 'success', 'error', 'info'].includes(event.phase ?? '') &&
    typeof event.title === 'string' &&
    typeof event.message === 'string' &&
    typeof event.timestamp === 'string'
  );
}

export function publishDemoEvent(event: DemoEvent) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(DEMO_EVENT_TYPE, { detail: event }));
  window.parent.postMessage(event, window.location.origin);
}

export function readLocalDemoHistory(
  sessionId: string,
  publicKey: string,
): DemoHistoryItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = sessionStorage.getItem(storageKey(sessionId, publicKey));
    const parsed = raw ? (JSON.parse(raw) as DemoHistoryItem[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function recordLocalDemoHistory(
  sessionId: string,
  publicKey: string,
  item: DemoHistoryItem,
) {
  if (typeof window === 'undefined') return;
  const next = [
    item,
    ...readLocalDemoHistory(sessionId, publicKey).filter(
      (existing) => existing.id !== item.id,
    ),
  ]
    .sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    )
    .slice(0, 50);
  sessionStorage.setItem(storageKey(sessionId, publicKey), JSON.stringify(next));
  window.dispatchEvent(new Event(DEMO_REFRESH_TYPE));
  window.parent.postMessage(
    { type: DEMO_REFRESH_TYPE, sessionId },
    window.location.origin,
  );
}

export function mergeDemoHistory(
  remote: DemoHistoryItem[],
  local: DemoHistoryItem[],
  tag: DemoActivityTag,
): DemoHistoryItem[] {
  const byId = new Map<string, DemoHistoryItem>();
  for (const item of [...remote, ...local]) {
    if (item.tag !== tag) continue;
    const key = item.txHash ? `hash:${item.txHash}` : item.id;
    if (!byId.has(key)) byId.set(key, item);
  }
  return [...byId.values()]
    .sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    )
    .slice(0, 5);
}
