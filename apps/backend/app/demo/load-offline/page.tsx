"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useJudgeContext } from '../GhostProvider';
import { burnPHPC } from '../actions'; 
import { ArrowLeft, Send, CheckCircle, Cloud, FileCode2, Key, Database, ShieldCheck, Link2 } from 'lucide-react';

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
    <div className="flex-1 bg-white h-full relative rounded-[2rem] overflow-hidden flex flex-col p-6">
      <div className="flex items-center mb-6">
        <ArrowLeft size={24} className="text-gray-800 cursor-pointer" onClick={() => router.back()} />
        <h1 className="ml-4 text-lg font-bold">Load Offline Vault</h1>
      </div>

      {status === "idle" && (
        <div className="flex-1 flex flex-col">
          <div className="bg-gray-50 p-4 rounded-xl border border-gray-100 mb-6 flex items-start">
            <Cloud size={24} className="text-gray-400 mr-3 mt-1" />
            <div>
              <p className="text-sm font-bold text-gray-800">Soroban Smart Contract</p>
              <p className="text-xs text-gray-500 mt-1">
                This will execute the real `deposit` function on the Pijin Soroban smart contract to lock your PHPC for offline P2P transfers.
              </p>
            </div>
          </div>

          <div className="mb-8">
            <label className="block text-xs font-bold text-gray-500 mb-1 uppercase tracking-wider">Amount (PHPC)</label>
            <div className="flex items-center p-4 bg-gray-50 rounded-xl border border-gray-200">
              <span className="text-xl font-bold text-gray-400 mr-2">₱</span>
              <input 
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="bg-transparent text-xl font-bold text-gray-900 w-full outline-none"
              />
            </div>
          </div>

          <button 
            onClick={handleLoadOffline}
            className="w-full bg-[#001E42] text-white font-bold py-4 rounded-full flex justify-center items-center mt-auto"
          >
            Execute Smart Contract
          </button>
        </div>
      )}

      {status === "visualizing" && (
        <div className="flex-1 flex flex-col pt-4">
          <h2 className="text-lg font-bold text-gray-900 mb-6 text-center">Executing Smart Contract</h2>
          
          <div className="space-y-4">
            <StepCard active={step >= 1} icon={<FileCode2 />} title="1. Build XDR" desc="Constructing `deposit` contract call" />
            <StepCard active={step >= 2} icon={<Database />} title="2. Simulate" desc="Estimating Soroban resource consumption" />
            <StepCard active={step >= 3} icon={<Link2 />} title="3. Assemble" desc="Attaching Soroban footprint and fees" />
            <StepCard active={step >= 4} icon={<Key />} title="4. Sign" desc="Signing with Mobile Secret Key" />
            <StepCard active={step >= 5} icon={<ShieldCheck />} title="5. Send & Confirm" desc="Broadcasting to Stellar Testnet and polling ledger" isLast />
          </div>
        </div>
      )}

      {status === "success" && (
        <div className="flex-1 flex flex-col items-center justify-center text-center animate-in zoom-in overflow-y-auto pt-6 pb-20">
          <CheckCircle size={60} className="text-green-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-gray-900">Successfully Loaded!</h1>
          
          <div className="w-full text-left mt-6 bg-gray-900 text-green-400 p-4 rounded-xl text-xs font-mono break-all border border-gray-800">
            <p className="text-gray-400 mb-2">// Soroban Transaction Hash</p>
            <p className="mb-4">{txHash}</p>
          </div>

          <button 
            onClick={() => router.push('/demo')}
            className="w-full bg-[#001E42] text-white font-bold py-4 rounded-full mt-6"
          >
            Back to Dashboard
          </button>
        </div>
      )}
      
      {status === "error" && (
        <div className="flex-1 flex flex-col items-center justify-center text-center">
          <h1 className="text-xl font-bold text-red-500">Transaction Failed</h1>
          <p className="text-gray-500 text-sm mt-2">Check server logs for details.</p>
          <button onClick={() => setStatus("idle")} className="mt-4 bg-gray-100 px-4 py-2 rounded-full">Retry</button>
        </div>
      )}
    </div>
  );
}

function StepCard({ active, icon, title, desc, isLast }: { active: boolean, icon: any, title: string, desc: string, isLast?: boolean }) {
  return (
    <div className={`flex items-start transition-opacity duration-500 ${active ? 'opacity-100' : 'opacity-30'}`}>
      <div className="flex flex-col items-center">
        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${active ? 'bg-[#001E42] text-white' : 'bg-gray-200 text-gray-400'}`}>
          {icon}
        </div>
        {!isLast && <div className={`w-0.5 h-6 ${active ? 'bg-[#001E42]' : 'bg-gray-200'} mt-2`}></div>}
      </div>
      <div className="ml-4 mt-1">
        <h3 className={`font-bold ${active ? 'text-gray-900' : 'text-gray-400'}`}>{title}</h3>
        <p className="text-xs text-gray-500">{desc}</p>
      </div>
    </div>
  );
}
