"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Building2, CreditCard, Wallet } from 'lucide-react';

export default function TopUpPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleDeposit = () => {
    setLoading(true);
    // Simulate API delay for SEP-10 Auth
    setTimeout(() => {
      router.push('/demo/sep24-mock');
    }, 1500);
  };

  return (
    <div className="flex-1 bg-white flex flex-col relative text-black h-full rounded-[2rem] overflow-hidden">
      {/* Header */}
      <div className="px-6 py-5 flex items-center border-b border-gray-100">
        <ArrowLeft size={24} className="text-gray-800 cursor-pointer" onClick={() => router.back()} />
        <h1 className="ml-4 text-lg font-bold">Top-Up PHPC</h1>
      </div>

      <div className="px-6 py-6 flex-1 overflow-y-auto">
        <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-4">Select Method</h2>
        
        <div 
          onClick={handleDeposit}
          className="flex items-center p-4 bg-gray-50 rounded-2xl mb-4 border border-gray-100 cursor-pointer hover:bg-blue-50 transition-colors"
        >
          <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center text-blue-600">
            <Building2 size={24} />
          </div>
          <div className="ml-4 flex-1">
            <p className="font-bold text-gray-900">Bank Transfer (Testnet)</p>
            <p className="text-xs text-gray-500">Via Pijin Anchor Partner</p>
          </div>
        </div>

        <div className="flex items-center p-4 bg-gray-50 rounded-2xl mb-4 border border-gray-100 opacity-50">
          <div className="w-12 h-12 bg-gray-200 rounded-full flex items-center justify-center text-gray-500">
            <CreditCard size={24} />
          </div>
          <div className="ml-4 flex-1">
            <p className="font-bold text-gray-900">Credit / Debit Card</p>
            <p className="text-xs text-gray-500">Coming Soon</p>
          </div>
        </div>
        
        <div className="flex items-center p-4 bg-gray-50 rounded-2xl border border-gray-100 opacity-50">
          <div className="w-12 h-12 bg-gray-200 rounded-full flex items-center justify-center text-gray-500">
            <Wallet size={24} />
          </div>
          <div className="ml-4 flex-1">
            <p className="font-bold text-gray-900">Crypto Deposit</p>
            <p className="text-xs text-gray-500">Coming Soon</p>
          </div>
        </div>
      </div>

      {loading && (
        <div className="absolute inset-0 bg-white/80 backdrop-blur-sm flex flex-col items-center justify-center z-50">
          <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
          <p className="mt-4 font-bold text-gray-800">Authenticating with Anchor...</p>
        </div>
      )}
    </div>
  );
}
