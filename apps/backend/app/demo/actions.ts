"use server";

import { Keypair, Horizon, TransactionBuilder, Asset, Networks, Operation } from '@stellar/stellar-sdk';
import { prisma } from '@/lib/prisma';
import { generateOfflineSmsPayload } from './utils/crypto';

export async function submitOfflineVoucher(
  senderSecretKey: string,
  receiverShortId: string,
  amountPhp: number
) {
  try {
    const senderKp = Keypair.fromSecret(senderSecretKey);
    const publicKey = senderKp.publicKey();

    let sender = await prisma.account.findUnique({ where: { stellarPublicKey: publicKey } });
    
    // Fallback: If they have a stale session but aren't in DB, register them now
    if (!sender) {
      console.log("Sender not in DB, auto-registering stale session...");
      await registerJudgeAccount(publicKey);
      sender = await prisma.account.findUnique({ where: { stellarPublicKey: publicKey } });
    }
    
    if (!sender) throw new Error("Sender could not be registered in DB");

    const token = await prisma.token.findUnique({ where: { symbol: 'PHPC' } });
    if (!token) throw new Error("PHPC token not found in DB");

    let gateway = await prisma.gatewayNode.findFirst({ where: { isActive: true } });
    
    // Fallback: If no gateway node is seeded in local DB, create a mock one so simulation can proceed
    if (!gateway) {
      console.log("No gateway node found, auto-provisioning mock Gateway Node...");
      const gatewayKp = Keypair.random();
      gateway = await prisma.gatewayNode.create({
        data: {
          name: "Simulation Gateway",
          stellarPublicKey: gatewayKp.publicKey(),
          isActive: true
        }
      });
    }

    const amountStroops = BigInt(Math.floor(amountPhp * 10_000_000));

    const result = await generateOfflineSmsPayload({
      senderSecretKey,
      senderShortId: sender.shortId,
      receiverShortId,
      amountStroops,
      gatewayPubKey: gateway.stellarPublicKey,
      tokenContractId: token.contractId,
      tokenSymbol: token.symbol,
      tokenIdStr: token.id.toString(),
    });

    const webhookSecret = process.env.TEXTBEE_WEBHOOK_SECRET || 'my-super-secret-password-123';
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    
    // Send to Webhook
    const res = await fetch(`${appUrl}/api/sms/webhook?secret=${webhookSecret}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: "RECEIVED",
        sender: sender.phoneNumber,
        message: result.smsPayload
      })
    });

    const webhookResponse = await res.json();

    // ─────────────────────────────────────────────────────────────────
    // LOCAL DEV BYPASS:
    // When testing locally, Qstash cannot reach localhost.
    // Instead of incorrectly deducting the Testnet Online Balance, we just return a bypass flag
    // so the frontend can deduct the mock Offline Vault from sessionStorage.
    // ─────────────────────────────────────────────────────────────────
    if (res.ok && process.env.NODE_ENV === 'development') {
      console.log("Local Dev Detected: Bypassing Qstash localhost restriction...");
      return { success: true, debug: result.debug, webhookResponse, localBypass: true };
    }

    return { success: res.ok, debug: result.debug, webhookResponse };
  } catch (err: any) {
    console.error("Offline voucher simulation failed:", err);
    return { success: false, error: err.message };
  }
}

export async function burnPHPC(publicKey: string, amountPhp: string, secretKey: string) {
  try {
    const { rpc, xdr, Contract, Address, nativeToScVal, StrKey } = require('@stellar/stellar-sdk');
    const server = new rpc.Server(HORIZON_TESTNET_URL.replace('horizon', 'soroban'), { allowHttp: true });
    
    // 1. Load sequence
    const horizonServer = new Horizon.Server(HORIZON_TESTNET_URL);
    const account = await horizonServer.loadAccount(publicKey);
    
    // 2. Build TX
    const contract = new Contract(process.env.CONTRACT_ID || "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC");
    const pubkeyRaw = StrKey.decodeEd25519PublicKey(publicKey);
    const pubkeyScVal = xdr.ScVal.scvBytes(Buffer.from(pubkeyRaw));
    
    const amountStroops = BigInt(Math.floor(parseFloat(amountPhp) * 10_000_000));
    
    let tx = new TransactionBuilder(account, { fee: "1000", networkPassphrase: Networks.TESTNET })
      .addOperation(
        contract.call(
          'deposit',
          new Address(publicKey).toScVal(),
          new Address(process.env.TOKEN_ID || "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC").toScVal(),
          pubkeyScVal,
          nativeToScVal(amountStroops.toString(), { type: 'i128' })
        )
      )
      .setTimeout(180)
      .build();

    // 3. Simulate
    const simulation = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(simulation)) throw new Error(`Simulation failed: ${simulation.error}`);

    // 4. Assemble
    tx = rpc.assembleTransaction(tx, simulation).build();

    // 5. Sign & Send
    const kp = Keypair.fromSecret(secretKey);
    tx.sign(kp);
    
    const sendRes = await server.sendTransaction(tx);
    if (sendRes.status === 'ERROR') throw new Error("Transaction rejected by network.");
    
    // 6. Poll for confirmation
    let isConfirmed = false;
    for (let i = 0; i < 15; i++) {
      const response = await server.getTransaction(sendRes.hash);
      if (response.status === 'SUCCESS') {
        isConfirmed = true;
        break;
      }
      if (response.status !== 'NOT_FOUND') {
        throw new Error(`Transaction failed with status: ${response.status}`);
      }
      await new Promise(r => setTimeout(r, 2000));
    }
    
    if (!isConfirmed) throw new Error("Transaction timed out. Please check again later.");

    return { success: true, hash: sendRes.hash };
  } catch (err: any) {
    console.error("Soroban Load Offline failed:", err);
    return { success: false, error: err.message };
  }
}

export async function mintPHPC(publicKey: string, amount: string) {
  return simulateDeposit(publicKey, amount);
}


export async function registerJudgeAccount(publicKey: string) {
  try {
    const existing = await prisma.account.findUnique({
      where: { stellarPublicKey: publicKey }
    });
    
    if (existing) return existing.shortId;

    const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
    const shortId = `jd${randomSuffix}`;
    const phoneNumber = `+63999000${Math.floor(1000 + Math.random() * 9000)}`;

    const account = await prisma.account.create({
      data: {
        stellarPublicKey: publicKey,
        offlineDeviceKey: publicKey,
        shortId: shortId,
        phoneNumber: phoneNumber,
        role: "USER"
      }
    });

    return account.shortId;
  } catch (err: any) {
    console.error("Database registration failed:", err);
    throw new Error("Failed to register Ghost Account in DB");
  }
}


const PHPC_DIST_SECRET = "SCANG3TWL5L6HIJIPMGBU6HSAQBSPQTDNPGWPB5GDCH2PV3UGINPYKUF";
const PHPC_ISSUER = "GDDKZAOAME26SD2GAQGGDUTI6F5VQ5CLXXELWOYOAXLUIQTQVLIFWZLY";
const HORIZON_TESTNET_URL = "https://horizon-testnet.stellar.org";
const server = new Horizon.Server(HORIZON_TESTNET_URL);

export async function simulateDeposit(publicKey: string, amount: string) {
  try {
    const distKp = Keypair.fromSecret(PHPC_DIST_SECRET);
    const distAccount = await server.loadAccount(distKp.publicKey());
    
    const phpcAsset = new Asset("PHPC", PHPC_ISSUER);

    const tx = new TransactionBuilder(distAccount, {
      fee: "100",
      networkPassphrase: Networks.TESTNET
    })
      .addOperation(Operation.payment({
        destination: publicKey,
        asset: phpcAsset,
        amount: amount,
      }))
      .setTimeout(30)
      .build();

    tx.sign(distKp);

    const res = await server.submitTransaction(tx);
    return { success: res.successful, hash: res.hash };
  } catch (err: any) {
    console.error("Simulation deposit failed:", err);
    return { success: false, error: err.message };
  }
}
