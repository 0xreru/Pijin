"use server";

import {
  Address,
  Asset,
  Contract,
  Horizon,
  Keypair,
  Memo,
  nativeToScVal,
  Networks,
  Operation,
  rpc,
  StrKey,
  TransactionBuilder,
  Transaction,
  xdr,
} from '@stellar/stellar-sdk';
import { prisma } from '@/lib/prisma';
import { parsePhpcToStroops } from '@/lib/demo/offline-transfer-balance';
import {
  createDemoWithdrawRequest,
  demoWithdrawCanonicalMessage,
} from '@/lib/demo/withdraw-request';
import { getClaimedDemoPair } from '@/lib/demo/pool';
import { contractConfig, sorobanRpcServer } from '@/lib/pijin-contract';
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

type DemoRole = 'sender' | 'receiver';

async function demoAccountFor(sessionId: string, role: DemoRole) {
  const session = await getClaimedDemoPair(sessionId);
  return session[role];
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { error: text || `Request failed with status ${response.status}` };
  }
}

export async function transferDemoOfflineToOnline(
  sessionId: string,
  role: DemoRole,
  amountPhpc: string,
) {
  try {
    const amountStroops = parsePhpcToStroops(amountPhpc);
    if (amountStroops === null) {
      throw new Error('Enter a valid PHPC amount with no more than 7 decimal places');
    }
    const account = await demoAccountFor(sessionId, role);
    const tokenAddress = contractConfig.tokenId;
    if (!tokenAddress) throw new Error('Server missing TOKEN_ID');

    const withdrawRequest = createDemoWithdrawRequest(
      account.publicKey,
      tokenAddress,
      amountStroops,
    );
    const signature = Keypair.fromSecret(account.walletSecret)
      .sign(Buffer.from(demoWithdrawCanonicalMessage(withdrawRequest)))
      .toString('base64');
    const appUrl = (
      process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    ).replace(/\/+$/, '');
    const response = await fetch(`${appUrl}/api/engine/withdraw`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${signature}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(withdrawRequest),
      cache: 'no-store',
    });
    const payload = await responseJson(response);
    if (!response.ok || typeof payload.xdr !== 'string') {
      throw new Error(String(payload.error || 'Unable to assemble the withdrawal'));
    }

    const transaction = new Transaction(payload.xdr, contractConfig.networkPassphrase);
    transaction.sign(Keypair.fromSecret(account.walletSecret));
    const submitted = await sorobanRpcServer.sendTransaction(transaction);
    if (submitted.status === 'ERROR') {
      throw new Error('The Stellar network rejected the withdrawal');
    }

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const result = await sorobanRpcServer.getTransaction(submitted.hash);
      if (result.status === 'SUCCESS') {
        return { success: true as const, hash: submitted.hash };
      }
      if (result.status !== 'NOT_FOUND') {
        throw new Error(`Withdrawal failed with status ${result.status}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    throw new Error('Withdrawal confirmation timed out. Check the wallet balance again.');
  } catch (error: unknown) {
    console.error('Demo offline-to-online withdrawal failed:', error);
    return { success: false as const, error: errorMessage(error) };
  }
}

export async function startDemoSep24Withdrawal(
  sessionId: string,
  role: DemoRole,
) {
  try {
    const account = await demoAccountFor(sessionId, role);
    const keypair = Keypair.fromSecret(account.walletSecret);
    const appUrl = (
      process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    ).replace(/\/+$/, '');

    const challengeResponse = await fetch(
      `${appUrl}/api/auth?account=${encodeURIComponent(account.publicKey)}`,
      { cache: 'no-store' },
    );
    const challenge = await responseJson(challengeResponse);
    if (!challengeResponse.ok || typeof challenge.transaction !== 'string') {
      throw new Error(String(challenge.message || challenge.error || 'SEP-10 challenge failed'));
    }
    const challengeTx = new Transaction(challenge.transaction, Networks.TESTNET);
    challengeTx.sign(keypair);

    const tokenResponse = await fetch(`${appUrl}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transaction: challengeTx.toXDR() }),
      cache: 'no-store',
    });
    const tokenPayload = await responseJson(tokenResponse);
    if (!tokenResponse.ok || typeof tokenPayload.token !== 'string') {
      throw new Error(String(tokenPayload.message || tokenPayload.error || 'SEP-10 authentication failed'));
    }

    const interactiveResponse = await fetch(
      `${appUrl}/api/sep24/transactions/withdraw/interactive`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenPayload.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ asset_code: 'PHPC' }),
        cache: 'no-store',
      },
    );
    const interactive = await responseJson(interactiveResponse);
    if (
      !interactiveResponse.ok ||
      typeof interactive.url !== 'string' ||
      typeof interactive.id !== 'string'
    ) {
      throw new Error(String(interactive.message || interactive.error || 'SEP-24 withdrawal failed'));
    }
    return {
      success: true as const,
      url: interactive.url,
      transactionId: interactive.id,
      token: tokenPayload.token,
    };
  } catch (error: unknown) {
    console.error('Demo SEP-24 start failed:', error);
    return { success: false as const, error: errorMessage(error) };
  }
}

export async function completeDemoSep24Withdrawal(
  sessionId: string,
  role: DemoRole,
  transactionId: string,
  sep10Token: string,
) {
  try {
    const account = await demoAccountFor(sessionId, role);
    const appUrl = (
      process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    ).replace(/\/+$/, '');
    const statusResponse = await fetch(
      `${appUrl}/api/sep24/transaction?id=${encodeURIComponent(transactionId)}`,
      {
        headers: { Authorization: `Bearer ${sep10Token}` },
        cache: 'no-store',
      },
    );
    const statusPayload = await responseJson(statusResponse);
    const instruction = statusPayload.transaction as Record<string, unknown> | undefined;
    if (!statusResponse.ok || !instruction) {
      throw new Error(String(statusPayload.message || statusPayload.error || 'Withdrawal instructions unavailable'));
    }
    const amount = typeof instruction.amount_in === 'string' ? instruction.amount_in : '';
    const destination =
      typeof instruction.withdraw_anchor_account === 'string'
        ? instruction.withdraw_anchor_account
        : '';
    const memo = typeof instruction.withdraw_memo === 'string' ? instruction.withdraw_memo : '';
    if (
      instruction.status !== 'pending_user_transfer_start' ||
      instruction.stellar_account !== account.publicKey ||
      instruction.asset_code !== 'PHPC' ||
      !amount ||
      !destination ||
      !memo
    ) {
      throw new Error('The anchor returned invalid or incomplete withdrawal instructions');
    }

    const keypair = Keypair.fromSecret(account.walletSecret);
    const source = await server.loadAccount(account.publicKey);
    const transaction = new TransactionBuilder(source, {
      fee: '100',
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.payment({
          destination,
          asset: new Asset('PHPC', requiredDemoEnv('PHPC_ISSUER_PUBKEY')),
          amount,
        }),
      )
      .addMemo(Memo.text(memo))
      .setTimeout(180)
      .build();
    transaction.sign(keypair);
    const submitted = await server.submitTransaction(transaction);

    const confirmResponse = await fetch(`${appUrl}/api/anchor/confirm-withdraw`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sep10Token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        transaction_id: transactionId,
        stellar_transaction_id: submitted.hash,
      }),
      cache: 'no-store',
    });
    const confirmation = await responseJson(confirmResponse);
    if (!confirmResponse.ok || confirmation.success !== true) {
      throw new Error(String(confirmation.error || 'Anchor could not verify the PHPC transfer'));
    }
    return {
      success: true as const,
      hash: submitted.hash,
      amount,
      status: String(confirmation.status || 'pending_external'),
    };
  } catch (error: unknown) {
    console.error('Demo SEP-24 completion failed:', error);
    return { success: false as const, error: errorMessage(error) };
  }
}
