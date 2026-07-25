"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useJudgeContext } from '../../GhostProvider';
import { ArrowLeft, Send, CheckCircle, Globe } from 'lucide-react';
import { Horizon, Keypair, TransactionBuilder, Networks, Asset, Operation } from '@stellar/stellar-sdk';
import { getPublicKeyFromShortId } from '../../actions';
import Image from 'next/image';

const HORIZON_TESTNET_URL = 'https://horizon-testnet.stellar.org';
const server = new Horizon.Server(HORIZON_TESTNET_URL);
const PHPC_ISSUER = "GDDKZAOAME26SD2GAQGGDUTI6F5VQ5CLXXELWOYOAXLUIQTQVLIFWZLY";

export default function OnlineTransferPage() {
  const router = useRouter();
  const { secretKey } = useJudgeContext();
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<"idle" | "sending" | "success" | "error" | "not_found">("idle");
  const [receiver, setReceiver] = useState("");
  const [amount, setAmount] = useState("10");

  const handleSend = async () => {
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) return;
    if (!receiver) return;

    setLoading(true);
    setStatus("sending");
    
    try {
      const destinationPubKey = await getPublicKeyFromShortId(receiver);
      if (!destinationPubKey) {
        setStatus("not_found");
        setLoading(false);
        return;
      }

      const senderKp = Keypair.fromSecret(secretKey);
      const account = await server.loadAccount(senderKp.publicKey());
      const phpcAsset = new Asset("PHPC", PHPC_ISSUER);

      const tx = new TransactionBuilder(account, {
        fee: "100",
        networkPassphrase: Networks.TESTNET
      })
        .addOperation(Operation.payment({
          destination: destinationPubKey,
          asset: phpcAsset,
          amount: amount
        }))
        .setTimeout(30)
        .build();

      tx.sign(senderKp);
      const res = await server.submitTransaction(tx);
      
      if (res.successful) {
        setStatus("success");
      } else {
        setStatus("error");
      }
    } catch (err: any) {
      console.error("Online transfer failed:", err);
      setStatus("error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 bg-[#F5F5F6] h-full relative rounded-[2rem] overflow-hidden flex flex-col">
      <div className="bg-white p-6 pb-8 rounded-b-[2rem] shadow-sm z-10 relative">
        <div className="flex items-center mb-6">
          <ArrowLeft size={24} className="text-gray-800 cursor-pointer hover:opacity-70 transition-opacity" onClick={() => router.back()} />
          <h1 className="ml-4 text-xl font-bold text-gray-900 tracking-tight">Online Transfer</h1>
        </div>
        
        {status === "idle" && (
          <div className="flex flex-col items-center justify-center pt-2 pb-4">
            <div className="w-40 h-40 bg-gray-50 rounded-full flex items-center justify-center mb-4 border border-gray-100 shadow-inner">
              <Globe size={64} className="text-blue-500" />
            </div>
            <p className="text-center text-sm text-gray-500 font-medium max-w-[240px]">
              Transfer funds over the internet directly on the Stellar ledger.
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
            <label className="block text-xs font-bold text-gray-400 mb-2 uppercase tracking-widest pl-1">Amount (PHPC)</label>
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
              <Globe size={20} className="text-blue-500" />
            </div>
            <div>
              <p className="text-sm font-bold text-gray-900">Stellar Network</p>
              <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                Standard online transaction. Funds are settled immediately on the Stellar ledger in ~3 seconds.
              </p>
            </div>
          </div>

          <button 
            onClick={handleSend}
            className="w-full bg-black text-white font-bold py-5 rounded-full flex justify-center items-center mt-auto shadow-xl shadow-black/20 hover:scale-[1.02] active:scale-95 transition-all"
          >
            Send Now
          </button>
        </div>
      )}

      {status === "sending" && (
        <div className="flex-1 flex flex-col items-center justify-center text-center animate-in fade-in p-6">
          <div className="w-24 h-24 bg-blue-50 rounded-full flex items-center justify-center mb-6">
            <Send size={48} className="text-blue-600 animate-pulse" />
          </div>
          <h2 className="text-2xl font-black text-gray-900 mb-2">Submitting to Ledger...</h2>
          <p className="text-gray-500 text-sm font-medium">
            Waiting for consensus on the Stellar Testnet.
          </p>
        </div>
      )}

      {status === "not_found" && (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-6">
          <h1 className="text-2xl font-black text-red-500">Account Not Found</h1>
          <p className="text-gray-500 text-sm mt-2">The Short ID "{receiver}" does not exist.</p>
          <button onClick={() => setStatus("idle")} className="mt-8 bg-gray-100 text-gray-900 font-bold px-8 py-4 rounded-full">Try Again</button>
        </div>
      )}

      {status === "success" && (
        <div className="flex-1 flex flex-col items-center justify-center text-center animate-in zoom-in p-6">
          <div className="w-24 h-24 bg-green-50 rounded-full flex items-center justify-center mb-6">
            <CheckCircle size={48} className="text-green-500" />
          </div>
          <h1 className="text-2xl font-black text-gray-900 mb-2">Transfer Complete!</h1>
          <p className="text-gray-500 text-sm font-medium max-w-[250px] mb-8">
            ₱ {amount} PHPC was successfully sent.
          </p>
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
          <p className="text-gray-500 text-sm mt-2">There was a network error or you have insufficient funds.</p>
          <button onClick={() => setStatus("idle")} className="mt-8 bg-gray-100 text-gray-900 font-bold px-8 py-4 rounded-full">Retry</button>
        </div>
      )}
    </div>
  );
}
