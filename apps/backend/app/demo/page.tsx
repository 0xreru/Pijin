"use client";

import { Horizon } from '@stellar/stellar-sdk';
import {
  ArrowDownCircle,
  ArrowDownToLine,
  Cloud,
  RefreshCw,
  Send,
  Smartphone,
  WalletCards,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import React, { useCallback, useEffect, useState } from 'react';
import { useJudgeContext } from './GhostProvider';
import { RecentActivity } from './RecentActivity';
import { createDemoEvent, publishDemoEvent } from './demo-events';

const server = new Horizon.Server('https://horizon-testnet.stellar.org');

export default function DemoDashboard() {
  const { publicKey, shortId, role, sessionId, resetDemoSession } =
    useJudgeContext();
  const router = useRouter();
  const [balancePHPC, setBalancePHPC] = useState('0.00');
  const [offlineBalancePHPC, setOfflineBalancePHPC] = useState('0.00');
  const [balanceXLM, setBalanceXLM] = useState('0.00');
  const [isOnline, setIsOnline] = useState(true);

  const emit = (
    title: string,
    message: string,
    id = crypto.randomUUID(),
  ) =>
    publishDemoEvent(
      createDemoEvent({
        id,
        sessionId,
        role,
        phase: 'info',
        title,
        message,
      }),
    );

  const fetchBalance = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/vault-balance?stellarPublicKey=${publicKey}`,
        { cache: 'no-store' },
      );
      const data = await response.json();
      if (data.success) {
        setBalancePHPC(data.balancePHP.toFixed(2));
        setOfflineBalancePHPC(data.offlineBalancePHP.toFixed(2));
      }
      const account = await server.loadAccount(publicKey);
      const xlm = account.balances.find((balance) => balance.asset_type === 'native');
      if (xlm) setBalanceXLM(Number(xlm.balance).toFixed(2));
    } catch (error) {
      console.error('Error fetching demo balance:', error);
    }
  }, [publicKey]);

  useEffect(() => {
    const initialRefresh = window.setTimeout(() => void fetchBalance(), 0);
    const handleFocus = () => void fetchBalance();
    const handleMessage = (event: MessageEvent) => {
      if (
        event.origin === window.location.origin &&
        event.data?.type === 'pijin:demo-refresh' &&
        event.data?.sessionId === sessionId
      ) {
        void fetchBalance();
      }
    };
    window.addEventListener('focus', handleFocus);
    window.addEventListener('message', handleMessage);
    return () => {
      window.clearTimeout(initialRefresh);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('message', handleMessage);
    };
  }, [fetchBalance, sessionId]);

  const navigate = (title: string, path: string) => {
    emit(title, `Opened ${title.toLowerCase()}.`);
    router.push(path);
  };

  const selectMode = (online: boolean) => {
    setIsOnline(online);
    emit(
      online ? 'Online wallet selected' : 'Offline wallet selected',
      online
        ? 'Viewing funds available on Stellar.'
        : 'Viewing funds available without connectivity.',
      `mode:${role}`,
    );
  };

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden rounded-[2rem] bg-white pt-8 text-black">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-neutral-500">
            {role === 'sender' ? 'Phone 1' : 'Phone 2'}
          </p>
          <p className="mt-0.5 text-lg font-black text-[#001E42]">ID: {shortId}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              emit('Reset demo', 'Resetting this demo session.');
              void resetDemoSession();
            }}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100 text-red-500 shadow-sm hover:bg-red-200"
            title="Reset simulator"
            aria-label="Reset simulator"
          >
            <RefreshCw size={16} />
          </button>
          <div
            className={`flex h-10 w-10 items-center justify-center rounded-full shadow-sm ${
              role === 'sender' ? 'bg-[#001E42]' : 'bg-green-600'
            }`}
          >
            <p className="font-bold text-white">{role === 'sender' ? '1' : '2'}</p>
          </div>
        </div>
      </div>

      <div className="px-6">
        <div className="flex w-fit rounded-full bg-[#E6E9EE] p-1">
          <button
            type="button"
            onClick={() => selectMode(true)}
            aria-pressed={isOnline}
            className={`rounded-full px-4 py-1.5 text-sm font-bold transition-all ${
              isOnline ? 'bg-[#001E42] text-white' : 'text-[#707984]'
            }`}
          >
            Online
          </button>
          <button
            type="button"
            onClick={() => selectMode(false)}
            aria-pressed={!isOnline}
            className={`rounded-full px-4 py-1.5 text-sm font-bold transition-all ${
              !isOnline ? 'bg-[#001E42] text-white' : 'text-[#707984]'
            }`}
          >
            Offline
          </button>
        </div>
      </div>

      <div className="relative z-10 mt-4 px-6">
        <div className="relative overflow-hidden rounded-3xl bg-[#001E42] p-6 shadow-xl">
          <div className="absolute right-0 top-0 h-32 w-32 rounded-full bg-blue-500/20 blur-2xl" />
          <p className="mb-1 text-sm font-medium text-blue-100">
            {isOnline ? 'Online Balance' : 'Offline Wallet'}
          </p>
          <div className="flex items-baseline space-x-2">
            <span className="text-4xl font-black text-white">
              ₱ {isOnline ? balancePHPC : offlineBalancePHPC}
            </span>
            <span className="text-sm text-blue-200">PHPC</span>
          </div>
          {isOnline ? (
            <p className="mt-2 text-xs text-blue-300">{balanceXLM} XLM reserved</p>
          ) : (
            <p className="mt-2 text-xs text-blue-300">Secured by the Pijin contract</p>
          )}
        </div>
      </div>

      <div className="mt-6 px-6">
        <div className={`grid items-start ${isOnline ? 'grid-cols-5' : 'grid-cols-3'}`}>
          <ActionButton
            icon={<Send size={19} />}
            label="Send"
            onClick={() =>
              navigate(
                isOnline ? 'Online transfer' : 'Offline transfer',
                isOnline ? '/demo/transfer/online' : '/demo/transfer/offline',
              )
            }
          />
          <ActionButton
            icon={<ArrowDownToLine size={19} />}
            label="Receive"
            onClick={() =>
              emit('Receive details', `Share your Pijin ID ${shortId} to receive PHPC.`)
            }
          />
          {isOnline ? (
            <>
              <ActionButton
                icon={<ArrowDownCircle size={19} />}
                label="Top-Up"
                onClick={() => navigate('Top up', '/demo/topup')}
              />
              <ActionButton
                icon={<Cloud size={19} />}
                label="Load Offline"
                onClick={() => navigate('Load offline', '/demo/load-offline')}
              />
              <ActionButton
                icon={<WalletCards size={19} />}
                label="Withdraw"
                onClick={() => navigate('SEP-24 withdrawal', '/demo/withdraw')}
              />
            </>
          ) : (
            <ActionButton
              icon={<RefreshCw size={19} />}
              label="Transfer Online"
              onClick={() =>
                navigate(
                  'Transfer online',
                  `/demo/transfer-to-online?balance=${encodeURIComponent(
                    offlineBalancePHPC,
                  )}`,
                )
              }
            />
          )}
        </div>
      </div>

      <div className="mt-6 flex-1 overflow-y-auto px-6 pb-24">
        <RecentActivity
          publicKey={publicKey}
          shortId={shortId}
          sessionId={sessionId}
          tag={isOnline ? 'WALLET' : 'OFFLINE'}
        />
      </div>

      <div className="absolute inset-x-0 bottom-0 flex h-20 items-center justify-between border-t border-gray-100 bg-white px-10 pb-4">
        <Smartphone size={24} className="text-[#001E42]" />
        <RefreshCw size={24} className="text-gray-400" />
        <div className="-mt-8 flex h-12 w-12 items-center justify-center rounded-full bg-[#001E42] shadow-lg">
          <Send size={20} className="text-white" />
        </div>
        <Cloud size={24} className="text-gray-400" />
        <div className="h-6 w-6 rounded-full bg-gray-300" />
      </div>
    </div>
  );
}

function ActionButton({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="flex min-w-0 flex-col items-center" onClick={onClick}>
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#001E42] text-white shadow-md transition-colors hover:bg-[#002b5e]">
        {icon}
      </span>
      <span className="mt-2 text-center text-[10px] font-semibold leading-tight text-[#001E42]">
        {label}
      </span>
    </button>
  );
}
