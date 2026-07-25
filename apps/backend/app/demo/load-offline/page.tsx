"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useJudgeContext } from '../GhostProvider';
import { burnPHPC } from '../actions'; 
import { ArrowLeft, Send, CheckCircle, Cloud, FileCode2, Key, Database, ShieldCheck, Link2 } from 'lucide-react';

import Image from 'next/image';

export default function LoadOfflinePage() {
  const router = useRouter();
  const { publicKey, secretKey } = useJudgeContext();
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<"idle" | "visualizing" | "success" | "error">("idle");
  const [amount, setAmount] = useState("50");
  const [txHash, setTxHash] = useState("");

  const [step, setStep] = useState(0);

  const handleLoadOffline = async () => {
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) return;
    setLoading(true);
    setStatus("visualizing");
    
    setStep(1); // Build XDR
    setTimeout(() => setStep(2), 1500); // Simulate
    setTimeout(() => setStep(3), 3000); // Assemble
    setTimeout(() => setStep(4), 4500); // Sign
    setTimeout(() => setStep(5), 6000); // Send & Poll

    const res = await burnPHPC(publicKey, amount, secretKey);
    
    if (res.success) {
      setTxHash(res.hash || "");
      setStatus("success");
    } else {
      setStatus("error");
    }
    setLoading(false);
  };

  return (
    <div className="flex-1 bg-[#F5F5F6] h-full relative rounded-[2rem] overflow-hidden flex flex-col">
      <div className="bg-white p-6 pb-8 rounded-b-[2rem] shadow-sm z-10 relative">
        <div className="flex items-center mb-6">
          <ArrowLeft size={24} className="text-gray-800 cursor-pointer hover:opacity-70 transition-opacity" onClick={() => router.back()} />
          <h1 className="ml-4 text-xl font-bold text-gray-900 tracking-tight">Load Offline Vault</h1>
        </div>
        
        {status === "idle" && (
          <div className="flex flex-col items-center justify-center pt-2 pb-4">
            <Image 
              src="/assets/piji-cashin.png" 
              alt="Piji Mascot Cash In" 
              width={160} 
              height={160} 
              className="drop-shadow-lg"
            />
            <p className="text-center text-sm text-gray-500 font-medium mt-4 max-w-[240px]">
              Lock PHPC into your secure local vault for offline use.
            </p>
          </div>
        )}
      </div>

      {status === "idle" && (
        <div className="flex-1 flex flex-col p-6 overflow-y-auto">
          <div className="mb-8 mt-2">
            <label className="block text-xs font-bold text-gray-400 mb-2 uppercase tracking-widest pl-1">Amount to Load</label>
            <div className="flex items-center p-5 bg-white rounded-2xl shadow-sm border border-gray-100 transition-all focus-within:ring-2 focus-within:ring-black focus-within:border-black">
              <span className="text-3xl font-bold text-gray-300 mr-2">₱</span>
              <input 
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="bg-transparent text-3xl font-extrabold text-gray-900 w-full outline-none"
              />
            </div>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-gray-100 mb-8 flex items-start shadow-sm">
            <div className="bg-gray-50 p-2 rounded-full mr-4 mt-1">
              <Cloud size={20} className="text-gray-500" />
            </div>
            <div>
              <p className="text-sm font-bold text-gray-900">Soroban Smart Contract</p>
              <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                This executes a genuine `deposit` on the Pijin contract, mathematically locking your funds to your device's Ed25519 key.
              </p>
            </div>
          </div>

          <button 
            onClick={handleLoadOffline}
            className="w-full bg-black text-white font-bold py-5 rounded-full flex justify-center items-center mt-auto shadow-xl shadow-black/20 hover:scale-[1.02] active:scale-95 transition-all"
          >
            Execute Smart Contract
          </button>
        </div>
      )}

      {status === "visualizing" && (
        <div className="flex-1 flex flex-col p-6 pt-10">
          <h2 className="text-xl font-bold text-gray-900 mb-8 text-center">Executing Smart Contract</h2>
          
          <div className="space-y-5 bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
            <StepCard active={step >= 1} icon={<FileCode2 />} title="1. Build XDR" desc="Constructing `deposit` contract call" />
            <StepCard active={step >= 2} icon={<Database />} title="2. Simulate" desc="Estimating Soroban resource consumption" />
            <StepCard active={step >= 3} icon={<Link2 />} title="3. Assemble" desc="Attaching Soroban footprint and fees" />
            <StepCard active={step >= 4} icon={<Key />} title="4. Sign" desc="Signing with Mobile Secret Key" />
            <StepCard active={step >= 5} icon={<ShieldCheck />} title="5. Send & Confirm" desc="Broadcasting to Stellar Testnet and polling ledger" isLast />
          </div>
        </div>
      )}

      {status === "success" && (
        <div className="flex-1 flex flex-col items-center justify-center text-center animate-in zoom-in p-6">
          <div className="w-24 h-24 bg-green-50 rounded-full flex items-center justify-center mb-6">
            <CheckCircle size={48} className="text-green-500" />
          </div>
          <h1 className="text-2xl font-black text-gray-900 mb-2">Successfully Loaded!</h1>
          <p className="text-gray-500 text-sm font-medium mb-8">₱{amount} has been locked to your Offline Vault.</p>
          
          <div className="w-full text-left bg-[#121212] p-5 rounded-2xl shadow-xl">
            <p className="text-gray-400 mb-3 text-xs font-bold uppercase tracking-wider">// Soroban Tx Hash</p>
            <p className="text-green-400 text-xs font-mono break-all">{txHash}</p>
          </div>

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
          <p className="text-gray-500 text-sm mt-2">Check server logs for details.</p>
          <button onClick={() => setStatus("idle")} className="mt-8 bg-gray-100 text-gray-900 font-bold px-8 py-4 rounded-full">Retry</button>
        </div>
      )}
    </div>
  );
}

function StepCard({ active, icon, title, desc, isLast }: { active: boolean, icon: any, title: string, desc: string, isLast?: boolean }) {
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
