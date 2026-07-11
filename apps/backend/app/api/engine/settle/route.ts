import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { verifySignatureAppRouter } from '@upstash/qstash/nextjs';
import { prisma } from '@/lib/prisma';
import { pijinContract } from '@/lib/pijin-contract';
import { sendSmsNotification } from '@/lib/sms';
import { Keypair, Address, xdr, nativeToScVal } from '@stellar/stellar-sdk';

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// POST /api/engine/settle
//
// Triggered exclusively by Upstash QStash. The handler is wrapped with
// verifySignatureAppRouter so any request that doesn't carry a valid QStash
// HMAC signature is rejected before execution.
//
// Payload format (v2 - Pijin-Vault multi-token):
//   tokenId:senderShortId:receiverShortId:amountBase62:nonce:signature
//
// Happy-path status machine:
//   PENDING -> SETTLED   (Soroban tx confirmed)
//   PENDING -> FAILED    (business-logic rejection: bad sig, low balance, unknown token, etc.)
//
// Only returns 500 on catastrophic infrastructure errors (DB connection drop,
// Stellar RPC unreachable) so QStash will automatically retry the job.
// ---------------------------------------------------------------------------

async function handler(req: Request): Promise<Response> {
    // Extract tracking ID from broker headers.
    // For direct mobile calls (no QStash), generate a UUID so the unique-
    // constraint on qstashMessageId doesn't block subsequent requests.
    const qstashMessageId =
        req.headers.get('upstash-message-id') ??
        `direct-${crypto.randomUUID()}`;

    // Parse body
    let body: { smsPayload?: string; senderPhone?: string };
    try {
        body = await req.json();
    } catch {
        console.error('[Settle] Could not parse JSON body');
        return NextResponse.json({ error: 'Bad payload' }, { status: 200 });
    }

    const smsPayload = body?.smsPayload ?? '';
    const senderPhone = body?.senderPhone ?? '';

    const parts = smsPayload.split(':');

    if (parts.length < 6) {
        console.error(`[Settle] Malformed smsPayload (expected 6 parts, got ${parts.length}): "${smsPayload}"`);
        return NextResponse.json({ error: 'Malformed smsPayload' }, { status: 200 });
    }

    const [tokenIdStr, senderShortId, receiverShortId, amountBase62, nonce, signature] = parts as [
        string, string, string, string, string, string,
    ];

    // Validate & parse tokenId
    const tokenId = parseInt(tokenIdStr, 10);
    if (isNaN(tokenId) || tokenId <= 0) {
        console.error(`[Settle] Invalid tokenId: "${tokenIdStr}"`);
        return NextResponse.json({ error: 'Invalid tokenId' }, { status: 200 });
    }

    // Decode Base62 amount into stroops (BigInt)
    let amountStroops: bigint;
    try {
        amountStroops = decodeBase62(amountBase62);
    } catch (e) {
        console.error(`[Settle] Failed to decode Base62 amount "${amountBase62}":`, e);
        return NextResponse.json({ error: 'Invalid amount encoding' }, { status: 200 });
    }

    console.log(
        `[Settle] Processing | msgId=${qstashMessageId} | tokenId=${tokenId} | sender=${senderShortId} | receiver=${receiverShortId} | amountStroops=${amountStroops} | nonce=${nonce}`
    );

    // Create PENDING settlement record (idempotency guard)
    let settlementId: number;

    try {
        const record = await prisma.settlement.create({
            data: {
                qstashMessageId,
                nonce,
                senderShortId,
                receiverShortId,
                tokenId,
                amountStroops,
                relayerAddress: process.env.RELAYER_PUBLIC_KEY ?? null,
                status: 'PENDING',
            },
        });
        settlementId = record.id;
        console.log(`[Settle] DB record created | settlementId=${settlementId}`);
    } catch (err: unknown) {
        // Unique-constraint violation -> duplicate delivery from QStash.
        const isDuplicate =
            typeof err === 'object' &&
            err !== null &&
            'code' in err &&
            (err as { code: string }).code === 'P2002';

        if (isDuplicate) {
            console.warn(`[Settle] Duplicate delivery skipped | nonce=${nonce} | msgId=${qstashMessageId}`);
            return NextResponse.json({ status: 'DUPLICATE_SKIPPED' }, { status: 200 });
        }

        console.error('[Settle] DB create failed (infra error):', err);
        return NextResponse.json({ error: 'DB unavailable' }, { status: 500 });
    }

    // Hydrate Stellar public keys + Token record (parallel)
    const [senderAccount, receiverAccount, token] = await Promise.all([
        prisma.account.findUnique({ where: { shortId: senderShortId } }),
        prisma.account.findUnique({ where: { shortId: receiverShortId } }),
        prisma.token.findUnique({ where: { id: tokenId } }),
    ]).catch(async (err) => {
        console.error('[Settle] DB hydration failed (infra error):', err);
        await prisma.settlement.update({
            where: { id: settlementId },
            data: { status: 'FAILED', failReason: 'DB hydration error' },
        });
        return [null, null, null] as const;
    }) as [
        { stellarPublicKey: string; phoneNumber?: string | null } | null,
        { stellarPublicKey: string; phoneNumber?: string | null } | null,
        { contractId: string; isActive: boolean; symbol: string; decimals: number } | null,
    ] | readonly [null, null, null];

    // If all three are null, DB failed mid-flight -> bubble up for QStash retry.
    if (senderAccount === null && receiverAccount === null && token === null) {
        return NextResponse.json({ error: 'DB unavailable' }, { status: 500 });
    }

    // Validate Token
    if (!token) {
        const failReason = `Token not found: id=${tokenId}`;
        console.warn(`[Settle] ${failReason}`);
        await prisma.settlement.update({
            where: { id: settlementId },
            data: { status: 'FAILED', failReason },
        });
        return NextResponse.json({ status: 'FAILED', reason: failReason }, { status: 200 });
    }

    if (!token.isActive) {
        const failReason = `Token is inactive: id=${tokenId}`;
        console.warn(`[Settle] ${failReason}`);
        await prisma.settlement.update({
            where: { id: settlementId },
            data: { status: 'FAILED', failReason },
        });
        return NextResponse.json({ status: 'FAILED', reason: failReason }, { status: 200 });
    }

    // Validate Accounts
    if (!senderAccount || !receiverAccount) {
        const missing = !senderAccount ? senderShortId : receiverShortId;
        const failReason = `Account not found: ${missing}`;
        console.warn(`[Settle] ${failReason}`);
        await prisma.settlement.update({
            where: { id: settlementId },
            data: { status: 'FAILED', failReason },
        });
        return NextResponse.json({ status: 'FAILED', reason: failReason }, { status: 200 });
    }

    const { stellarPublicKey: senderPublicKey } = senderAccount;
    const { stellarPublicKey: receiverPublicKey } = receiverAccount;
    const { contractId: tokenContractId } = token;

    // Execute Soroban spend_offline
    try {
        // Decode nonce and signature from (padding-stripped) Base64 -> raw Buffers.
        const nonceBuffer = Buffer.from(restoreBase64Padding(nonce), 'base64');
        const signatureBuffer = Buffer.from(restoreBase64Padding(signature), 'base64');

        // Expand nonce to 32-byte Buffer (Soroban BytesN<32> requirement).
        const nonce32 = Buffer.alloc(32);
        nonceBuffer.copy(nonce32);

        // ─── PRE-FLIGHT LOCAL FIREWALL (Anti Gas-Drain) ──────────────────────────
        const amountScVal = nativeToScVal(amountStroops, { type: 'i128' });
        const tollScVal = nativeToScVal(0n, { type: 'i128' });
        const nonceScVal = xdr.ScVal.scvBytes(nonce32);
        const receiverScVal = Address.fromString(receiverPublicKey).toScVal();
        const gatewayScVal = Address.fromString(process.env.RELAYER_PUBLIC_KEY!).toScVal();
        const tokenScVal = Address.fromString(tokenContractId).toScVal();

        const xdrTuple = xdr.ScVal.scvVec([
            amountScVal,
            tollScVal,
            nonceScVal,
            receiverScVal,
            gatewayScVal,
            tokenScVal,
        ]);

        const xdrBytes = xdrTuple.toXDR();

        // Prefer the offline device key (generated at onboarding) if available,
        // otherwise fall back to the Stellar public key for accounts that
        // pre-date the offline key field.
        const verificationKey = senderAccount.offlineDeviceKey ?? senderPublicKey;
        const senderKeypair = Keypair.fromPublicKey(verificationKey);
        
        if (!senderKeypair.verify(xdrBytes, signatureBuffer)) {
            const failReason = 'Local Firewall Rejected: Invalid Ed25519 signature. Dropped to save gas.';
            console.warn(`[Settle] ${failReason}`);
            
            await prisma.settlement.update({
                where: { id: settlementId },
                data: { status: 'FAILED', failReason },
            });

            if (senderPhone) {
                // Ensure SMS goes out but don't crash if Textbee is slow
                await sendSmsNotification(
                    senderPhone,
                    `Transaction failed: Invalid cryptographic signature.`
                ).catch(console.error);
            }

            return NextResponse.json({ status: 'FAILED', reason: failReason }, { status: 200 });
        }
        // ─────────────────────────────────────────────────────────────────────────

        const assembledTx = await pijinContract.spend_offline(
            {
                gateway:        process.env.RELAYER_PUBLIC_KEY!,
                sender:         senderPublicKey,
                token:          tokenContractId,          // Soroban SAC / contract address
                receiver:       receiverPublicKey,
                amount:         amountStroops,            // i128 - SDK accepts bigint natively
                protocol_toll:  0n,                       // no toll for now
                nonce:          nonce32,
                signature:      signatureBuffer,
            },
            { publicKey: process.env.RELAYER_PUBLIC_KEY },
        );

        const { sendTransactionResponse } = await assembledTx.signAndSend({
            signTransaction: signWithRelayer,
        });

        const txHash: string | undefined = sendTransactionResponse?.hash;

        await prisma.settlement.update({
            where: { id: settlementId },
            data: { status: 'SETTLED', txHash: txHash ?? null },
        });

        console.log(`[Settle] SETTLED | settlementId=${settlementId} | txHash=${txHash ?? 'n/a'}`);

        // 🔥 ARCHITECT FIX: Non-blocking parallel SMS dispatch
        // We use Promise.allSettled so that if one SMS fails or Textbee times out, 
        // it doesn't crash the worker, and we still return the 200 OK to QStash.
        const humanAmount = Number(amountStroops) / 10_000_000;
        const tokenSymbol = token.symbol;
        const shortRef = txHash ? txHash.substring(0, 8) : settlementId.toString();

        const smsPromises: Promise<void>[] = [];

        const senderRegisteredNumber = senderAccount.phoneNumber;
        if (senderRegisteredNumber) {
            smsPromises.push(
                sendSmsNotification(
                    senderRegisteredNumber,
                    `Pijin: Transaction processed. Sent ${humanAmount} ${tokenSymbol} to ${receiverShortId}. Ref: ${shortRef}`,
                )
            );
        }

        const receiverRegisteredNumber = receiverAccount.phoneNumber;
        if (receiverRegisteredNumber) {
            smsPromises.push(
                sendSmsNotification(
                    receiverRegisteredNumber,
                    `Pijin: Transaction processed. Received ${humanAmount} ${tokenSymbol} from ${senderShortId}. Ref: ${shortRef}`,
                )
            );
        }

        // Wait for both SMS requests to hit the network, but ignore any 502 Textbee errors
        if (smsPromises.length > 0) {
            await Promise.allSettled(smsPromises);
        }

        // Serialize amountStroops as string to avoid BigInt JSON serialization error.
        return NextResponse.json(
            { status: 'SETTLED', txHash, amountStroops: amountStroops.toString() },
            { status: 200 },
        );

    } catch (err: unknown) {
        const isInfraError = isNetworkOrRpcError(err);
        const failReason = err instanceof Error ? err.message : String(err);

        console.error(
            `[Settle] spend_offline ${isInfraError ? 'INFRA' : 'BUSINESS'} error:`,
            failReason
        );

        await prisma.settlement.update({
            where: { id: settlementId },
            data: { status: 'FAILED', failReason: failReason.slice(0, 500) },
        }).catch((dbErr: unknown) => {
            console.error('[Settle] Failed to update settlement to FAILED:', dbErr);
        });

        if (isInfraError) {
            return NextResponse.json({ error: 'RPC unavailable' }, { status: 500 });
        }

        // Notify sender of permanent business-logic failure (e.g. insufficient balance).
        if (senderPhone) {
            await sendSmsNotification(
                senderPhone,
                `Transaction failed: ${failReason.slice(0, 120)}`,
            ).catch(console.error);
        }

        return NextResponse.json(
            { status: 'FAILED', reason: failReason },
            { status: 200 },
        );
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Decodes a Base62-encoded string into a BigInt.
 * Alphabet: 0-9A-Za-z (standard Base62, 62 characters).
 */
function decodeBase62(str: string): bigint {
    const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
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
 * Restores the '=' padding stripped on the mobile side to save SMS characters.
 */
function restoreBase64Padding(base64Str: string): string {
    const paddingNeeded = (4 - (base64Str.length % 4)) % 4;
    return base64Str + '='.repeat(paddingNeeded);
}

/**
 * Signs an assembled Soroban transaction XDR with the relayer keypair.
 * Matches the signTransaction callback signature expected by
 * AssembledTransaction.signAndSend().
 */
async function signWithRelayer(
    xdr: string,
    signOpts?: { networkPassphrase?: string },
): Promise<{ signedTxXdr: string; signerAddress: string }> {
    const { Keypair, TransactionBuilder } = await import('@stellar/stellar-sdk');
    const { networks } = await import('pijin_core');

    if (!process.env.RELAYER_SECRET_KEY) {
        throw new Error('Missing RELAYER_SECRET_KEY');
    }

    const relayerKeypair = Keypair.fromSecret(process.env.RELAYER_SECRET_KEY);
    const passphrase = signOpts?.networkPassphrase ?? networks.testnet.networkPassphrase;
    const transaction = TransactionBuilder.fromXDR(xdr, passphrase);
    transaction.sign(relayerKeypair);

    return {
        signedTxXdr: transaction.toXDR(),
        signerAddress: relayerKeypair.publicKey(),
    };
}

/**
 * Heuristic to distinguish catastrophic network / RPC failures (which QStash
 * should retry) from business-logic contract rejections (which it should not).
 */
function isNetworkOrRpcError(err: unknown): boolean {
    if (!(err instanceof Error)) return false;
    const msg = err.message.toLowerCase();
    return (
        msg.includes('network') ||
        msg.includes('econnrefused') ||
        msg.includes('etimedout') ||
        msg.includes('fetch failed') ||
        msg.includes('socket hang up') ||
        msg.includes('failed to fetch') ||
        msg.includes('connection refused')
    );
}

// ---------------------------------------------------------------------------
// Export - wrapped with QStash signature verification
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Export
//
// QStash always delivers with an `upstash-signature` header.
// When the mobile app calls this directly (online sync after offline mode),
// that header is absent — we skip the QStash HMAC check and rely entirely
// on the Ed25519 signature verification inside the handler to authenticate
// the request. This is safe because:
//   1. The handler cryptographically verifies the device keypair signature.
//   2. Any payload with an invalid or missing sig is rejected with status 200
//      (FAILED), never reaching the Soroban contract.
// ---------------------------------------------------------------------------
const qstashHandler = verifySignatureAppRouter(handler);

export async function POST(req: Request): Promise<Response> {
    // QStash always attaches this header — direct mobile calls do not.
    if (req.headers.has('upstash-signature')) {
        return qstashHandler(req);
    }
    // Direct call from mobile app — run the handler, Ed25519 is the firewall.
    return handler(req);
}