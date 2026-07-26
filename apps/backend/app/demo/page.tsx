"use client";

import React, { useCallback, useEffect, useState } from 'react';
import { useJudgeContext } from './GhostProvider';
import { Horizon } from '@stellar/stellar-sdk';
import { Send, ArrowDownToLine, RefreshCw, Smartphone, Cloud, ArrowDownCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { mintPHPC } from './actions';

const HORIZON_TESTNET_URL = 'https://horizon-testnet.stellar.org';
const server = new Horizon.Server(HORIZON_TESTNET_URL);

export default function DemoDashboard() {
  const { publicKey, shortId, role, resetDemoSession } = useJudgeContext();
  const router = useRouter();
  const [balancePHPC, setBalancePHPC] = useState("0.00");
  const [offlineBalancePHPC, setOfflineBalancePHPC] = useState("0.00");
  const [balanceXLM, setBalanceXLM] = useState("0.00");
  const [isOnline, setIsOnline] = useState(true);
  const [loadingAction, setLoadingAction] = useState(false);

  const fetchBalance = useCallback(async () => {
    try {
      const res = await fetch(`/api/vault-balance?stellarPublicKey=${publicKey}`);
      const data = await res.json();
      
      if (data.success) {
        setBalancePHPC(data.balancePHP.toFixed(2));
        setOfflineBalancePHPC(data.offlineBalancePHP.toFixed(2));
      }
      
      // Also fetch native XLM for the UI just in case
      const account = await server.loadAccount(publicKey);
      const xlm = account.balances.find((b) => b.asset_type === 'native');
      if (xlm) setBalanceXLM(parseFloat(xlm.balance).toFixed(2));
      
    } catch (err) {
      console.error("Error fetching balance:", err);
    }
  }, [publicKey]);

  // Hook to refresh when coming back from transfers and poll every 3 seconds
  useEffect(() => {
    const handleFocus = () => {
      void fetchBalance();
    };
    const initialTimeoutId = window.setTimeout(handleFocus, 0);
    window.addEventListener('focus', handleFocus);
    
    const intervalId = window.setInterval(() => {
      void fetchBalance();
    }, 3000);
    
    return () => {
      window.clearTimeout(initialTimeoutId);
      window.removeEventListener('focus', handleFocus);
      window.clearInterval(intervalId);
    };
  }, [fetchBalance]);



  const handleSyncOnline = async () => {
    const amt = prompt(`How much PHPC would you like to unlock back to your online balance? (Max: ${offlineBalancePHPC})`);
    if (!amt || isNaN(Number(amt)) || Number(amt) <= 0 || Number(amt) > Number(offlineBalancePHPC)) return;
    
    setLoadingAction(true);
    // Mint to trustline to simulate vault unlock
    const res = await mintPHPC(publicKey, amt);
    if (res.success) {
      await fetchBalance();
      alert(`Successfully unlocked ₱${amt} back to your online balance! Note: Since this is a demo, it did not execute the Soroban sync_online contract. Use your mobile app to actually sync funds!`);
    } else {
      alert("Failed to sync online: " + res.error);
    }
    setLoadingAction(false);
  };

  return (
    <div className="flex-1 bg-white rounded-[2rem] overflow-hidden flex flex-col relative text-black pt-8">
      {/* Header */}
      <div className="px-6 py-4 flex justify-between items-center">
        <div>
          <p className="text-xs text-neutral-500 font-bold tracking-wider uppercase">
            {role === 'sender' ? 'Phone 1' : 'Phone 2'}
          </p>
          <p className="text-lg font-black text-[#001E42] mt-0.5">
            ID: {shortId}
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <button 
            onClick={() => void resetDemoSession()}
            className="w-10 h-10 bg-red-100 text-red-500 rounded-full flex items-center justify-center cursor-pointer hover:bg-red-200 shadow-sm"
            title="Reset Simulator"
          >
            <RefreshCw size={16} />
          </button>
          <div className={`w-10 h-10 rounded-full flex items-center justify-center shadow-sm ${role === 'sender' ? 'bg-[#001E42]' : 'bg-green-600'}`}>
            <p className="text-white font-bold">{role === 'sender' ? '1' : '2'}</p>
          </div>
        </div>
      </div>

      {/* Online/Offline Toggle */}
      <div className="px-6">
        <div className="flex bg-[#E6E9EE] p-1 rounded-full w-fit">
          <button 
            onClick={() => setIsOnline(true)}
            className={`px-4 py-1.5 rounded-full text-sm font-bold transition-all ${isOnline ? 'bg-[#001E42] text-white' : 'text-[#707984]'}`}
          >
            Online
          </button>
          <button 
            onClick={() => setIsOnline(false)}
            className={`px-4 py-1.5 rounded-full text-sm font-bold transition-all ${!isOnline ? 'bg-[#001E42] text-white' : 'text-[#707984]'}`}
          >
            Offline
          </button>
        </div>
      </div>

      {/* Balance Card */}
      <div className="px-6 mt-4 relative z-10">
        <div className="bg-[#001E42] rounded-3xl p-6 shadow-xl overflow-hidden relative">
          <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/20 rounded-full blur-2xl"></div>
          
          {loadingAction && (
             <div className="absolute inset-0 bg-[#001E42]/80 backdrop-blur-sm z-20 flex items-center justify-center">
               <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
             </div>
          )}

          <p className="text-blue-100 text-sm font-medium mb-1">
            {isOnline ? 'Online Balance' : 'Offline Vault (Omni-Vault)'}
          </p>
          <div className="flex items-baseline space-x-2">
            <span className="text-white text-4xl font-black">
              ₱ {isOnline ? balancePHPC : offlineBalancePHPC}
            </span>
            <span className="text-blue-200 text-sm">PHPC</span>
          </div>
          {isOnline && <p className="text-blue-300 text-xs mt-2">{balanceXLM} XLM reserved</p>}
          {!isOnline && <p className="text-blue-300 text-xs mt-2">Locked in Smart Contract</p>}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="px-6 mt-6">
        <div className="flex justify-between items-start">
          <ActionBtn 
            icon={<Send size={20} />} 
            label="Send" 
            onClick={() => router.push(isOnline ? '/demo/transfer/online' : '/demo/transfer/offline')} 
          />
          <ActionBtn 
            icon={<ArrowDownToLine size={20} />} 
            label="Receive" 
            onClick={() => alert("Receive mocked")} 
          />
          
          {isOnline ? (
            <>
              <ActionBtn 
                icon={<ArrowDownCircle size={20} />} 
                label="Top-Up" 
                onClick={() => router.push('/demo/topup')} 
              />
              <ActionBtn 
                icon={<Cloud size={20} />} 
                label="Load Offline" 
                onClick={() => router.push('/demo/load-offline')} 
              />
            </>
          ) : (
            <ActionBtn 
              icon={<RefreshCw size={20} />} 
              label="Sync Online" 
              onClick={handleSyncOnline} 
            />
          )}
        </div>
      </div>

      {/* Transactions List Mock */}
      <div className="px-6 mt-8 flex-1">
        <h3 className="font-bold text-neutral-800 mb-4">Recent Activity</h3>
        <div className="text-center text-neutral-400 mt-10 text-sm">
          No recent transactions in simulation.
        </div>
      </div>

      {/* Bottom Nav Mock */}
      <div className="absolute bottom-0 inset-x-0 h-20 bg-white border-t border-gray-100 flex justify-between items-center px-10 pb-4">
        <Smartphone size={24} className="text-[#001E42]" />
        <RefreshCw size={24} className="text-gray-400" />
        <div className="w-12 h-12 bg-[#001E42] rounded-full flex items-center justify-center shadow-lg -mt-8">
           <Send size={20} className="text-white" />
        </div>
        <Cloud size={24} className="text-gray-400" />
        <div className="w-6 h-6 bg-gray-300 rounded-full" />
      </div>
    </div>
  );
}

function ActionBtn({ icon, label, onClick }: { icon: React.ReactNode, label: string, onClick: () => void }) {
  return (
    <div className="flex flex-col items-center flex-1" onClick={onClick}>
      <div className="w-14 h-14 bg-[#001E42] rounded-full flex items-center justify-center shadow-md cursor-pointer hover:bg-[#002b5e] transition-colors text-white">
        {icon}
      </div>
      <span className="text-[10px] font-semibold text-[#001E42] mt-2 text-center leading-tight">
        {label}
      </span>
    </div>
  );
}
