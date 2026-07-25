"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useJudgeContext } from '../../GhostProvider';
import { submitOfflineVoucher } from '../../actions'; 
import { ArrowLeft, Send, CheckCircle, WifiOff, FileCode2, Key, Database, ShieldCheck } from 'lucide-react';

export default function OfflineTransferPage() {
  const router = useRouter();
  const { secretKey } = useJudgeContext();
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<"idle" | "visualizing" | "success" | "error">("idle");
  const [receiver, setReceiver] = useState("aB3x9Q");
  const [amount, setAmount] = useState("50");
  const [debugData, setDebugData] = useState<any>(null);

  const [step, setStep] = useState(0);

  const handleSimulateSms = async () => {
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
    <div className="flex-1 bg-white h-full relative rounded-[2rem] overflow-hidden flex flex-col p-6">
      <div className="flex items-center mb-6">
        <ArrowLeft size={24} className="text-gray-800 cursor-pointer" onClick={() => router.back()} />
        <h1 className="ml-4 text-lg font-bold">Offline Transfer</h1>
      </div>

      {status === "idle" && (
        <div className="flex-1 flex flex-col">
          <div className="bg-gray-50 p-4 rounded-xl border border-gray-100 mb-6 flex items-start">
            <WifiOff size={24} className="text-gray-400 mr-3 mt-1" />
            <div>
              <p className="text-sm font-bold text-gray-800">Authentic SMS Webhook Bypass</p>
              <p className="text-xs text-gray-500 mt-1">
                This will generate the exact mathematical XDR tuple and Ed25519 signature as the mobile app, 
                and POST it to the PostgreSQL/Qstash settlement engine webhook.
              </p>
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-xs font-bold text-gray-500 mb-1 uppercase tracking-wider">Receiver Short ID</label>
            <input 
              type="text"
              value={receiver}
              onChange={(e) => setReceiver(e.target.value)}
              className="w-full p-4 bg-gray-50 rounded-xl font-bold text-gray-900 outline-none border border-gray-200"
            />
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
            onClick={handleSimulateSms}
            className="w-full bg-[#001E42] text-white font-bold py-4 rounded-full flex justify-center items-center mt-auto"
          >
            Compress & Send SMS
          </button>
        </div>
      )}

      {status === "visualizing" && (
        <div className="flex-1 flex flex-col pt-4">
          <h2 className="text-lg font-bold text-gray-900 mb-6 text-center">Cryptographic Compression</h2>
          
          <div className="space-y-4">
            <StepCard active={step >= 1} icon={<Key />} title="1. Generate Nonce" desc="32-byte cryptographically secure random value" />
            <StepCard active={step >= 2} icon={<Database />} title="2. Amount Base62" desc="Compress amount from 10_000_000 stroops to Base62" />
            <StepCard active={step >= 3} icon={<FileCode2 />} title="3. Build XDR Tuple" desc="Serialize params to Soroban Vec<ScVal>" />
            <StepCard active={step >= 4} icon={<ShieldCheck />} title="4. Ed25519 Sign" desc="Sign raw XDR bytes with Judge's device key" />
            <StepCard active={step >= 5} icon={<Send />} title="5. Dispatch Webhook" desc="POST payload to /api/sms/webhook" isLast />
          </div>
        </div>
      )}

      {status === "success" && (
        <div className="flex-1 flex flex-col items-center justify-center text-center animate-in zoom-in overflow-y-auto pt-6 pb-20">
          <CheckCircle size={60} className="text-green-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-gray-900">SMS Webhook Success!</h1>
          
          <div className="w-full text-left mt-6 bg-gray-900 text-green-400 p-4 rounded-xl text-xs font-mono break-all border border-gray-800">
            <p className="text-gray-400 mb-2">// 6-Part Voucher Sent</p>
            <p className="mb-4">1:jd123:{receiver}:{debugData?.amountBase62}:{debugData?.nonceB64}:{debugData?.signatureB64}</p>
            <p className="text-gray-400">// Settled in Qstash with deduplicationId=jd123_{debugData?.nonceHex}</p>
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
          <h1 className="text-xl font-bold text-red-500">Webhook Failed</h1>
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

