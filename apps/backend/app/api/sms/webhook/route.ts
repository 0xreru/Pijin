import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Client, networks, rpc, Keypair, TransactionBuilder } from '@/abotpera-sdk/src';
import { expandNonce, verifySignatureLocally } from '@/lib/crypto';
import { sendSmsReceipt } from '@/lib/textbee';
 
// Webhook config to allow Textbee POST requests
export const runtime = 'nodejs';
 
const sorobanRpcUrl = process.env.SOROBAN_RPC_URL ?? 'https://rpc.lightsail.network';
const contractId = process.env.CONTRACT_ID ?? networks.unknown.contractId;
const expiryBufferLedgers = Number.parseInt(process.env.OFFLINE_EXPIRY_LEDGERS ?? '300', 10);
const webhookSecret = process.env.WEBHOOK_SECRET;
 
const abotPeraContract = new Client({
    ...networks.unknown, // <-- CHANGED TO UNKNOWN
    rpcUrl: sorobanRpcUrl,
    contractId,
});
 
const rpcServer = new rpc.Server(sorobanRpcUrl, {
    allowHttp: sorobanRpcUrl.startsWith('http://'),
});
 
async function getExpiryLedger(): Promise<number> {
    const latestLedger = await rpcServer.getLatestLedger();
    return latestLedger.sequence + expiryBufferLedgers;
}
 
async function signWithRelayer(
    xdr: string,
    signOpts?: { networkPassphrase?: string }
): Promise<{ signedTxXdr: string; signerAddress: string }> {
    if (!process.env.RELAYER_SECRET_KEY) {
        throw new Error('Missing RELAYER_SECRET_KEY');
    }
 
    const relayerKeypair = Keypair.fromSecret(process.env.RELAYER_SECRET_KEY);
    // <-- CHANGED TO PUBLIC PASSPHRASE
    const passphrase = signOpts?.networkPassphrase ?? networks.unknown.networkPassphrase;
    const transaction = TransactionBuilder.fromXDR(xdr, passphrase);
    transaction.sign(relayerKeypair);
    return {
        signedTxXdr: transaction.toXDR(),
        signerAddress: relayerKeypair.publicKey(),
    };
}

function normalizePhone(value?: string | null): string | null {
    if (!value) return null;
    return value.replace(/[^\d+]/g, '');
}

function extractAuthSecret(req: Request): string | null {
    const authHeader = req.headers.get('authorization');
    if (authHeader) {
        const bearerPrefix = 'Bearer ';
        if (authHeader.startsWith(bearerPrefix)) {
            return authHeader.slice(bearerPrefix.length).trim();
        }
        return authHeader.trim();
    }

    const url = new URL(req.url);
    return url.searchParams.get('secret');
}
 
export async function POST(req: Request) {
    try {
        if (!webhookSecret) {
            console.error('Missing WEBHOOK_SECRET');
            return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
        }

        const incomingSecret = extractAuthSecret(req);
        if (!incomingSecret || incomingSecret !== webhookSecret) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        let body: unknown;
        try {
            body = await req.json();
        } catch {
            return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
        }

        if (!body || typeof body !== 'object') {
            return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
        }

        const parsed = body as { text?: unknown; message?: unknown; sender?: unknown };
        const rawSmsContent = typeof parsed.text === 'string' ? parsed.text : parsed.message;
        const smsContent = typeof rawSmsContent === 'string' ? rawSmsContent.trim() : '';
        const sender = typeof parsed.sender === 'string' ? parsed.sender.trim() : '';

        if (!smsContent) {
            return NextResponse.json({ error: 'Missing text/message field' }, { status: 400 });
        }
 
        console.log(`Incoming AbotPera Payload: ${smsContent}`);
        console.log(`[SMS Webhook] sender=${sender || 'unknown'}`);
 
        // Unpack the compressed Web2 SMS String
        const [custId, merchId, amountStr, nonceB64, sigB64] = smsContent.split(':');

        if (!custId || !merchId || !amountStr || !nonceB64 || !sigB64) {
            return NextResponse.json({ error: "Malformed Payload" }, { status: 400 });
        }
 
        // Query Prisma Database for the real 56-character Stellar Addresses
        const customerAccount = await prisma.account.findUnique({ where: { shortId: custId }});
        const merchantAccount = await prisma.account.findUnique({ where: { shortId: merchId }});
 
        if (!customerAccount || !merchantAccount) {
            console.error("Account Lookup Failed");
            return NextResponse.json({ error: "Account Not Found" }, { status: 404 });
        }

        // Optional sender safeguard: if merchant phone exists, sender must match.
        const normalizedSender = normalizePhone(sender);
        const normalizedMerchantPhone = normalizePhone(merchantAccount.merchantPhone);
        if (normalizedMerchantPhone && normalizedSender && normalizedMerchantPhone !== normalizedSender) {
            console.error(`[SMS Webhook] Sender mismatch for merchant ${merchantAccount.shortId}`);
            return NextResponse.json({ error: "Unauthorized sender" }, { status: 403 });
        }
 
        // Expand the Nonce back to 32 bytes
        const fullNonce32 = expandNonce(nonceB64);
 
        // Reconstruct the EXACT string Mark signed offline
        // string format: MerchantShortID:Amount:NonceHex
        const expectedSignedData = `${merchId}:${amountStr}:${fullNonce32.toString('hex')}`;
 
        //  Verify the Signature Math Locally (Don't Trust, Verify!)
        // Customer signs SMS payload with offline device key (if enrolled).
        // Fallback to stellarPublicKey for legacy accounts.
        const verificationPublicKey =
            customerAccount.offlineDeviceKey?.trim() || customerAccount.stellarPublicKey;

        const isValid = verifySignatureLocally(
            verificationPublicKey,
            expectedSignedData,
            sigB64
        );
 
        if (!isValid) {
            console.error("Invalid Signature!");
            return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
        }
 
        console.log("Cryptography verified locally. Submitting to Soroban...");
 
        // Convert XLM decimal string to stroops.
        const amountStroops = BigInt(Math.round(parseFloat(amountStr) * 10_000_000));
 
        // 7. Invoke the Smart Contract
        // NOTE: Make sure RELAYER_PUBLIC_KEY and RELAYER_SECRET_KEY are set in your .env
        if (!process.env.RELAYER_PUBLIC_KEY || !process.env.RELAYER_SECRET_KEY) {
            console.error("Missing relayer env vars");
            return NextResponse.json({ error: "Relayer not configured" }, { status: 500 });
        }
 
        const tx = await abotPeraContract.spend_offline(
            {
                gateway: process.env.RELAYER_PUBLIC_KEY!,
                customer: customerAccount.stellarPublicKey,
                merchant: merchantAccount.stellarPublicKey,
                token: process.env.TOKEN_ID!,
                amount: amountStroops,
                nonce: fullNonce32,
                expiry_ledger: await getExpiryLedger(),
            },
            {
                publicKey: process.env.RELAYER_PUBLIC_KEY!,
            }
        );
 
        console.log("⏳ Submitting to Stellar Network...");
 
        // Unpack both the immediate response AND the long-polling result promise
        const { result, sendTransactionResponse } = await tx.signAndSend({
            signTransaction: signWithRelayer,
        });
 
        console.log(`🔗 Transaction Hash: ${sendTransactionResponse?.hash}`);
 
        // CRITICAL: WAIT FOR THE BLOCKCHAIN CONFIRMATION (Takes 3-5 seconds)
        try {
            // If the transaction succeeds, it resolves to the Rust function's return value.
            // Since spend_offline returns void, this safely resolves to null.
            await result; 
        } catch (chainError) {
            // If the transaction REVERTS on-chain, the SDK throws an error here!
            console.error("🚨 BLOCKCHAIN REJECTED THE TRANSACTION:", chainError);
            return NextResponse.json({ 
                error: "Transaction reverted on-chain. Check Nonce or Vault Balance." 
            }, { status: 400 });
        }
 
        console.log("✅ Block Mined! Funds safely transferred.");
 
        try {
            await prisma.settlement.create({
                data: {
                    customerShortId: custId,
                    merchantShortId: merchId,
                    amountXlm: amountStr,
                    txHash: sendTransactionResponse?.hash ?? null,
                    status: "SETTLED",
                },
            });
        } catch (dbError) {
            console.error("Settlement DB write failed after on-chain success:", dbError);
        }

        // 8. Trigger SMS confirmation.
        // Prefer sender number (current session caller) so confirmation goes back
        // to active user/device. Fallback to merchant profile phone.
        const receiptMsg = `SUCCESS: ${amountStr} XLM Paid. PIN:${merchantAccount.merchantPin || "0000"}`;

        const receiptPhone = normalizePhone(sender) || normalizePhone(merchantAccount.merchantPhone);
        if (receiptPhone) {
            void sendSmsReceipt(receiptPhone, receiptMsg).then((result) => {
                if (!result.success) {
                    console.error(`[Textbee] Async SMS receipt failed: ${result.error}`);
                }
            });
        }
 
        return NextResponse.json({ success: true, message: "Settlement Complete" });
 
    } catch (error) {
        console.error("Webhook Execution Error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
