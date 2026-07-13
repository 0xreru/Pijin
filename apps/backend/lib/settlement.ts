import { Keypair, TransactionBuilder } from "@stellar/stellar-sdk";
import { prisma } from "@/lib/prisma";
import { sendSmsReceipt } from "@/lib/textbee";
import { contractConfig, pijinContract } from "@/lib/pijin-contract";
import {
  buildOfflineSignatureXdr,
  parseOfflineVoucher,
  verifyOfflineVoucherSignature,
} from "@/lib/offline-voucher";

export type SettlementInput = {
  smsContent: string;
};

export type SettlementResult =
  | { ok: true; txHash?: string; amountStroops: string; receiverShortId: string }
  | { ok: false; status: number; error: string };

function normalizePhone(value?: string | null): string | null {
  if (!value) return null;
  return value.replace(/[^\d+]/g, "");
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
    signOpts?.networkPassphrase ?? contractConfig.networkPassphrase;
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
  let voucher;
  try {
    voucher = parseOfflineVoucher(smsContent);
  } catch (error) {
    return {
      ok: false,
      status: 400,
      error: error instanceof Error ? error.message : "Malformed Payload",
    };
  }

  const {
    tokenId,
    senderShortId,
    receiverShortId,
    amountStroops,
    nonceB64,
    nonce,
    signature,
  } = voucher;

  const [senderAccount, receiverAccount, token] = await Promise.all([
    prisma.account.findUnique({ where: { shortId: senderShortId } }),
    prisma.account.findUnique({ where: { shortId: receiverShortId } }),
    prisma.token.findUnique({ where: { id: tokenId } }),
  ]);

  if (!senderAccount || !receiverAccount) {
    return { ok: false, status: 404, error: "Account Not Found" };
  }

  if (!token) {
    return { ok: false, status: 404, error: "Token Not Found" };
  }

  if (!token.isActive) {
    return { ok: false, status: 400, error: "Token is inactive" };
  }

  if (!process.env.RELAYER_PUBLIC_KEY || !process.env.RELAYER_SECRET_KEY) {
    return { ok: false, status: 500, error: "Relayer not configured" };
  }

  const verificationKey = senderAccount.offlineDeviceKey;
  if (!verificationKey) {
    return {
      ok: false,
      status: 409,
      error: 'Offline device key is not enrolled. Sign in online to synchronize this device.',
    };
  }
  const tollStroops = token.symbol === "PHPC" ? 5_000_000n : 0n;
  const signedXdr = buildOfflineSignatureXdr({
    amountStroops,
    tollStroops,
    nonce,
    receiverShortId,
    gatewayPublicKey: process.env.RELAYER_PUBLIC_KEY,
    tokenContractId: token.contractId,
  });
  const isValid = verifyOfflineVoucherSignature(
    verificationKey,
    signedXdr,
    signature,
  );

  if (!isValid) {
    return { ok: false, status: 403, error: "Unauthorized" };
  }

  const tx = await pijinContract.spend_offline(
    {
      gateway:       process.env.RELAYER_PUBLIC_KEY,
      sender:        senderAccount.stellarPublicKey,
      token:         token.contractId,
      receiver_short_id: Buffer.from(receiverShortId, "ascii"),
      amount:        amountStroops,
      protocol_toll: tollStroops,
      nonce,
      signature,
    },
    {
      publicKey: process.env.RELAYER_PUBLIC_KEY,
    }
  );

  const { sendTransactionResponse } = await tx.signAndSend({
    signTransaction: signWithRelayer,
  });

  const txHash = sendTransactionResponse?.hash;

  await prisma.settlement.create({
    data: {
      qstashMessageId: `lib-${Date.now()}`,
      nonce:           nonceB64,
      senderShortId,
      receiverShortId,
      tokenId,
      amountStroops,
      relayerAddress:  process.env.RELAYER_PUBLIC_KEY ?? null,
      txHash:          txHash ?? null,
      status:          "SETTLED",
    },
  });

  // Send SMS receipt to receiver (merchant) using pin/phoneNumber fields
  const receiptMsg = `SUCCESS: Received ${amountStroops} stroops. PIN:${receiverAccount.pin ?? "0000"}`;
  const receiptPhone = normalizePhone(receiverAccount.phoneNumber);
  if (receiptPhone) {
    void sendSmsReceipt(receiptPhone, receiptMsg).then((result) => {
      if (!result.success) {
        console.error(`[Textbee] Async SMS receipt failed: ${result.error}`);
      }
    });
  }

  return {
    ok: true,
    txHash,
    amountStroops: amountStroops.toString(),
    receiverShortId,
  };
}
