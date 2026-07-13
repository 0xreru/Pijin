/**
 * @swagger
 * /api/engine/settle:
 *   post:
 *     tags:
 *       - Offline Engine
 *     summary: QStash settlement worker — executes Soroban spend_offline
 *     description: |
 *       **⚠️ Internal endpoint — do not call directly in production.**
 *
 *       Triggered exclusively by **Upstash QStash** after `/api/sms/webhook` enqueues
 *       a job. The handler is wrapped with `verifySignatureAppRouter` which validates
 *       the QStash HMAC signature on every request — any unsigned call is rejected
 *       before business logic executes.
 *
 *       #### Processing pipeline
 *       1. Parse the `smsPayload` (colon-delimited, 6 parts: `tokenId:senderShortId:receiverShortId:amountBase62:nonce:signature`).
 *       2. Create a `PENDING` `Settlement` DB record (unique on `nonce` — duplicate QStash deliveries are silently skipped with `DUPLICATE_SKIPPED`).
 *       3. Hydrate sender/receiver accounts and token config from Prisma in parallel.
 *       4. **Pre-flight local firewall**: Reconstruct the XDR tuple and verify the Ed25519 signature _locally_ before burning gas on a Soroban call.
 *       5. Call `pijinContract.spend_offline(...)` via the Soroban RPC.
 *       6. Sign and submit the assembled transaction with the relayer keypair.
 *       7. Update the DB record to `SETTLED` / `FAILED` and dispatch SMS notifications to both parties.
 *
 *       #### QStash retry behaviour
 *       - Returns **200** for all business-logic failures (bad sig, unknown account, inactive token) — QStash will NOT retry.
 *       - Returns **500** only for infrastructure failures (DB down, RPC unreachable) — QStash WILL retry automatically.
 *
 *       **Required header:** `upstash-signature` (injected by QStash, verified server-side).
 *     security:
 *       - QStashSignature: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [smsPayload]
 *             properties:
 *               smsPayload:
 *                 type: string
 *                 description: Colon-delimited payment payload forwarded from the SMS webhook.
 *                 example: "1:aB3x9Q:Zx7mNk:3v5K:bm9uY2U=:c2ln=="
 *               senderPhone:
 *                 type: string
 *                 description: Sender's phone number for failure SMS notifications.
 *                 example: "+639171234567"
 *     responses:
 *       '200':
 *         description: |
 *           Processing completed (regardless of business outcome). Check `status` field.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   enum: [SETTLED, FAILED, DUPLICATE_SKIPPED]
 *                 txHash:
 *                   type: string
 *                   nullable: true
 *                 amountStroops:
 *                   type: string
 *                   description: Serialised BigInt amount in stroops.
 *                 reason:
 *                   type: string
 *                   description: Failure reason (only present when status is FAILED).
 *       '500':
 *         description: Infrastructure failure (DB or Stellar RPC unavailable). QStash will retry.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
import { NextResponse } from 'next/server';
import { verifySignatureAppRouter } from '@upstash/qstash/nextjs';
import { prisma } from '@/lib/prisma';
import { pijinContract } from '@/lib/pijin-contract';
import { sendSmsNotification } from '@/lib/sms';
import { Horizon, Keypair, Address, xdr, nativeToScVal } from '@stellar/stellar-sdk';

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
// Payload format (v2 - Omni-Vault multi-token):
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
    // Extract tracking ID from broker headers
    const qstashMessageId = req.headers.get('upstash-message-id') ?? 'unknown';

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

    if (parts.length !== 6) {
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

    // Create or resume a PENDING settlement record (idempotency guard).
    // QStash retries must be able to continue after an infra failure that
    // happened after the DB row was created but before the Stellar tx settled.
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

        if (!isDuplicate) {
            console.error('[Settle] DB create failed (infra error):', err);
            return NextResponse.json({ error: 'DB unavailable' }, { status: 500 });
        }

        try {
            const existing = await prisma.settlement.findFirst({
                where: {
                    OR: [
                        { nonce },
                        { qstashMessageId },
                    ],
                },
            });

            if (!existing) {
                console.error('[Settle] Duplicate constraint hit but no existing settlement was found:', err);
                return NextResponse.json({ error: 'DB unavailable' }, { status: 500 });
            }

            if (existing.status === 'SETTLED') {
                console.warn(`[Settle] Duplicate settled delivery skipped | settlementId=${existing.id} | nonce=${nonce} | msgId=${qstashMessageId}`);
                return NextResponse.json({ status: 'DUPLICATE_SKIPPED', txHash: existing.txHash }, { status: 200 });
            }

            const resumed = await prisma.settlement.update({
                where: { id: existing.id },
                data: {
                    status: 'PENDING',
                    failReason: null,
                },
            });

            settlementId = resumed.id;
            console.warn(`[Settle] Resuming existing settlement | settlementId=${settlementId} | previousStatus=${existing.status} | nonce=${nonce} | msgId=${qstashMessageId}`);
        } catch (lookupErr: unknown) {
            console.error('[Settle] DB duplicate lookup failed (infra error):', lookupErr);
            return NextResponse.json({ error: 'DB unavailable' }, { status: 500 });
        }
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
        { stellarPublicKey: string; offlineDeviceKey: string | null; phoneNumber?: string | null } | null,
        { stellarPublicKey: string; offlineDeviceKey: string | null; phoneNumber?: string | null } | null,
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
    const treasuryPublicKey = process.env.TREASURY_PUBLIC_KEY?.trim();

    // Execute Soroban spend_offline
    try {
        // Decode nonce and signature from (padding-stripped) Base64 -> raw Buffers.
        const nonceBuffer = Buffer.from(restoreBase64Padding(nonce), 'base64');
        const signatureBuffer = Buffer.from(restoreBase64Padding(signature), 'base64');

        if (nonceBuffer.length !== 32 || signatureBuffer.length !== 64) {
            const failReason = `Malformed voucher bytes: nonce=${nonceBuffer.length} (expected 32), signature=${signatureBuffer.length} (expected 64)`;
            await prisma.settlement.update({
                where: { id: settlementId },
                data: { status: 'FAILED', failReason },
            });
            return NextResponse.json({ status: 'FAILED', reason: failReason }, { status: 200 });
        }

        const nonce32 = nonceBuffer;

        // TOLL CALCULATION 
        const tollStroops = token.symbol === 'PHPC' ? 5000000n : 0n;
        if (token.symbol === 'PHPC') {
            const issuer = process.env.PHPC_ISSUER_PUBKEY?.trim();
            if (issuer) {
                await assertClassicTrustline(receiverPublicKey, token.symbol, issuer, 'receiver');
                if (tollStroops > 0n && treasuryPublicKey) {
                    await assertClassicTrustline(treasuryPublicKey, token.symbol, issuer, 'treasury');
                }
            }
        }

        // ─── PRE-FLIGHT LOCAL FIREWALL (Anti Gas-Drain) ──────────────────────────
        const amountScVal = nativeToScVal(amountStroops, { type: 'i128' });
        const tollScVal = nativeToScVal(tollStroops, { type: 'i128' }); // Updated to use dynamic toll
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
        
        // 🔥 ARCHITECT FIX: Use the offline device key to verify the signature!
        // We fallback to the stellarPublicKey only for old accounts that haven't migrated.
        const verificationKey = senderAccount.offlineDeviceKey || senderPublicKey;
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
                protocol_toll:  tollStroops,                       // .50 PHPC toll
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
        const failReason = normalizeSettlementFailure(err);

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

async function assertClassicTrustline(
    publicKey: string,
    assetCode: string,
    issuer: string,
    label: string,
): Promise<void> {
    const horizonUrl =
        process.env.STELLAR_HORIZON_URL ??
        (process.env.STELLAR_NETWORK_PASSPHRASE?.includes('Public Global')
            ? 'https://horizon.stellar.org'
            : 'https://horizon-testnet.stellar.org');
    const server = new Horizon.Server(horizonUrl);
    const account = await server.loadAccount(publicKey);
    const hasTrustline = account.balances.some((balance) => {
        if (balance.asset_type === 'native') return false;
        if (balance.asset_type === 'liquidity_pool_shares') return false;
        return balance.asset_code === assetCode && balance.asset_issuer === issuer;
    });

    if (!hasTrustline) {
        throw new Error(`${label} account ${publicKey} is missing ${assetCode}:${issuer} trustline`);
    }
}

function normalizeSettlementFailure(err: unknown): string {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('verify_sig_ed25519') || message.includes('failed ED25519 verification')) {
        return 'Offline device key mismatch: this voucher is valid for the database key, but the vault has a different Ed25519 key registered on-chain. Re-sync it with an authenticated set_offline_key call or make a new deposit using the current device key.';
    }
    const trustlineMatch = message.match(/trustline entry is missing for account["\s,]+(G[A-Z2-7]{55})/);
    if (trustlineMatch?.[1]) {
        return `Missing token trustline for account ${trustlineMatch[1]}. Create a PHPC trustline before retrying settlement.`;
    }
    return message;
}

// ---------------------------------------------------------------------------
// Export - wrapped with QStash signature verification
// ---------------------------------------------------------------------------
export const POST = verifySignatureAppRouter(handler);
