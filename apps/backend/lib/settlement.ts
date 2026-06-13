import { Keypair, TransactionBuilder } from "@stellar/stellar-sdk";
import { networks } from "pijin_core";
import { prisma } from "@/lib/prisma";
import { expandNonce, verifySignatureLocally } from "@/lib/crypto";
import { sendSmsReceipt } from "@/lib/textbee";
import {
  pijinContract,
  contractConfig,
  sorobanRpcServer,
} from "@/lib/pijin-contract";

export type SettlementInput = {
  smsContent: string;
};

export type SettlementResult =
  | { ok: true; txHash?: string; amountXlm: string; merchantShortId: string }
  | { ok: false; status: number; error: string };

function normalizePhone(value?: string | null): string | null {
  if (!value) return null;
  return value.replace(/[^\d+]/g, "");
}

async function getExpiryLedger(): Promise<number> {
  const latestLedger = await sorobanRpcServer.getLatestLedger();
  return latestLedger.sequence + contractConfig.expiryBufferLedgers;
}

async function signWithRelayer(
  xdr: string,
  signOpts?: { networkPassphrase?: string }
): Promise<{ signedTxXdr: string; signerAddress: string }> {
  if (!process.env.RELAYER_SECRET_KEY) {
    throw new Error("Missing RELAYER_SECRET_KEY");
  }

  const relayerKeypair = Keypair.fromSecret(process.env.RELAYER_SECRET_KEY);
  const passphrase =
    signOpts?.networkPassphrase ?? networks.testnet.networkPassphrase;
  const transaction = TransactionBuilder.fromXDR(xdr, passphrase);
  transaction.sign(relayerKeypair);
  return {
    signedTxXdr: transaction.toXDR(),
    signerAddress: relayerKeypair.publicKey(),
  };
}

export async function processOfflineSettlement(
  input: SettlementInput
): Promise<SettlementResult> {
  const { smsContent } = input;
  const [custId, merchId, amountStr, nonceB64, sigB64] = smsContent.split(":");

  if (!custId || !merchId || !amountStr || !nonceB64 || !sigB64) {
    return { ok: false, status: 400, error: "Malformed Payload" };
  }

  const customerAccount = await prisma.account.findUnique({
    where: { shortId: custId },
  });
  const merchantAccount = await prisma.account.findUnique({
    where: { shortId: merchId },
  });

  if (!customerAccount || !merchantAccount) {
    return { ok: false, status: 404, error: "Account Not Found" };
  }

  const fullNonce32 = expandNonce(nonceB64);
  const expectedSignedData = `${merchId}:${amountStr}:${fullNonce32.toString("hex")}`;

  const verificationKey =
    customerAccount.offlineDeviceKey ?? customerAccount.stellarPublicKey;
  const isValid = verifySignatureLocally(
    verificationKey,
    expectedSignedData,
    sigB64
  );

  if (!isValid) {
    return { ok: false, status: 403, error: "Unauthorized" };
  }

  if (!process.env.RELAYER_PUBLIC_KEY || !process.env.RELAYER_SECRET_KEY) {
    return { ok: false, status: 500, error: "Relayer not configured" };
  }

  if (!contractConfig.tokenId) {
    return { ok: false, status: 500, error: "TOKEN_ID not configured" };
  }

  const amountStroops = BigInt(Math.round(parseFloat(amountStr) * 10_000_000));

  const tx = await pijinContract.spend_offline(
    {
      gateway: process.env.RELAYER_PUBLIC_KEY,
      customer: customerAccount.stellarPublicKey,
      merchant: merchantAccount.stellarPublicKey,
      token: contractConfig.tokenId,
      amount: amountStroops,
      nonce: fullNonce32,
      expiry_ledger: await getExpiryLedger(),
    },
    {
      publicKey: process.env.RELAYER_PUBLIC_KEY,
    }
  );

  const { result, sendTransactionResponse } = await tx.signAndSend({
    signTransaction: signWithRelayer,
  });

  try {
    await result;
  } catch {
    return {
      ok: false,
      status: 400,
      error: "Transaction reverted on-chain. Check Nonce or Vault Balance.",
    };
  }

  await prisma.settlement.create({
    data: {
      customerShortId: custId,
      merchantShortId: merchId,
      amountXlm: amountStr,
      txHash: sendTransactionResponse?.hash ?? null,
      status: "SETTLED",
    },
  });

  const receiptMsg = `SUCCESS: XLM${amountStr} Paid. PIN:${merchantAccount.merchantPin ?? "0000"}`;
  const receiptPhone = normalizePhone(merchantAccount.merchantPhone);
  if (receiptPhone) {
    void sendSmsReceipt(receiptPhone, receiptMsg).then((result) => {
      if (!result.success) {
        console.error(`[Textbee] Async SMS receipt failed: ${result.error}`);
      }
    });
  }

  return {
    ok: true,
    txHash: sendTransactionResponse?.hash,
    amountXlm: amountStr,
    merchantShortId: merchId,
  };
}
