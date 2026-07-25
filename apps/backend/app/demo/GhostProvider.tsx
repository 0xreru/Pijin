"use client";

import React, { createContext, useContext, useEffect, useState } from 'react';
import { Keypair, Horizon, Asset, TransactionBuilder, Networks, Operation } from '@stellar/stellar-sdk';
import { registerJudgeAccount } from './actions';

interface JudgeContextType {
  publicKey: string;
  secretKey: string;
  shortId: string;
  role: string;
}

const JudgeContext = createContext<JudgeContextType | null>(null);

export function useJudgeContext() {
  const ctx = useContext(JudgeContext);
  if (!ctx) throw new Error("useJudgeContext must be used within GhostProvider");
  return ctx;
}

const PHPC_ISSUER = 'GDDKZAOAME26SD2GAQGGDUTI6F5VQ5CLXXELWOYOAXLUIQTQVLIFWZLY';
const HORIZON_TESTNET_URL = 'https://horizon-testnet.stellar.org';
const server = new Horizon.Server(HORIZON_TESTNET_URL);

export default function GhostProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("Initializing Simulation Environment...");
  const [judge, setJudge] = useState<JudgeContextType | null>(null);

  useEffect(() => {
    async function initializeGhost() {
      // Parse role from URL if present
      const urlParams = new URLSearchParams(window.location.search);
      const role = urlParams.get('role') || 'sender';
      const sessionKey = `judge_secret_${role}`;

      // 1. Check if we already have a session for THIS role
      const storedSec = sessionStorage.getItem(sessionKey);
      if (storedSec) {
        try {
          const kp = Keypair.fromSecret(storedSec);
          const shortId = await registerJudgeAccount(kp.publicKey());
          setJudge({ publicKey: kp.publicKey(), secretKey: kp.secret(), shortId, role });
          setLoading(false);
          return;
        } catch(err) {
          console.error("Failed to restore session", err);
        }
      }

      // 2. Check for Hardcoded Demo Account (Pre-provisioned Mobile Account)
      // Only use the hardcoded SENDER secret if the role is sender.
      const senderSecret = process.env.NEXT_PUBLIC_DEMO_SECRET_KEY;
      const receiverSecret = process.env.NEXT_PUBLIC_DEMO_RECEIVER_SECRET; // Optional
      
      const targetSecret = role === 'sender' ? senderSecret : receiverSecret;

      if (targetSecret) {
        try {
          const kp = Keypair.fromSecret(targetSecret);
          const shortId = await registerJudgeAccount(kp.publicKey());
          sessionStorage.setItem(sessionKey, kp.secret());
          setJudge({ publicKey: kp.publicKey(), secretKey: kp.secret(), shortId, role });
          setLoading(false);
          return;
        } catch (err) {
          console.error(`Invalid ${role} hardcoded secret:`, err);
        }
      }

      try {
        // 3. Generate new Keypair (if no hardcoded secret exists for this role)
        setStatus(`Generating secure ${role} wallet...`);
        const kp = Keypair.random();
        const publicKey = kp.publicKey();
        const secretKey = kp.secret();

        // 3. Fund with Friendbot
        setStatus("Funding wallet with XLM (Friendbot)...");
        const res = await fetch(`https://friendbot.stellar.org/?addr=${publicKey}`);
        if (!res.ok) throw new Error("Friendbot funding failed");

        // 4. Establish PHPC Trustline
        setStatus("Establishing PHPC Trustline...");
        const account = await server.loadAccount(publicKey);
        const phpcAsset = new Asset("PHPC", PHPC_ISSUER);

        const tx = new TransactionBuilder(account, {
          fee: "100",
          networkPassphrase: Networks.TESTNET,
        })
          .addOperation(Operation.changeTrust({ asset: phpcAsset }))
          .setTimeout(30)
          .build();

        tx.sign(kp);

        const txResponse = await server.submitTransaction(tx);
        if (!txResponse.successful) throw new Error("Trustline transaction failed");

        // 4.5 Register in DB
        setStatus("Registering in PostgreSQL...");
        const shortId = await registerJudgeAccount(publicKey);

        // 5. Save to session and finish
        sessionStorage.setItem(sessionKey, secretKey);
        setJudge({ publicKey, secretKey, shortId, role });
        setLoading(false);
      } catch (err: any) {
        setStatus(`Error initializing: ${err.message}`);
      }
    }

    initializeGhost();
  }, []);

  if (loading) {
    return (
      <div className="flex-1 bg-black text-white flex flex-col items-center justify-center p-8 text-center space-y-6">
        <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
        <div className="text-xl font-bold tracking-wide">Pijin</div>
        <p className="text-sm text-neutral-400">{status}</p>
      </div>
    );
  }

  return (
    <JudgeContext.Provider value={judge!}>
      {children}
    </JudgeContext.Provider>
  );
}
