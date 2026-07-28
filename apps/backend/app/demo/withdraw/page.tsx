"use client";

import { ArrowLeft, CheckCircle2, RefreshCw, WalletCards } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { isReadySep24WithdrawalMessage } from '@/lib/demo/sep24-withdrawal';
import {
  completeDemoSep24Withdrawal,
  startDemoSep24Withdrawal,
} from '../actions';
import {
  createDemoEvent,
  publishDemoEvent,
  recordLocalDemoHistory,
} from '../demo-events';
import { useJudgeContext } from '../GhostProvider';

type FlowState = 'starting' | 'interactive' | 'confirm' | 'submitting' | 'success' | 'error';

export default function DemoWithdrawalPage() {
  const router = useRouter();
  const { publicKey, role, sessionId } = useJudgeContext();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const startedRef = useRef(false);
  const readyRef = useRef(false);
  const [state, setState] = useState<FlowState>('starting');
  const [message, setMessage] = useState('Securing your anchor session…');
  const [url, setUrl] = useState('');
  const [transactionId, setTransactionId] = useState('');
  const [token, setToken] = useState('');
  const [amount, setAmount] = useState('');
  const [hash, setHash] = useState('');
  const [operationId] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    publishDemoEvent(
      createDemoEvent({
        id: operationId,
        sessionId,
        role,
        phase: 'pending',
        title: 'Starting SEP-24 withdrawal',
        message: 'Authenticating your Online Wallet with the Pijin anchor.',
      }),
    );
    const start = async () => {
      const result = await startDemoSep24Withdrawal(sessionId, role);
      if (!result.success) {
        setState('error');
        setMessage(result.error);
        publishDemoEvent(
          createDemoEvent({
            id: operationId,
            sessionId,
            role,
            phase: 'error',
            title: 'Withdrawal unavailable',
            message: result.error,
          }),
        );
        return;
      }
      setUrl(result.url);
      setTransactionId(result.transactionId);
      setToken(result.token);
      setState('interactive');
      setMessage('Enter your withdrawal details in the secure anchor form.');
    };
    void start();
  }, [operationId, role, sessionId]);

  const markReadyForTransfer = useCallback(() => {
    if (readyRef.current) return;
    readyRef.current = true;
    setState('confirm');
    setMessage('Your payout details are ready. Approve the PHPC transfer to continue.');
    publishDemoEvent(
      createDemoEvent({
        id: operationId,
        sessionId,
        role,
        phase: 'info',
        title: 'Withdrawal ready for approval',
        message: 'Review and approve the PHPC transfer from the Online Wallet.',
      }),
    );
  }, [operationId, role, sessionId]);

  // Prefer the interactive form's callback, while accepting both the legacy
  // Pijin message and the SEP-24 transaction callback shape.
  useEffect(() => {
    if (!url || !transactionId) return;
    const interactiveOrigin = new URL(url, window.location.href).origin;
    const handleHandoff = (event: MessageEvent) => {
      if (
        event.origin === interactiveOrigin &&
        event.source === iframeRef.current?.contentWindow &&
        isReadySep24WithdrawalMessage(event.data, transactionId)
      ) {
        markReadyForTransfer();
      }
    };
    window.addEventListener('message', handleHandoff);
    return () => window.removeEventListener('message', handleHandoff);
  }, [markReadyForTransfer, transactionId, url]);

  // SEP-24 explicitly allows wallets to poll /transaction. This prevents the
  // demo from hanging if a browser drops or blocks the iframe callback.
  useEffect(() => {
    if (state !== 'interactive' || !transactionId || !token) return;

    const controller = new AbortController();
    let timer: number | undefined;
    let attempts = 0;

    const poll = async () => {
      attempts += 1;
      try {
        const response = await fetch(
          `/api/sep24/transaction?id=${encodeURIComponent(transactionId)}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            cache: 'no-store',
            signal: controller.signal,
          },
        );
        const payload = (await response.json()) as unknown;
        if (
          response.ok &&
          isReadySep24WithdrawalMessage(payload, transactionId)
        ) {
          markReadyForTransfer();
          return;
        }
        if (response.status === 401 || response.status === 404) {
          setState('error');
          setMessage('The authenticated withdrawal session is no longer available.');
          return;
        }
      } catch (error: unknown) {
        if (controller.signal.aborted) return;
        if (attempts >= 120) {
          setState('error');
          setMessage(
            error instanceof Error
              ? error.message
              : 'Timed out waiting for the anchor withdrawal instructions.',
          );
          return;
        }
      }

      if (attempts >= 120) {
        setState('error');
        setMessage('Timed out waiting for the anchor withdrawal instructions.');
        return;
      }

      if (!controller.signal.aborted) {
        timer = window.setTimeout(() => void poll(), 1_000);
      }
    };

    void poll();
    return () => {
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [markReadyForTransfer, state, token, transactionId]);

  const complete = async () => {
    setState('submitting');
    setMessage('Signing the PHPC transfer and waiting for anchor verification…');
    const result = await completeDemoSep24Withdrawal(
      sessionId,
      role,
      transactionId,
      token,
    );
    if (!result.success) {
      setState('error');
      setMessage(result.error);
      publishDemoEvent(
        createDemoEvent({
          id: operationId,
          sessionId,
          role,
          phase: 'error',
          title: 'Withdrawal failed',
          message: result.error,
        }),
      );
      return;
    }
    setAmount(result.amount);
    setHash(result.hash);
    setState('success');
    recordLocalDemoHistory(sessionId, publicKey, {
      id: transactionId,
      type: 'WITHDRAWAL',
      tag: 'WALLET',
      title: 'Wallet Withdrawal',
      amount: `-${result.amount}`,
      assetCode: 'PHPC',
      status: result.status.toUpperCase(),
      timestamp: new Date().toISOString(),
    });
    publishDemoEvent(
      createDemoEvent({
        id: operationId,
        sessionId,
        role,
        phase: 'success',
        title: 'Withdrawal transfer confirmed',
        message: `₱${result.amount} PHPC was received by the anchor. GCash payout is pending.`,
        tag: 'WALLET',
        amount: result.amount,
        assetCode: 'PHPC',
        txHash: result.hash,
      }),
    );
  };

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden rounded-[2rem] bg-[#F5F5F6] text-slate-950">
      <header className="flex items-center gap-4 bg-white px-6 pb-5 pt-10 shadow-sm">
        <button type="button" onClick={() => router.push('/demo')} aria-label="Back to dashboard">
          <ArrowLeft size={24} />
        </button>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#1e3e62]">
            SEP-24
          </p>
          <h1 className="text-xl font-black">Withdraw PHPC</h1>
        </div>
      </header>

      {state === 'interactive' && url ? (
        <iframe
          ref={iframeRef}
          src={url}
          title="Pijin SEP-24 withdrawal form"
          className="min-h-0 flex-1 border-0 bg-white"
        />
      ) : (
        <main className="flex flex-1 flex-col items-center justify-center p-6 text-center">
          {state === 'success' ? (
            <>
              <span className="flex h-24 w-24 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                <CheckCircle2 size={50} />
              </span>
              <h2 className="mt-6 text-2xl font-black">Transfer Confirmed</h2>
              <p className="mt-2 text-sm font-medium leading-relaxed text-slate-500">
                ₱{amount} PHPC reached the anchor. Your GCash payout is now pending processing.
              </p>
              <p className="mt-5 break-all rounded-2xl bg-slate-900 p-4 text-left font-mono text-[10px] text-emerald-400">
                {hash}
              </p>
              <button
                type="button"
                onClick={() => router.push('/demo')}
                className="mt-auto w-full rounded-full bg-black py-4 font-bold text-white"
              >
                Back to Dashboard
              </button>
            </>
          ) : (
            <>
              <span className="flex h-20 w-20 items-center justify-center rounded-full bg-blue-50 text-[#1e3e62]">
                {state === 'starting' || state === 'submitting' ? (
                  <RefreshCw size={34} className="animate-spin" />
                ) : (
                  <WalletCards size={34} />
                )}
              </span>
              <h2 className="mt-5 text-xl font-black">
                {state === 'confirm'
                  ? 'Approve Wallet Transfer'
                  : state === 'error'
                    ? 'Withdrawal Could Not Continue'
                    : 'Preparing Withdrawal'}
              </h2>
              <p
                role={state === 'error' ? 'alert' : 'status'}
                className={`mt-2 max-w-xs text-sm font-medium leading-relaxed ${
                  state === 'error' ? 'text-red-600' : 'text-slate-500'
                }`}
              >
                {message}
              </p>
              {state === 'confirm' && (
                <button
                  type="button"
                  onClick={() => void complete()}
                  className="mt-8 w-full rounded-full bg-black py-4 font-bold text-white"
                >
                  Approve PHPC Transfer
                </button>
              )}
              {state === 'error' && (
                <button
                  type="button"
                  onClick={() => router.push('/demo')}
                  className="mt-8 w-full rounded-full bg-black py-4 font-bold text-white"
                >
                  Back to Dashboard
                </button>
              )}
            </>
          )}
        </main>
      )}
    </div>
  );
}
