"use client";

import { useEffect, useState } from 'react';
import {
  claimDemoSession,
  demoAccessCode,
  DEMO_SESSION_STORAGE_KEY,
  type DemoSessionPayload,
} from '../demo/demo-session-client';

export default function SplitSimulatorPage() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const restore = async () => {
      await Promise.resolve();
      const raw = sessionStorage.getItem(DEMO_SESSION_STORAGE_KEY);
      if (!cancelled && raw) {
        try {
          const session = JSON.parse(raw) as DemoSessionPayload;
          setSessionId(session.sessionId);
        } catch {
          sessionStorage.removeItem(DEMO_SESSION_STORAGE_KEY);
        }
      }
      if (!cancelled) setRestoring(false);
    };
    void restore();
    return () => {
      cancelled = true;
    };
  }, []);

  const startSession = async () => {
    setLoading(true);
    setError(null);
    try {
      const searchParams = new URLSearchParams(window.location.search);
      const accessCode = demoAccessCode(searchParams);
      const nextSessionId = crypto.randomUUID();
      const session = await claimDemoSession(nextSessionId, accessCode);
      sessionStorage.setItem(DEMO_SESSION_STORAGE_KEY, JSON.stringify(session));
      setSessionId(nextSessionId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to start demo session');
    } finally {
      setLoading(false);
    }
  };

  if (restoring) {
    return (
      <main className="min-h-screen bg-[#111111] flex items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
      </main>
    );
  }

  if (!sessionId) {
    return (
      <main className="min-h-screen bg-[#111111] flex flex-col items-center justify-center px-6 text-center">
        <h1 className="text-4xl font-black text-white tracking-tight">Pijin P2P Simulation</h1>
        <p className="mt-3 text-neutral-400 font-medium">
          Start with a private pair of isolated phone accounts.
        </p>
        {error && (
          <p className="mt-5 rounded-xl bg-red-950 px-4 py-3 text-sm text-red-200">
            {error}
          </p>
        )}
        <button
          type="button"
          disabled={loading}
          onClick={startSession}
          className="mt-8 rounded-full bg-blue-600 px-7 py-4 font-bold text-white disabled:opacity-60"
        >
          {loading ? 'Preparing Testnet Accounts...' : 'Start Fresh Demo Session'}
        </button>
      </main>
    );
  }

  const encodedSession = encodeURIComponent(sessionId);
  return (
    <div className="min-h-screen bg-[#111111] flex flex-col items-center justify-center py-6 overflow-hidden">
      <div className="text-center mb-6">
        <h1 className="text-3xl font-black text-white tracking-tight">Pijin P2P Simulation</h1>
        <p className="text-neutral-400 font-medium mt-1">Isolated Judge Session</p>
      </div>

      <div
        className="flex flex-row items-center justify-center gap-8 md:gap-16 w-full"
        style={{
          transform: 'scale(min(1, min(100vw / 1000, 100vh / 1050)))',
          transformOrigin: 'top center',
        }}
      >
        <div className="flex flex-col items-center">
          <p className="text-neutral-500 font-bold uppercase tracking-widest mb-4">Phone 1</p>
          <iframe
            src={`/demo?role=sender&session=${encodedSession}`}
            className="w-[418px] h-[872px] border-none rounded-[3rem] shadow-2xl bg-black overflow-hidden"
            scrolling="no"
            title="Pijin Phone 1 simulator"
          />
        </div>

        <div className="flex flex-col items-center">
          <p className="text-neutral-500 font-bold uppercase tracking-widest mb-4">Phone 2</p>
          <iframe
            src={`/demo?role=receiver&session=${encodedSession}`}
            className="w-[418px] h-[872px] border-none rounded-[3rem] shadow-2xl bg-black overflow-hidden"
            scrolling="no"
            title="Pijin Phone 2 simulator"
          />
        </div>
      </div>
    </div>
  );
}
