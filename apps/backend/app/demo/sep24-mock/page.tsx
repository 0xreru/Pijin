"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useJudgeContext } from '../GhostProvider';
import { simulateDeposit } from '../actions';
import { CheckCircle, AlertCircle } from 'lucide-react';

export default function Sep24MockPage() {
  const router = useRouter();
  const { publicKey } = useJudgeContext();
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const [amount, setAmount] = useState("1000");

  const handleSimulate = async () => {
    setLoading(true);
    const res = await simulateDeposit(publicKey, amount);
    if (res.success) {
      setStatus("success");
      setTimeout(() => router.push('/demo'), 2000);
    } else {
      setStatus("error");
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 bg-white h-full relative rounded-[2rem] overflow-hidden flex flex-col p-6">
      <div className="flex-1 flex flex-col items-center justify-center text-center">
        
        {status === "idle" && (
          <>
            <div className="w-20 h-20 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mb-6">
              <AlertCircle size={40} />
            </div>
            <h1 className="text-xl font-bold text-gray-900 mb-4">SEP-24 Simulation Bypass</h1>
            <p className="text-gray-500 mb-8 px-4 text-sm">
              In the real Pijin app, this screen securely loads the bank's portal inside a WebView iframe. 
              Because we are in a web simulation, the Anchor blocks iframes for security reasons.
            </p>
            
            <div className="w-full bg-gray-50 p-4 rounded-xl border border-gray-100 mb-8">
              <label className="block text-xs font-bold text-gray-500 text-left mb-1 uppercase tracking-wider">Amount to Deposit</label>
              <div className="flex items-center">
                <span className="text-xl font-bold text-gray-400 mr-2">₱</span>
                <input 
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="bg-transparent text-2xl font-bold text-gray-900 w-full outline-none"
                />
              </div>
            </div>

            <button 
              onClick={handleSimulate}
              disabled={loading}
              className="w-full bg-[#001E42] text-white font-bold py-4 rounded-full flex justify-center items-center"
            >
              {loading ? (
                <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              ) : (
                "Simulate Successful Deposit"
              )}
            </button>
            <button 
              onClick={() => router.push('/demo')}
              className="w-full text-gray-500 font-bold py-4 mt-2"
            >
              Cancel
            </button>
          </>
        )}

        {status === "success" && (
          <div className="animate-in fade-in zoom-in duration-300">
            <CheckCircle size={80} className="text-green-500 mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-gray-900">Success!</h1>
            <p className="text-gray-500 mt-2">₱ {amount} PHPC deposited successfully.</p>
            <p className="text-sm text-gray-400 mt-4">Returning to dashboard...</p>
          </div>
        )}

      </div>
    </div>
  );
}
