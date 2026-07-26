"use client";

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useJudgeContext } from '../../GhostProvider';
import { submitOfflineVoucher } from '../../actions'; 
import { AlertTriangle, ArrowLeft, Send, CheckCircle, WifiOff, FileCode2, Key, Database, ExternalLink, RefreshCw, ShieldCheck } from 'lucide-react';
import {
  demoAccessCode,
  getDemoSettlementStatus,
} from '../../demo-session-client';
import {
  formatPhpcStroops,
  quoteOfflineTransfer,
} from '@/lib/demo/offline-transfer-balance';
import { stellarExpertTestnetTxUrl } from '@/lib/demo/settlement-status';
import { createDemoEvent, publishDemoEvent } from '../../demo-events';

import Image from 'next/image';

type VoucherDebugData = {
  amountBase62?: string;
  nonceB64?: string;
  nonceHex?: string;
  senderShortId?: string;
  signatureB64?: string;
  smsPayload?: string;
};

type VaultBalanceResponse = {
  success?: boolean;
  offlineBalanceStroops?: string;
  error?: string;
};

export default function OfflineTransferPage() {
  const router = useRouter();
  const { publicKey, deviceSecretKey, shortId, role, sessionId } = useJudgeContext();
  const [status, setStatus] = useState<"idle" | "visualizing" | "queued" | "settled" | "error">("idle");
  const [receiver, setReceiver] = useState("");
  const [amount, setAmount] = useState("");
  const [operationId] = useState(() => crypto.randomUUID());
  const [debugData, setDebugData] = useState<VoucherDebugData | null>(null);
  const [failureMessage, setFailureMessage] = useState("");
  const [transactionHash, setTransactionHash] = useState("");
  const [settlementCheckMessage, setSettlementCheckMessage] = useState("");
  const [offlineBalanceStroops, setOfflineBalanceStroops] = useState<bigint | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(true);
  const [balanceError, setBalanceError] = useState("");

  const [step, setStep] = useState(0);

  const refreshOfflineBalance = useCallback(async (): Promise<bigint | null> => {
    setBalanceLoading(true);
    setBalanceError("");

    try {
      const response = await fetch(
        `/api/vault-balance?stellarPublicKey=${encodeURIComponent(publicKey)}`,
        { cache: 'no-store' },
      );
      const body = await response.json() as VaultBalanceResponse;
      if (!response.ok || !body.success) {
        throw new Error(body.error || 'Unable to read the offline vault balance');
      }
      if (
        typeof body.offlineBalanceStroops !== 'string' ||
        !/^\d+$/.test(body.offlineBalanceStroops)
      ) {
        throw new Error('The offline vault returned an invalid balance');
      }

      const balance = BigInt(body.offlineBalanceStroops);
      setOfflineBalanceStroops(balance);
      return balance;
    } catch (error) {
      setOfflineBalanceStroops(null);
      setBalanceError(
        error instanceof Error
          ? error.message
          : 'Unable to read the offline vault balance',
      );
      return null;
    } finally {
      setBalanceLoading(false);
    }
  }, [publicKey]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void refreshOfflineBalance();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [refreshOfflineBalance]);

  const settlementNonce = debugData?.nonceB64;
  const settlementSenderShortId = debugData?.senderShortId || shortId;
  const stellarExpertUrl = stellarExpertTestnetTxUrl(transactionHash);

  useEffect(() => {
    if (status !== 'queued' || !settlementNonce) return;

    let cancelled = false;
    let timeoutId: number | undefined;

    const scheduleNextCheck = (delayMs: number) => {
      timeoutId = window.setTimeout(() => {
        void checkSettlement();
      }, delayMs);
    };

    const checkSettlement = async () => {
      try {
        const settlement = await getDemoSettlementStatus(
          settlementNonce,
          settlementSenderShortId,
          demoAccessCode(),
        );
        if (cancelled) return;

        if (settlement.status === 'SETTLED') {
          if (!settlement.txHash || !stellarExpertTestnetTxUrl(settlement.txHash)) {
            setFailureMessage('Settlement completed without a valid transaction hash');
            setStatus('error');
            return;
          }
          setTransactionHash(settlement.txHash);
          setSettlementCheckMessage('');
          setStatus('settled');
          publishDemoEvent(createDemoEvent({
            id: operationId,
            sessionId,
            role,
            phase: 'success',
            title: 'Offline transaction settled',
            message: `₱${amount} PHPC was sent to ${receiver}.`,
            tag: 'OFFLINE',
            amount,
            assetCode: 'PHPC',
            txHash: settlement.txHash,
          }));
          return;
        }

        if (settlement.status === 'FAILED') {
          setFailureMessage(
            settlement.failureReason || 'The offline settlement was rejected',
          );
          setStatus('error');
          publishDemoEvent(createDemoEvent({
            id: operationId,
            sessionId,
            role,
            phase: 'error',
            title: 'Offline transfer failed',
            message: settlement.failureReason || 'The offline settlement was rejected.',
          }));
          return;
        }

        setSettlementCheckMessage('');
        scheduleNextCheck(1_500);
      } catch (error) {
        if (cancelled) return;
        setSettlementCheckMessage(
          error instanceof Error
            ? `${error.message}. Retrying confirmation...`
            : 'Confirmation check delayed. Retrying...',
        );
        scheduleNextCheck(3_000);
      }
    };

    scheduleNextCheck(0);
    return () => {
      cancelled = true;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, [amount, operationId, receiver, role, sessionId, settlementNonce, settlementSenderShortId, status]);

  const quote =
    offlineBalanceStroops === null
      ? null
      : quoteOfflineTransfer(amount, offlineBalanceStroops);
  const hasInsufficientBalance =
    quote !== null && quote.shortfallStroops > 0n;
  const canSubmit =
    receiver.trim().length > 0 &&
    quote !== null &&
    !hasInsufficientBalance &&
    !balanceLoading &&
    !balanceError;

  const handleSimulateSms = async () => {
    if (!receiver) return;

    const latestBalance = await refreshOfflineBalance();
    if (latestBalance === null) return;
    const latestQuote = quoteOfflineTransfer(amount, latestBalance);
    if (!latestQuote || latestQuote.shortfallStroops > 0n) return;

    setStatus("visualizing");
    setFailureMessage("");
    publishDemoEvent(createDemoEvent({
      id: operationId,
      sessionId,
      role,
      phase: 'pending',
      title: 'Sending offline payment',
      message: `Preparing ₱${amount} PHPC for ${receiver}.`,
      tag: 'OFFLINE',
      amount,
      assetCode: 'PHPC',
    }));
    setStep(1); // Nonce generation

    setTimeout(() => setStep(2), 1500); // Amount Base62
    setTimeout(() => setStep(3), 3000); // XDR Tuple
    setTimeout(() => setStep(4), 4500); // Ed25519 Sign
    setTimeout(() => setStep(5), 6000); // Webhook

    const res = await submitOfflineVoucher(
      publicKey,
      deviceSecretKey,
      receiver,
      amount,
    );
    
    setTimeout(() => {
      if (res.success) {
        setDebugData(res.debug);
        setStatus("queued");
      } else {
        setFailureMessage(res.error);
        setStatus("error");
        publishDemoEvent(createDemoEvent({
          id: operationId,
          sessionId,
          role,
          phase: 'error',
          title: 'Offline transfer failed',
          message: res.error,
        }));
      }
    }, 7500);
  };

  return (
    <div className="flex-1 bg-[#F5F5F6] h-full relative rounded-[2rem] overflow-hidden flex flex-col">
      <div className="bg-white p-6 pb-8 rounded-b-[2rem] shadow-sm z-10 relative">
        <div className="flex items-center mb-6">
          <ArrowLeft size={24} className="text-gray-800 cursor-pointer hover:opacity-70 transition-opacity" onClick={() => router.back()} />
          <h1 className="ml-4 text-xl font-bold text-gray-900 tracking-tight">Offline Transfer</h1>
        </div>
        
        {status === "idle" && (
          <div className="flex flex-col items-center justify-center pt-2 pb-4">
            <Image 
              src="/assets/piji-send.png" 
              alt="Piji Mascot Send" 
              width={160} 
              height={160} 
              className="drop-shadow-lg"
            />
            <p className="text-center text-sm text-gray-500 font-medium mt-4 max-w-[240px]">
              Transfer funds instantly without internet using secure cryptographic SMS.
            </p>
          </div>
        )}
      </div>

      {status === "idle" && (
        <div className="flex-1 flex flex-col p-6 overflow-y-auto">
          
          <div className="mb-5">
            <label className="block text-xs font-bold text-gray-400 mb-2 uppercase tracking-widest pl-1">Receiver Short ID</label>
            <input 
              type="text"
              value={receiver}
              onChange={(e) => setReceiver(e.target.value)}
              placeholder="e.g. aB3x9Q"
              className="w-full p-5 bg-white rounded-2xl font-bold text-gray-900 shadow-sm border border-gray-100 transition-all focus:ring-2 focus:ring-black focus:border-black outline-none"
            />
          </div>

          <div className="mb-8">
            <label className="block text-xs font-bold text-gray-400 mb-2 uppercase tracking-widest pl-1">Amount to Send</label>
            <div className="flex items-center p-5 bg-white rounded-2xl shadow-sm border border-gray-100 transition-all focus-within:ring-2 focus-within:ring-black focus-within:border-black">
              <span className="text-3xl font-bold text-gray-300 mr-2">₱</span>
              <input 
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="bg-transparent text-3xl font-extrabold text-gray-900 w-full outline-none"
              />
            </div>
            <div className="mt-3 flex items-center justify-between px-1 text-xs">
              <span className="text-gray-500">
                Available offline:{' '}
                <strong className="text-gray-800">
                  {offlineBalanceStroops === null
                    ? '—'
                    : `₱${formatPhpcStroops(offlineBalanceStroops)}`}
                </strong>
              </span>
              <button
                type="button"
                onClick={() => void refreshOfflineBalance()}
                disabled={balanceLoading}
                className="inline-flex items-center gap-1 font-bold text-blue-600 disabled:opacity-50"
              >
                <RefreshCw size={12} className={balanceLoading ? 'animate-spin' : ''} />
                Refresh
              </button>
            </div>
          </div>

          {balanceError && (
            <div role="alert" className="mb-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-left">
              <div className="flex items-start gap-3">
                <AlertTriangle size={20} className="mt-0.5 shrink-0 text-red-600" />
                <div>
                  <p className="text-sm font-bold text-red-800">Unable to verify offline funds</p>
                  <p className="mt-1 text-xs leading-relaxed text-red-700">{balanceError}</p>
                </div>
              </div>
            </div>
          )}

          {hasInsufficientBalance && quote && offlineBalanceStroops !== null && (
            <div role="alert" className="mb-5 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-left">
              <div className="flex items-start gap-3">
                <AlertTriangle size={20} className="mt-0.5 shrink-0 text-amber-600" />
                <div>
                  <p className="text-sm font-bold text-amber-900">Not enough offline funds</p>
                  <p className="mt-1 text-xs leading-relaxed text-amber-800">
                    You have ₱{formatPhpcStroops(offlineBalanceStroops)}, but this
                    transfer requires ₱{formatPhpcStroops(quote.requiredStroops)},
                    including the ₱0.50 protocol fee. Load offline funds first
                    before sending.
                  </p>
                  <button
                    type="button"
                    onClick={() => router.push('/demo/load-offline')}
                    className="mt-3 rounded-full bg-amber-900 px-4 py-2 text-xs font-bold text-white hover:bg-amber-800"
                  >
                    Load Offline Funds
                  </button>
                </div>
              </div>
            </div>
          )}
          
          <div className="bg-white p-5 rounded-2xl border border-gray-100 mb-8 flex items-start shadow-sm">
            <div className="bg-gray-50 p-2 rounded-full mr-4 mt-1">
              <WifiOff size={20} className="text-gray-500" />
            </div>
            <div>
              <p className="text-sm font-bold text-gray-900">Authentic SMS Bypassing</p>
              <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                This simulator will construct the exact mathematical XDR tuple & Ed25519 signature as your mobile app, and directly POST it to the settlement webhook.
              </p>
            </div>
          </div>

          <button 
            onClick={handleSimulateSms}
            disabled={!canSubmit}
            className="w-full bg-black text-white font-bold py-5 rounded-full flex justify-center items-center mt-auto shadow-xl shadow-black/20 hover:scale-[1.02] active:scale-95 transition-all disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-500 disabled:shadow-none disabled:hover:scale-100"
          >
            {balanceLoading
              ? 'Checking Offline Balance...'
              : hasInsufficientBalance
                ? 'Load Offline Funds First'
                : 'Compress & Send SMS'}
          </button>
        </div>
      )}

      {status === "visualizing" && (
        <div className="flex-1 flex flex-col p-6 pt-10">
          <h2 className="text-xl font-bold text-gray-900 mb-8 text-center">Cryptographic Compression</h2>
          
          <div className="space-y-5 bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
            <StepCard active={step >= 1} icon={<Key />} title="1. Generate Nonce" desc="32-byte cryptographically secure random value" />
            <StepCard active={step >= 2} icon={<Database />} title="2. Amount Base62" desc="Compress amount to Base62" />
            <StepCard active={step >= 3} icon={<FileCode2 />} title="3. Build XDR Tuple" desc="Serialize params to Soroban Vec<ScVal>" />
            <StepCard active={step >= 4} icon={<ShieldCheck />} title="4. Ed25519 Sign" desc="Sign raw XDR bytes with Device Key" />
            <StepCard active={step >= 5} icon={<Send />} title="5. Dispatch Webhook" desc="POST payload to /api/sms/webhook" isLast />
          </div>
        </div>
      )}

      {(status === "queued" || status === "settled") && (
        <div className="flex-1 flex flex-col items-center justify-center text-center animate-in zoom-in p-6">
          <div className={`w-24 h-24 rounded-full flex items-center justify-center mb-6 ${status === 'settled' ? 'bg-green-50' : 'bg-blue-50'}`}>
            {status === 'settled' ? (
              <CheckCircle size={48} className="text-green-500" />
            ) : (
              <RefreshCw size={44} className="animate-spin text-blue-500" />
            )}
          </div>
          <h1 className="text-2xl font-black text-gray-900 mb-2">
            {status === 'settled' ? 'Transaction Settled' : 'Voucher Queued'}
          </h1>
          <p className="text-gray-500 text-sm font-medium mb-8">
            {status === 'settled'
              ? 'The offline payment is confirmed on Stellar Testnet.'
              : 'The webhook accepted the voucher. Waiting for QStash and Stellar confirmation.'}
          </p>
          
          <div className="w-full text-left bg-[#121212] p-5 rounded-2xl shadow-xl">
            <p className="text-gray-400 mb-3 text-xs font-bold uppercase tracking-wider">{'// 6-Part Voucher Sent'}</p>
            <p className="text-green-400 text-xs font-mono break-all mb-4">{debugData?.smsPayload}</p>
            {status === 'settled' && stellarExpertUrl ? (
              <>
                <p className="text-gray-400 text-xs font-bold uppercase tracking-wider mt-4">{'// Transaction Hash'}</p>
                <a
                  href={stellarExpertUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 flex items-start gap-2 text-green-400 hover:text-green-300"
                >
                  <span className="min-w-0 break-all font-mono text-xs">{transactionHash}</span>
                  <ExternalLink size={14} className="mt-0.5 shrink-0" />
                </a>
              </>
            ) : (
              <>
                <p className="text-gray-400 text-xs font-bold uppercase tracking-wider mt-4">{'// QStash Deduplication ID'}</p>
                <p className="text-blue-400 text-xs font-mono break-all mt-1">
                  {settlementSenderShortId}_{settlementNonce}
                </p>
                <p className="mt-3 text-xs text-gray-400">
                  {settlementCheckMessage || 'Checking settlement status...'}
                </p>
              </>
            )}
          </div>

          {status === 'settled' && (
            <p className="mt-5 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-medium leading-relaxed text-[#1e3e62]">
              The receiver can view the credited amount in their Offline tab.
            </p>
          )}

          <button 
            onClick={() => router.push('/demo')}
            className="w-full bg-black text-white font-bold py-5 rounded-full mt-auto shadow-xl shadow-black/20 hover:scale-[1.02] active:scale-95 transition-all"
          >
            Back to Dashboard
          </button>
        </div>
      )}
      
      {status === "error" && (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-6">
          <h1 className="text-2xl font-black text-red-500">Transaction Failed</h1>
          <p className="text-gray-500 text-sm mt-2 max-w-sm">
            {failureMessage || "Check server logs for details."}
          </p>
          <button onClick={() => setStatus("idle")} className="mt-8 bg-gray-100 text-gray-900 font-bold px-8 py-4 rounded-full">Retry</button>
        </div>
      )}
    </div>
  );
}

function StepCard({ active, icon, title, desc, isLast }: { active: boolean, icon: React.ReactNode, title: string, desc: string, isLast?: boolean }) {
  return (
    <div className={`flex items-start transition-all duration-700 ${active ? 'opacity-100 translate-y-0' : 'opacity-20 translate-y-2'}`}>
      <div className="flex flex-col items-center">
        <div className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors duration-500 ${active ? 'bg-black text-white shadow-lg shadow-black/20' : 'bg-gray-100 text-gray-400'}`}>
          {icon}
        </div>
        {!isLast && <div className={`w-0.5 h-8 ${active ? 'bg-black' : 'bg-gray-100'} mt-3 transition-colors duration-500`}></div>}
      </div>
      <div className="ml-5 mt-1.5">
        <h3 className={`font-bold text-base transition-colors duration-500 ${active ? 'text-gray-900' : 'text-gray-400'}`}>{title}</h3>
        <p className="text-xs text-gray-500 mt-1">{desc}</p>
      </div>
    </div>
  );
}

