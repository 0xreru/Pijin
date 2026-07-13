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
  | { ok: true; txHash?: string; amountStroops: string; receiverShortId: string }
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
  // Payload: tokenId:senderShortId:receiverShortId:amountBase62:nonce:signature
  const [tokenIdStr, senderShortId, receiverShortId, amountBase62, nonceB64, sigB64] =
    smsContent.split(":");

  if (!tokenIdStr || !senderShortId || !receiverShortId || !amountBase62 || !nonceB64 || !sigB64) {
    return { ok: false, status: 400, error: "Malformed Payload" };
  }

  const tokenId = parseInt(tokenIdStr, 10);
  if (isNaN(tokenId) || tokenId <= 0) {
    return { ok: false, status: 400, error: "Invalid tokenId" };
  }

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

  const fullNonce32 = expandNonce(nonceB64);
  const expectedSignedData = `${receiverShortId}:${amountBase62}:${fullNonce32.toString("hex")}`;

  const verificationKey = senderAccount.offlineDeviceKey;
  if (!verificationKey) {
    return {
      ok: false,
      status: 409,
      error: 'Offline device key is not enrolled. Sign in online to synchronize this device.',
    };
  }
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

  // Decode Base62 amount -> stroops BigInt
  const amountStroops = decodeBase62(amountBase62);

  const nonce32 = Buffer.alloc(32);
  fullNonce32.copy(nonce32);

  const sigBuffer = Buffer.from(
    restoreBase64Padding(sigB64),
    "base64"
  );

  const tx = await pijinContract.spend_offline(
    {
      gateway:       process.env.RELAYER_PUBLIC_KEY,
      sender:        senderAccount.stellarPublicKey,
      token:         token.contractId,
      receiver:      receiverAccount.stellarPublicKey,
      amount:        amountStroops,
      protocol_toll: 0n,
      nonce:         nonce32,
      signature:     sigBuffer,
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Decodes a Base62-encoded string into a BigInt.
 * Alphabet: 0-9A-Za-z (standard Base62, 62 characters).
 */
function decodeBase62(str: string): bigint {
  const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  const BASE = BigInt(62);
  let result = 0n;
  for (const char of str) {
    const idx = ALPHABET.indexOf(char);
    if (idx === -1) {
      throw new Error(`Invalid Base62 character: '${char}'`);
    }
    result = result * BASE + BigInt(idx);
  }
  return result;
}

/**
 * Restores '=' padding stripped on the mobile side to save SMS characters.
 */
function restoreBase64Padding(base64Str: string): string {
  const paddingNeeded = (4 - (base64Str.length % 4)) % 4;
  return base64Str + "=".repeat(paddingNeeded);
}
