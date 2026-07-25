"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useJudgeContext } from '../../GhostProvider';
import { ArrowLeft, Send, CheckCircle, Globe } from 'lucide-react';
import { Horizon, Keypair, TransactionBuilder, Networks, Asset, Operation } from '@stellar/stellar-sdk';

const HORIZON_TESTNET_URL = 'https://horizon-testnet.stellar.org';
const server = new Horizon.Server(HORIZON_TESTNET_URL);
const PHPC_ISSUER = "GDDKZAOAME26SD2GAQGGDUTI6F5VQ5CLXXELWOYOAXLUIQTQVLIFWZLY";

export default function OnlineTransferPage() {
  const router = useRouter();
  const { secretKey } = useJudgeContext();
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [receiver, setReceiver] = useState("GDDKZAOAME26SD2GAQGGDUTI6F5VQ5CLXXELWOYOAXLUIQTQVLIFWZLY");
  const [amount, setAmount] = useState("10");

  const handleSend = async () => {
    setLoading(true);
    setStatus("sending");
    
    try {
      const senderKp = Keypair.fromSecret(secretKey);
      const account = await server.loadAccount(senderKp.publicKey());
      const phpcAsset = new Asset("PHPC", PHPC_ISSUER);

      const tx = new TransactionBuilder(account, {
        fee: "100",
        networkPassphrase: Networks.TESTNET
      })
        .addOperation(Operation.payment({
          destination: receiver,
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
    <div className="flex-1 bg-white h-full relative rounded-[2rem] overflow-hidden flex flex-col p-6">
      <div className="flex items-center mb-6">
        <ArrowLeft size={24} className="text-gray-800 cursor-pointer" onClick={() => router.back()} />
        <h1 className="ml-4 text-lg font-bold">Online Transfer</h1>
      </div>

      {status === "idle" && (
        <div className="flex-1 flex flex-col">
          <div className="bg-gray-50 p-4 rounded-xl border border-gray-100 mb-6 flex items-start">
            <Globe size={24} className="text-blue-500 mr-3 mt-1" />
            <div>
              <p className="text-sm font-bold text-gray-800">Stellar Network</p>
              <p className="text-xs text-gray-500 mt-1">
                Standard online transaction. Funds are settled immediately on the Stellar ledger in ~3 seconds.
              </p>
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-xs font-bold text-gray-500 mb-1 uppercase tracking-wider">Receiver Public Key</label>
            <input 
              type="text"
              value={receiver}
              onChange={(e) => setReceiver(e.target.value)}
              className="w-full p-4 bg-gray-50 rounded-xl font-mono text-xs text-gray-900 outline-none border border-gray-200"
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
            onClick={handleSend}
            className="w-full bg-[#001E42] text-white font-bold py-4 rounded-full flex justify-center items-center mt-auto"
          >
            Send Now
          </button>
        </div>
      )}

      {status === "sending" && (
        <div className="flex-1 flex flex-col items-center justify-center text-center animate-in fade-in">
          <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mb-6">
            <Send size={32} className="text-blue-600 animate-pulse" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Submitting to Ledger...</h2>
          <p className="text-gray-500 text-sm max-w-[250px]">
            Waiting for consensus on the Stellar Testnet.
          </p>
        </div>
      )}

      {status === "success" && (
        <div className="flex-1 flex flex-col items-center justify-center text-center animate-in zoom-in">
          <CheckCircle size={80} className="text-green-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-gray-900">Transfer Complete!</h1>
          <p className="text-gray-500 mt-2 max-w-[250px]">
            ₱ {amount} PHPC was successfully sent to {receiver.slice(0, 6)}...{receiver.slice(-4)}
          </p>
          <button 
            onClick={() => router.push('/demo')}
            className="w-full bg-gray-100 text-gray-800 font-bold py-4 rounded-full mt-8"
          >
            Back to Dashboard
          </button>
        </div>
      )}
    </div>
  );
}
