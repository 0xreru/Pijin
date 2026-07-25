"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useJudgeContext } from '../../GhostProvider';
import { submitOfflineVoucher } from '../../actions'; 
import { ArrowLeft, Send, CheckCircle, WifiOff, FileCode2, Key, Database, ShieldCheck } from 'lucide-react';

import Image from 'next/image';

export default function OfflineTransferPage() {
  const router = useRouter();
  const { secretKey } = useJudgeContext();
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<"idle" | "visualizing" | "success" | "error">("idle");
  const [receiver, setReceiver] = useState("");
  const [amount, setAmount] = useState("50");
  const [debugData, setDebugData] = useState<any>(null);

  const [step, setStep] = useState(0);

  const handleSimulateSms = async () => {
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) return;
    if (!receiver) return;

    setLoading(true);
    setStatus("visualizing");
    setStep(1); // Nonce generation

    setTimeout(() => setStep(2), 1500); // Amount Base62
    setTimeout(() => setStep(3), 3000); // XDR Tuple
    setTimeout(() => setStep(4), 4500); // Ed25519 Sign
    setTimeout(() => setStep(5), 6000); // Webhook

    const res = await submitOfflineVoucher(secretKey, receiver, Number(amount));
    
    setTimeout(() => {
      if (res.success) {
        setDebugData(res.debug);
        setStatus("success");
      } else {
        setStatus("error");
      }
      setLoading(false);
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
          </div>
          
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
            className="w-full bg-black text-white font-bold py-5 rounded-full flex justify-center items-center mt-auto shadow-xl shadow-black/20 hover:scale-[1.02] active:scale-95 transition-all"
          >
            Compress & Send SMS
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

      {status === "success" && (
        <div className="flex-1 flex flex-col items-center justify-center text-center animate-in zoom-in p-6">
          <div className="w-24 h-24 bg-green-50 rounded-full flex items-center justify-center mb-6">
            <CheckCircle size={48} className="text-green-500" />
          </div>
          <h1 className="text-2xl font-black text-gray-900 mb-2">SMS Webhook Success!</h1>
          <p className="text-gray-500 text-sm font-medium mb-8">The cryptographically secured 6-part voucher has been dispatched.</p>
          
          <div className="w-full text-left bg-[#121212] p-5 rounded-2xl shadow-xl">
            <p className="text-gray-400 mb-3 text-xs font-bold uppercase tracking-wider">// 6-Part Voucher Sent</p>
            <p className="text-green-400 text-xs font-mono break-all mb-4">1:jd123:{receiver}:{debugData?.amountBase62}:{debugData?.nonceB64}:{debugData?.signatureB64}</p>
            <p className="text-gray-400 text-xs font-bold uppercase tracking-wider mt-4">// Settled in QStash via Deduplication ID</p>
            <p className="text-green-400 text-xs font-mono break-all mt-1">jd123_{debugData?.nonceHex}</p>
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
          <h1 className="text-2xl font-black text-red-500">Webhook Failed</h1>
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

