"use client";

import { ArrowLeft, CheckCircle2, RefreshCw, ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { transferDemoOfflineToOnline } from '../actions';
import {
  createDemoEvent,
  publishDemoEvent,
  recordLocalDemoHistory,
} from '../demo-events';
import { useJudgeContext } from '../GhostProvider';

type Status = 'idle' | 'submitting' | 'success' | 'error';

export default function TransferToOnlinePage() {
  const router = useRouter();
  const { publicKey, role, sessionId } = useJudgeContext();
  const [balance, setBalance] = useState('0.00');
  const [amount, setAmount] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');
  const [hash, setHash] = useState('');
  const [operationId] = useState(() => crypto.randomUUID());

  useEffect(() => {
    const loadBalance = async () => {
      try {
        const response = await fetch(
          `/api/vault-balance?stellarPublicKey=${publicKey}`,
          { cache: 'no-store' },
        );
        const payload = await response.json();
        if (payload.success) setBalance(payload.offlineBalancePHP.toFixed(2));
      } catch {
        setMessage('Unable to load the current offline balance.');
      }
    };
    void loadBalance();
  }, [publicKey]);

  const submit = async () => {
    const numericAmount = Number(amount);
    if (
      !amount ||
      !Number.isFinite(numericAmount) ||
      numericAmount <= 0 ||
      numericAmount > Number(balance)
    ) {
      setStatus('error');
      setMessage(`Enter an amount up to ₱${balance}.`);
      return;
    }

    setStatus('submitting');
    setMessage('');
    publishDemoEvent(
      createDemoEvent({
        id: operationId,
        sessionId,
        role,
        phase: 'pending',
        title: 'Transferring online',
        message: `Unlocking ₱${amount} PHPC from the Offline Wallet.`,
        tag: 'OFFLINE',
        amount,
        assetCode: 'PHPC',
      }),
    );

    const result = await transferDemoOfflineToOnline(sessionId, role, amount);
    if (!result.success) {
      setStatus('error');
      setMessage(result.error);
      publishDemoEvent(
        createDemoEvent({
          id: operationId,
          sessionId,
          role,
          phase: 'error',
          title: 'Transfer online failed',
          message: result.error,
        }),
      );
      return;
    }

    const timestamp = new Date().toISOString();
    setHash(result.hash);
    setStatus('success');
    recordLocalDemoHistory(sessionId, publicKey, {
      id: `vault-debit:${result.hash}`,
      type: 'TRANSFER',
      tag: 'OFFLINE',
      title: 'Transferred to Online Wallet',
      amount: `-${amount}`,
      assetCode: 'PHPC',
      status: 'SETTLED',
      timestamp,
      txHash: result.hash,
    });
    recordLocalDemoHistory(sessionId, publicKey, {
      id: `vault-credit:${result.hash}`,
      type: 'RECEIVE',
      tag: 'WALLET',
      title: 'Received from Offline Wallet',
      amount,
      assetCode: 'PHPC',
      status: 'SETTLED',
      timestamp,
      txHash: result.hash,
    });
    publishDemoEvent(
      createDemoEvent({
        id: operationId,
        sessionId,
        role,
        phase: 'success',
        title: 'Transfer online complete',
        message: `₱${amount} PHPC is now available in your Online Wallet.`,
        tag: 'WALLET',
        amount,
        assetCode: 'PHPC',
        txHash: result.hash,
      }),
    );
  };

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden rounded-[2rem] bg-[#F5F5F6] text-slate-950">
      <header className="rounded-b-[2rem] bg-white px-6 pb-7 pt-10 shadow-sm">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => router.back()}
            aria-label="Go back"
            className="rounded-full p-1 hover:bg-slate-100"
          >
            <ArrowLeft size={24} />
          </button>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#1e3e62]">
              Offline to online
            </p>
            <h1 className="text-xl font-black">Transfer Online</h1>
          </div>
        </div>
      </header>

      {status === 'success' ? (
        <main className="flex flex-1 flex-col items-center p-6 pt-12 text-center">
          <span className="flex h-24 w-24 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
            <CheckCircle2 size={50} />
          </span>
          <h2 className="mt-6 text-2xl font-black">Transfer Complete</h2>
          <p className="mt-2 max-w-xs text-sm font-medium leading-relaxed text-slate-500">
            ₱{amount} PHPC has moved from your Offline Wallet to your main Online Wallet.
          </p>
          <div className="mt-7 w-full rounded-2xl bg-[#101820] p-4 text-left">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Soroban transaction
            </p>
            <p className="mt-2 break-all font-mono text-[10px] text-emerald-400">{hash}</p>
          </div>
          <button
            type="button"
            onClick={() => router.push('/demo')}
            className="mt-auto w-full rounded-full bg-black py-4 font-bold text-white"
          >
            Back to Dashboard
          </button>
        </main>
      ) : (
        <main className="flex flex-1 flex-col overflow-y-auto p-6">
          <div className="rounded-3xl bg-[#001E42] p-5 text-white shadow-lg">
            <p className="text-xs font-medium text-blue-200">Available Offline</p>
            <p className="mt-1 text-3xl font-black">₱ {balance}</p>
            <p className="mt-1 text-xs text-blue-300">PHPC</p>
          </div>

          <label className="mt-7 text-xs font-bold uppercase tracking-widest text-slate-400" htmlFor="online-amount">
            Amount to transfer
          </label>
          <div className="mt-2 flex items-center rounded-2xl border border-slate-100 bg-white p-5 shadow-sm focus-within:ring-2 focus-within:ring-[#1e3e62]">
            <span className="mr-2 text-3xl font-bold text-slate-300">₱</span>
            <input
              id="online-amount"
              type="number"
              min="0.0000001"
              step="0.0000001"
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              disabled={status === 'submitting'}
              onChange={(event) => {
                setAmount(event.target.value);
                if (status === 'error') setStatus('idle');
              }}
              className="w-full bg-transparent text-3xl font-black outline-none"
            />
          </div>

          <div className="mt-5 flex items-start gap-3 rounded-2xl border border-blue-100 bg-blue-50 p-4 text-[#1e3e62]">
            <ShieldCheck className="mt-0.5 shrink-0" size={20} />
            <p className="text-xs font-medium leading-relaxed">
              This signs and submits a real Pijin contract withdrawal on Stellar Testnet.
            </p>
          </div>
          {message && (
            <p role="alert" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-xs font-semibold text-red-700">
              {message}
            </p>
          )}

          <button
            type="button"
            onClick={() => void submit()}
            disabled={status === 'submitting'}
            className="mt-auto flex w-full items-center justify-center gap-2 rounded-full bg-black py-4 font-bold text-white disabled:opacity-60"
          >
            {status === 'submitting' && <RefreshCw size={18} className="animate-spin" />}
            {status === 'submitting' ? 'Transferring…' : 'Transfer Online'}
          </button>
        </main>
      )}
    </div>
  );
}
