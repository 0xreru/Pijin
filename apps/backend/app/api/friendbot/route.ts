import {
  Account,
  Keypair,
  Operation,
  StrKey,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import { NextRequest, NextResponse } from "next/server";
import { createLimiter, enforceLimit, getClientIp } from "@/lib/rate-limit";
import { contractConfig, sorobanRpcServer } from "@/lib/pijin-contract";
import { pollTransactionConfirmation } from "@/lib/stellar-transaction-manager";

export const runtime = "nodejs";

const ipLimit = createLimiter("pijin:api:friendbot:ip", 20, "1 m");
const keyLimit = createLimiter("pijin:api:friendbot:key", 3, "1 h");

const MAX_ATTEMPTS = 10;
const STARTING_BALANCE_XLM = "50.0000000";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Checks whether an error or sendTransaction response indicates a sequence collision (tx_bad_seq).
 */
export function isTxBadSeq(errOrResp: unknown): boolean {
  if (!errOrResp) return false;

  if (errOrResp instanceof Error) {
    if (/tx_bad_seq|txbadseq/i.test(errOrResp.message)) return true;
  }

  if (typeof errOrResp === "string") {
    if (/tx_bad_seq|txbadseq/i.test(errOrResp)) return true;
  }

  if (typeof errOrResp === "object" && errOrResp !== null) {
    const resp = errOrResp as Record<string, unknown>;
    if (resp.status === "ERROR") {
      const errorResult = resp.errorResult;
      if (typeof errorResult === "string" && /tx_bad_seq|txbadseq/i.test(errorResult)) {
        return true;
      }
      if (errorResult && typeof (errorResult as any).toXDR === "function") {
        try {
          const b64 = (errorResult as any).toXDR("base64");
          const decoded = xdr.TransactionResult.fromXDR(b64, "base64");
          if (decoded.result().switch().name === "txBadSeq") {
            return true;
          }
        } catch {}
      }
      const errorResultXdr = resp.errorResultXdr;
      if (typeof errorResultXdr === "string") {
        if (/tx_bad_seq|txbadseq/i.test(errorResultXdr)) return true;
        try {
          const decoded = xdr.TransactionResult.fromXDR(errorResultXdr, "base64");
          if (decoded.result().switch().name === "txBadSeq") {
            return true;
          }
        } catch {}
      }
    }

    if (typeof resp.message === "string" && /tx_bad_seq|txbadseq/i.test(resp.message)) {
      return true;
    }
  }

  return false;
}

/**
 * Checks if the target account has already been created on-chain.
 */
export function isAccountAlreadyExists(errOrResp: unknown): boolean {
  if (!errOrResp) return false;
  const str = String(
    errOrResp instanceof Error ? errOrResp.message : (errOrResp as any)?.message ?? errOrResp
  ).toLowerCase();

  if (str.includes("op_already_exists") || str.includes("createaccountalreadyexists")) {
    return true;
  }

  if (typeof errOrResp === "object" && errOrResp !== null) {
    const resp = errOrResp as Record<string, unknown>;
    const errorResult = resp.errorResult ?? resp.errorResultXdr;
    if (errorResult) {
      try {
        const b64 = typeof errorResult === "string" ? errorResult : (errorResult as any).toXDR("base64");
        const decoded = xdr.TransactionResult.fromXDR(b64, "base64");
        const result = decoded.result();
        if (result.switch().name === "txFailed") {
          const ops = result.results();
          if (
            ops?.some(
              (op) =>
                op.tr().switch().name === "createAccount" &&
                (op.tr().createAccountResult().switch().name as string) === "createAccountAlreadyExist",
            )
          ) {
            return true;
          }
        }
      } catch {}
    }
  }

  return false;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const publicKey = typeof body?.publicKey === "string" ? body.publicKey.trim() : "";

    if (!publicKey) {
      return NextResponse.json({ error: "publicKey is required." }, { status: 400 });
    }

    if (!StrKey.isValidEd25519PublicKey(publicKey)) {
      return NextResponse.json({ error: "Invalid Stellar public key." }, { status: 400 });
    }

    // Rate limits to shield backend resources
    const limited =
      (await enforceLimit(ipLimit, getClientIp(req))) ??
      (await enforceLimit(keyLimit, publicKey));
    if (limited) return limited;

    // Load distributor secret keypair
    const distributorSecret =
      process.env.PHPC_DISTRIBUTOR_SECRET?.trim() ||
      process.env.USDC_DISTRIBUTOR_SECRET?.trim();

    if (!distributorSecret) {
      console.error("[Friendbot API] Server is missing PHPC_DISTRIBUTOR_SECRET / USDC_DISTRIBUTOR_SECRET");
      return NextResponse.json(
        { error: "Server configuration error: distributor key missing." },
        { status: 500 },
      );
    }

    let distributorKeypair: Keypair;
    try {
      distributorKeypair = Keypair.fromSecret(distributorSecret);
    } catch {
      console.error("[Friendbot API] Invalid distributor secret configured.");
      return NextResponse.json(
        { error: "Server configuration error: invalid distributor key." },
        { status: 500 },
      );
    }

    const distributorPublicKey = distributorKeypair.publicKey();
    if (distributorPublicKey === publicKey) {
      return NextResponse.json(
        { error: "Cannot fund distributor account itself." },
        { status: 400 },
      );
    }

    const networkPassphrase =
      contractConfig.networkPassphrase ||
      process.env.STELLAR_NETWORK_PASSPHRASE ||
      "Test SDF Network ; September 2015";

    let lastError: unknown = null;

    // Jittered Retry Loop (up to 10 attempts) to resolve tx_bad_seq concurrency races
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        // 1. Fetch distributor latest sequence number
        let account: Account;
        try {
          account = await sorobanRpcServer.getAccount(distributorPublicKey);
        } catch (accErr: unknown) {
          if (process.env.NODE_ENV === "test") {
            account = new Account(distributorPublicKey, "0");
          } else {
            if (isTxBadSeq(accErr) && attempt < MAX_ATTEMPTS) {
              const jitter = Math.floor(500 + Math.random() * 1000);
              console.warn(
                `[Friendbot API] Sequence race fetching distributor account (attempt ${attempt}/${MAX_ATTEMPTS}). Retrying in ${jitter}ms...`,
              );
              await sleep(jitter);
              continue;
            }
            throw accErr;
          }
        }

        // 2. Build Create Account transaction (50 XLM)
        const tx = new TransactionBuilder(account, {
          fee: "100",
          networkPassphrase,
        })
          .addOperation(
            Operation.createAccount({
              destination: publicKey,
              startingBalance: STARTING_BALANCE_XLM,
            }),
          )
          .setTimeout(30)
          .build();

        // 3. Sign with distributor keypair
        tx.sign(distributorKeypair);

        // 4. Broadcast to network
        const sendResponse = await sorobanRpcServer.sendTransaction(tx);

        if (sendResponse.status === "ERROR") {
          if (isAccountAlreadyExists(sendResponse)) {
            console.info(`[Friendbot API] Account ${publicKey} already exists on-chain.`);
            return NextResponse.json({ success: true, message: "Account already exists." });
          }

          if (isTxBadSeq(sendResponse)) {
            if (attempt < MAX_ATTEMPTS) {
              const jitter = Math.floor(500 + Math.random() * 1000);
              console.warn(
                `[Friendbot API] tx_bad_seq collision on attempt ${attempt}/${MAX_ATTEMPTS}. Retrying in ${jitter}ms...`,
              );
              await sleep(jitter);
              continue;
            }
            throw new Error(`tx_bad_seq: max retry attempts (${MAX_ATTEMPTS}) exceeded`);
          }

          const errDetails = sendResponse.errorResult
            ? typeof sendResponse.errorResult === "string"
              ? sendResponse.errorResult
              : sendResponse.errorResult.toXDR("base64")
            : (sendResponse as any).errorResultXdr ?? "Unknown RPC error";
          throw new Error(`Stellar sendTransaction failed with status ERROR: ${errDetails}`);
        }

        // Await confirmation (bounded) so downstream trustline setup immediately sees the account on-chain
        if (sendResponse.status === "PENDING" && process.env.NODE_ENV !== "test") {
          try {
            await pollTransactionConfirmation(sendResponse.hash, { maxAttempts: 8, intervalMs: 1000 });
          } catch (pollErr) {
            console.warn(`[Friendbot API] Post-broadcast poll ended with warning:`, pollErr);
          }
        }

        return NextResponse.json({ success: true, txHash: sendResponse.hash });
      } catch (err: unknown) {
        lastError = err;

        if (isAccountAlreadyExists(err)) {
          console.info(`[Friendbot API] Account ${publicKey} already exists on-chain.`);
          return NextResponse.json({ success: true, message: "Account already exists." });
        }

        if (isTxBadSeq(err) && attempt < MAX_ATTEMPTS) {
          const jitter = Math.floor(500 + Math.random() * 1000);
          console.warn(
            `[Friendbot API] Caught tx_bad_seq error on attempt ${attempt}/${MAX_ATTEMPTS}. Retrying in ${jitter}ms...`,
          );
          await sleep(jitter);
          continue;
        }

        // Non-sequence collision error or exhausted attempts: throw and exit loop
        throw err;
      }
    }

    throw lastError || new Error(`Friendbot failed after ${MAX_ATTEMPTS} attempts`);
  } catch (error) {
    const rawMsg = error instanceof Error ? error.message : String(error);
    // Sanitize any potential secret key leaks in error messages
    const sanitizedMsg = rawMsg.replace(/S[A-Z2-7]{55}/g, "[REDACTED_SECRET]");
    console.error("[Friendbot API] Error:", sanitizedMsg);
    return NextResponse.json(
      { error: "Friendbot funding failed.", detail: sanitizedMsg },
      { status: 500 },
    );
  }
}
