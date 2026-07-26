"use server";

import {
  Address,
  Asset,
  Contract,
  Horizon,
  Keypair,
  nativeToScVal,
  Networks,
  Operation,
  rpc,
  StrKey,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';
import { prisma } from '@/lib/prisma';
import { parsePhpcToStroops } from '@/lib/demo/offline-transfer-balance';
import { generateOfflineSmsPayload } from './utils/crypto';

function requiredDemoEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Server missing ${name}`);
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function webhookErrorMessage(response: unknown, status: number): string {
  if (
    response &&
    typeof response === 'object' &&
    'error' in response &&
    typeof response.error === 'string'
  ) {
    return response.error;
  }
  return `Webhook request failed with status ${status}`;
}

export async function submitOfflineVoucher(
  senderPublicKey: string,
  senderDeviceSecretKey: string,
  receiverShortId: string,
  amountPhpc: string,
) {
  try {
    const senderDevice = Keypair.fromSecret(senderDeviceSecretKey);
    const sender = await prisma.account.findUnique({
      where: { stellarPublicKey: senderPublicKey },
    });
    if (!sender) throw new Error("Sender is not registered in DB");
    if (sender.offlineDeviceKey !== senderDevice.publicKey()) {
      throw new Error("Demo device key does not match the enrolled sender device");
    }

    const token = await prisma.token.findUnique({ where: { symbol: 'PHPC' } });
    if (!token) throw new Error("PHPC token not found in DB");

    const gatewayPubKey = process.env.RELAYER_PUBLIC_KEY;
    if (!gatewayPubKey) throw new Error("Server missing RELAYER_PUBLIC_KEY");

    const amountStroops = parsePhpcToStroops(amountPhpc);
    if (amountStroops === null) {
      throw new Error('Enter a valid PHPC amount with no more than 7 decimal places');
    }

    const result = await generateOfflineSmsPayload({
      senderSecretKey: senderDeviceSecretKey,
      senderShortId: sender.shortId,
      receiverShortId,
      amountStroops,
      gatewayPubKey,
      tokenContractId: token.contractId,
      tokenSymbol: token.symbol,
      tokenIdStr: token.id.toString(),
    });

    const webhookSecret = requiredDemoEnv('TEXTBEE_WEBHOOK_SECRET');
    const appUrl = (
      process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    ).replace(/\/+$/, '');
    const senderTransportId =
      sender.phoneNumber?.trim() || `demo:${sender.shortId}`;
    
    // Send to Webhook
    const res = await fetch(`${appUrl}/api/sms/webhook?secret=${webhookSecret}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: "RECEIVED",
        sender: senderTransportId,
        message: result.smsPayload
      })
    });

    const responseText = await res.text();
    let webhookResponse: unknown = responseText;
    try {
      webhookResponse = JSON.parse(responseText);
    } catch {
      // Preserve non-JSON responses so the caller still gets useful context.
    }

    if (!res.ok) {
      return {
        success: false as const,
        error: webhookErrorMessage(webhookResponse, res.status),
        webhookResponse,
      };
    }

    // ─────────────────────────────────────────────────────────────────
    // LOCAL DEV BYPASS:
    // When testing locally, Qstash cannot reach localhost.
    // Instead of incorrectly deducting the Testnet Online Balance, we just return a bypass flag
    // so the frontend can deduct the mock Offline Vault from sessionStorage.
    // ─────────────────────────────────────────────────────────────────
    if (process.env.NODE_ENV === 'development') {
      console.log("Local Dev Detected: Bypassing Qstash localhost restriction...");
      return {
        success: true as const,
        debug: {
          ...result.debug,
          smsPayload: result.smsPayload,
          senderShortId: sender.shortId,
        },
        webhookResponse,
        localBypass: true,
      };
    }

    return {
      success: true as const,
      debug: {
        ...result.debug,
        smsPayload: result.smsPayload,
        senderShortId: sender.shortId,
      },
      webhookResponse,
    };
  } catch (err: unknown) {
    console.error("Offline voucher simulation failed:", err);
    return { success: false as const, error: errorMessage(err) };
  }
}

export async function burnPHPC(
  publicKey: string,
  amountPhp: string,
  secretKey: string,
  devicePublicKey: string,
) {
  try {
    const server = new rpc.Server(HORIZON_TESTNET_URL.replace('horizon', 'soroban'), { allowHttp: true });
    
    // 1. Load sequence
    const horizonServer = new Horizon.Server(HORIZON_TESTNET_URL);
    const account = await horizonServer.loadAccount(publicKey);
    
    // 2. Build TX
    const contract = new Contract(process.env.CONTRACT_ID || "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC");
    const pubkeyRaw = StrKey.decodeEd25519PublicKey(devicePublicKey);
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
  } catch (err: unknown) {
    console.error("Soroban Load Offline failed:", err);
    return { success: false, error: errorMessage(err) };
  }
}

export async function mintPHPC(publicKey: string, amount: string) {
  return simulateDeposit(publicKey, amount);
}


const HORIZON_TESTNET_URL = "https://horizon-testnet.stellar.org";
const server = new Horizon.Server(HORIZON_TESTNET_URL);

export async function simulateDeposit(publicKey: string, amount: string) {
  try {
    const distKp = Keypair.fromSecret(requiredDemoEnv('PHPC_DISTRIBUTOR_SECRET'));
    const distAccount = await server.loadAccount(distKp.publicKey());
    
    const phpcAsset = new Asset("PHPC", requiredDemoEnv('PHPC_ISSUER_PUBKEY'));

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
  } catch (err: unknown) {
    console.error("Simulation deposit failed:", err);
    return { success: false, error: errorMessage(err) };
  }
}

export async function getPublicKeyFromShortId(shortId: string) {
  const account = await prisma.account.findUnique({
    where: { shortId }
  });
  if (!account) return null;
  return account.stellarPublicKey;
}
