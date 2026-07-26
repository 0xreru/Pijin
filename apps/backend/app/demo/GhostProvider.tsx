"use client";

import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  claimDemoSession,
  demoAccessCode,
  DEMO_SESSION_STORAGE_KEY,
  type DemoSessionPayload,
  retireDemoSession,
} from './demo-session-client';

type JudgeRole = 'sender' | 'receiver';

interface JudgeContextType {
  publicKey: string;
  secretKey: string;
  deviceSecretKey: string;
  devicePublicKey: string;
  shortId: string;
  role: JudgeRole;
  sessionId: string;
  resetDemoSession: () => Promise<void>;
}

const JudgeContext = createContext<JudgeContextType | null>(null);

export function useJudgeContext() {
  const context = useContext(JudgeContext);
  if (!context) throw new Error('useJudgeContext must be used within GhostProvider');
  return context;
}

function storedSession(): DemoSessionPayload | null {
  const raw = sessionStorage.getItem(DEMO_SESSION_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DemoSessionPayload;
  } catch {
    sessionStorage.removeItem(DEMO_SESSION_STORAGE_KEY);
    return null;
  }
}

export default function GhostProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [status, setStatus] = useState('Loading demo session...');
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<DemoSessionPayload | null>(null);
  const [role, setRole] = useState<JudgeRole>('sender');
  const [accessCode, setAccessCode] = useState('');

  const activateSession = (payload: DemoSessionPayload) => {
    sessionStorage.setItem(DEMO_SESSION_STORAGE_KEY, JSON.stringify(payload));
    setSession(payload);
    setError(null);
  };

  useEffect(() => {
    let cancelled = false;

    const initialize = async () => {
      // Yield once so this effect synchronizes with browser storage without
      // triggering a synchronous set-state cascade.
      await Promise.resolve();
      const searchParams = new URLSearchParams(window.location.search);
      const requestedRole: JudgeRole =
        searchParams.get('role') === 'receiver' ? 'receiver' : 'sender';
      const requestedSessionId = searchParams.get('session')?.trim();
      const resolvedAccessCode = demoAccessCode(searchParams);
      const cached = storedSession();

      if (cancelled) return;
      setRole(requestedRole);
      setAccessCode(resolvedAccessCode);

      if (cached && (!requestedSessionId || cached.sessionId === requestedSessionId)) {
        setSession(cached);
        setLoading(false);
        return;
      }

      if (!requestedSessionId) {
        setLoading(false);
        return;
      }

      setStatus('Claiming your isolated Testnet account pair...');
      try {
        const payload = await claimDemoSession(requestedSessionId, resolvedAccessCode);
        if (!cancelled) activateSession(payload);
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : 'Unable to claim demo session');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void initialize();
    return () => {
      cancelled = true;
    };
  }, []);

  const startSession = async () => {
    setClaiming(true);
    setError(null);
    setStatus('Claiming your isolated Testnet account pair...');
    try {
      const payload = await claimDemoSession(crypto.randomUUID(), accessCode);
      activateSession(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to claim demo session');
    } finally {
      setClaiming(false);
    }
  };

  const resetDemoSession = async () => {
    if (!session) return;
    try {
      await retireDemoSession(session.sessionId, accessCode);
    } finally {
      sessionStorage.removeItem(DEMO_SESSION_STORAGE_KEY);
      if (window.top && window.top !== window) {
        window.top.location.reload();
      } else {
        window.location.assign('/demo');
      }
    }
  };

  if (loading || claiming) {
    return (
      <div className="flex-1 bg-black text-white flex flex-col items-center justify-center p-8 text-center space-y-6">
        <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
        <div className="text-xl font-bold tracking-wide">Pijin</div>
        <p className="text-sm text-neutral-400">{status}</p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex-1 bg-black text-white flex flex-col items-center justify-center p-8 text-center">
        <div className="text-2xl font-black tracking-tight">Pijin Judge Demo</div>
        <p className="mt-3 text-sm text-neutral-400 max-w-xs">
          Start a disposable Testnet session with two isolated phone accounts.
        </p>
        {error && (
          <p className="mt-5 rounded-xl bg-red-950 px-4 py-3 text-xs text-red-200">
            {error}
          </p>
        )}
        <button
          type="button"
          onClick={startSession}
          className="mt-8 rounded-full bg-blue-600 px-6 py-3 text-sm font-bold text-white hover:bg-blue-500"
        >
          Start Fresh Demo Session
        </button>
      </div>
    );
  }

  const account = session[role];
  const context: JudgeContextType = {
    publicKey: account.publicKey,
    secretKey: account.walletSecret,
    deviceSecretKey: account.deviceSecret,
    devicePublicKey: account.devicePublicKey,
    shortId: account.shortId,
    role,
    sessionId: session.sessionId,
    resetDemoSession,
  };

  return <JudgeContext.Provider value={context}>{children}</JudgeContext.Provider>;
}
