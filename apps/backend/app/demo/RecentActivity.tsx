"use client";

import { ArrowDownLeft, ArrowUpRight, Clock3 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  DEMO_REFRESH_TYPE,
  mergeDemoHistory,
  readLocalDemoHistory,
  type DemoActivityTag,
  type DemoHistoryItem,
} from './demo-events';

type Props = {
  publicKey: string;
  shortId: string;
  sessionId: string;
  tag: DemoActivityTag;
};

export function RecentActivity({ publicKey, shortId, sessionId, tag }: Props) {
  const [items, setItems] = useState<DemoHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const local = readLocalDemoHistory(sessionId, publicKey);
    let remote: DemoHistoryItem[] = [];
    try {
      const params = new URLSearchParams({ publicKey, shortId });
      const response = await fetch(`/api/wallet/history?${params}`, {
        cache: 'no-store',
      });
      if (response.ok) {
        const payload = (await response.json()) as {
          transactions?: DemoHistoryItem[];
        };
        remote = payload.transactions ?? [];
      }
    } catch {
      // Local activity remains useful if the history service is unavailable.
    }
    setItems(mergeDemoHistory(remote, local, tag));
    setLoading(false);
  }, [publicKey, sessionId, shortId, tag]);

  useEffect(() => {
    const initialRefresh = window.setTimeout(() => void refresh(), 0);
    const handleRefresh = () => void refresh();
    const handleMessage = (event: MessageEvent) => {
      if (
        event.origin === window.location.origin &&
        event.data?.type === DEMO_REFRESH_TYPE &&
        event.data?.sessionId === sessionId
      ) {
        void refresh();
      }
    };
    window.addEventListener(DEMO_REFRESH_TYPE, handleRefresh);
    window.addEventListener('message', handleMessage);
    window.addEventListener('focus', handleRefresh);
    return () => {
      window.clearTimeout(initialRefresh);
      window.removeEventListener(DEMO_REFRESH_TYPE, handleRefresh);
      window.removeEventListener('message', handleMessage);
      window.removeEventListener('focus', handleRefresh);
    };
  }, [refresh, sessionId]);

  return (
    <section aria-labelledby="recent-activity-heading">
      <h3 id="recent-activity-heading" className="font-bold text-neutral-800 mb-3">
        Recent Activity
      </h3>
      {loading ? (
        <p className="py-6 text-center text-xs text-neutral-400">Loading activity…</p>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center py-6 text-neutral-400">
          <Clock3 size={22} aria-hidden="true" />
          <p className="mt-2 text-xs">No recent {tag === 'WALLET' ? 'online' : 'offline'} activity.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => {
            const debit = item.amount.startsWith('-');
            return (
              <li
                key={item.id}
                className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50/70 px-3 py-2.5"
              >
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                    debit ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'
                  }`}
                >
                  {debit ? <ArrowUpRight size={16} /> : <ArrowDownLeft size={16} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-bold text-slate-800">
                    {item.title}
                  </span>
                  <span className="block text-[10px] font-medium text-slate-400">
                    {item.status.replaceAll('_', ' ')}
                  </span>
                </span>
                <span className={`text-xs font-black ${debit ? 'text-rose-600' : 'text-emerald-600'}`}>
                  {debit ? '−' : '+'}₱{item.amount.replace(/^-/, '')}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
