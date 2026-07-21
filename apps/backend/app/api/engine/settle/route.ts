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
 *                 traceId:
 *                   type: string
 *                   description: Correlates this worker run with the originating SMS webhook logs.
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
import { contractConfig, pijinContract } from '@/lib/pijin-contract';
import { sendSmsNotification } from '@/lib/sms';
import { Horizon } from '@stellar/stellar-sdk';
import {
    buildOfflineSignatureXdr,
    parseOfflineVoucher,
    verifyOfflineVoucherSignature,
} from '@/lib/offline-voucher';
import {
    createOfflineTransactionTraceId,
    logOfflineTransactionDebug,
    logOfflineVoucherDecompression,
    sanitizeOfflineDebugHeaders,
    sanitizeOfflineDebugUrl,
} from '@/lib/offline-transaction-debug';

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
    const fallbackTraceId = qstashMessageId !== 'unknown'
        ? `qstash-${qstashMessageId}`
        : createOfflineTransactionTraceId();

    // Parse body
    let rawBody = '';
    let body: { smsPayload?: string; senderPhone?: string; traceId?: string };
    try {
        rawBody = await req.text();
        const parsedBody: unknown = JSON.parse(rawBody);
        if (!parsedBody || typeof parsedBody !== 'object' || Array.isArray(parsedBody)) {
            throw new TypeError('Settlement body must be a JSON object');
        }
        body = parsedBody as { smsPayload?: string; senderPhone?: string; traceId?: string };
    } catch {
        console.error(`[Settle] Could not parse JSON body | traceId=${fallbackTraceId}`);
        logOfflineTransactionDebug(fallbackTraceId, 'settle:rejected', {
            reason: 'Could not parse JSON body',
            rawBody,
        });
        return NextResponse.json({ error: 'Bad payload', traceId: fallbackTraceId }, { status: 200 });
    }

    const traceId = typeof body.traceId === 'string' && body.traceId.trim()
        ? body.traceId.trim()
        : fallbackTraceId;
    const smsPayload = body?.smsPayload ?? '';
    const senderPhone = body?.senderPhone ?? '';

    logOfflineTransactionDebug(traceId, 'settle:received', {
        url: sanitizeOfflineDebugUrl(req.url),
        method: req.method,
        headers: sanitizeOfflineDebugHeaders(req.headers),
        qstashMessageId,
        rawBody,
        rawBodyLength: rawBody.length,
        smsPayload,
        senderPhone,
    });

    let voucher;
    try {
        voucher = parseOfflineVoucher(smsPayload);
    } catch (error) {
        const reason = error instanceof Error ? error.message : 'Malformed SMS payload';
        console.error(`[Settle] ${reason}: "${smsPayload}"`);
        logOfflineTransactionDebug(traceId, 'decompress:rejected', {
            smsPayload,
            reason,
        });
        return NextResponse.json({ error: reason, traceId }, { status: 200 });
    }

    logOfflineVoucherDecompression(traceId, smsPayload, voucher);

    const {
        tokenId,
        senderShortId,
        receiverShortId,
        amountStroops,
        nonceB64: nonce,
        nonce: nonce32,
        signature: signatureBuffer,
    } = voucher;

    console.log(
        `[Settle] Processing | traceId=${traceId} | msgId=${qstashMessageId} | tokenId=${tokenId} | sender=${senderShortId} | receiver=${receiverShortId} | amountStroops=${amountStroops} | nonce=${nonce}`
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
        logOfflineTransactionDebug(traceId, 'db:pending-created', {
            settlement: {
                id: record.id,
                qstashMessageId: record.qstashMessageId,
                nonce: record.nonce,
                senderShortId: record.senderShortId,
                receiverShortId: record.receiverShortId,
                tokenId: record.tokenId,
                amountStroops: record.amountStroops,
                relayerAddress: record.relayerAddress,
                txHash: record.txHash,
                status: record.status,
                failReason: record.failReason,
                createdAt: record.createdAt,
            },
        });
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
                logOfflineTransactionDebug(traceId, 'db:duplicate-skipped', {
                    settlementId: existing.id,
                    previousStatus: existing.status,
                    txHash: existing.txHash,
                    nonce,
                    qstashMessageId,
                });
                console.warn(`[Settle] Duplicate settled delivery skipped | settlementId=${existing.id} | nonce=${nonce} | msgId=${qstashMessageId}`);
                return NextResponse.json({ status: 'DUPLICATE_SKIPPED', txHash: existing.txHash, traceId }, { status: 200 });
            }

            const resumed = await prisma.settlement.update({
                where: { id: existing.id },
                data: {
                    status: 'PENDING',
                    failReason: null,
                },
            });

            settlementId = resumed.id;
            logOfflineTransactionDebug(traceId, 'db:pending-resumed', {
                settlementId,
                previousStatus: existing.status,
                currentStatus: resumed.status,
                nonce,
                qstashMessageId,
            });
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

    logOfflineTransactionDebug(traceId, 'db:hydrated', {
        settlementId,
        senderAccount: senderAccount && {
            shortId: senderShortId,
            stellarPublicKey: senderAccount.stellarPublicKey,
            offlineDeviceKey: senderAccount.offlineDeviceKey,
            phoneNumberPresent: Boolean(senderAccount.phoneNumber),
        },
        receiverAccount: receiverAccount && {
            shortId: receiverShortId,
            stellarPublicKey: receiverAccount.stellarPublicKey,
            offlineDeviceKey: receiverAccount.offlineDeviceKey,
            phoneNumberPresent: Boolean(receiverAccount.phoneNumber),
        },
        token: token && {
            id: tokenId,
            symbol: token.symbol,
            contractId: token.contractId,
            decimals: token.decimals,
            isActive: token.isActive,
        },
    });

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
        logOfflineTransactionDebug(traceId, 'db:failed', { settlementId, status: 'FAILED', failReason });
        return NextResponse.json({ status: 'FAILED', reason: failReason, traceId }, { status: 200 });
    }

    if (!token.isActive) {
        const failReason = `Token is inactive: id=${tokenId}`;
        console.warn(`[Settle] ${failReason}`);
        await prisma.settlement.update({
            where: { id: settlementId },
            data: { status: 'FAILED', failReason },
        });
        logOfflineTransactionDebug(traceId, 'db:failed', { settlementId, status: 'FAILED', failReason });
        return NextResponse.json({ status: 'FAILED', reason: failReason, traceId }, { status: 200 });
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
        logOfflineTransactionDebug(traceId, 'db:failed', { settlementId, status: 'FAILED', failReason });
        return NextResponse.json({ status: 'FAILED', reason: failReason, traceId }, { status: 200 });
    }

    const { stellarPublicKey: senderPublicKey } = senderAccount;
    const { contractId: tokenContractId } = token;
    const treasuryPublicKey = process.env.TREASURY_PUBLIC_KEY?.trim();

    // Execute Soroban spend_offline
    try {
        const gatewayPublicKey = process.env.RELAYER_PUBLIC_KEY?.trim();
        if (!gatewayPublicKey) throw new Error('Server is missing RELAYER_PUBLIC_KEY');

        // TOLL CALCULATION 
        const tollStroops = token.symbol === 'PHPC' ? 5000000n : 0n;
        if (token.symbol === 'PHPC') {
            const issuer = process.env.PHPC_ISSUER_PUBKEY?.trim();
            if (issuer) {
                if (tollStroops > 0n && treasuryPublicKey) {
                    await assertClassicTrustline(treasuryPublicKey, token.symbol, issuer, 'treasury');
                }
            }
        }

        // ─── PRE-FLIGHT LOCAL FIREWALL (Anti Gas-Drain) ──────────────────────────
        const xdrBytes = buildOfflineSignatureXdr({
            amountStroops,
            tollStroops,
            nonce: nonce32,
            receiverShortId,
            gatewayPublicKey,
            tokenContractId,
        });

        logOfflineTransactionDebug(traceId, 'verify:xdr-reconstructed', {
            settlementId,
            tupleOrder: [
                'amountStroops',
                'tollStroops',
                'nonce',
                'receiverShortId',
                'gatewayPublicKey',
                'tokenContractId',
            ],
            tuple: {
                amountStroops,
                tollStroops,
                nonceB64: nonce,
                nonceHex: nonce32.toString('hex'),
                nonceByteLength: nonce32.length,
                receiverShortId,
                gatewayPublicKey,
                tokenContractId,
            },
            signatureXdrByteLength: xdrBytes.length,
            signatureXdrBase64: xdrBytes.toString('base64'),
            signatureXdrHex: xdrBytes.toString('hex'),
        });
        
        // The main wallet and offline device are intentionally separate keys.
        // Falling back to the wallet key hides incomplete device enrollment.
        const verificationKey = senderAccount.offlineDeviceKey;
        if (!verificationKey) {
            const failReason = 'Offline device key is not enrolled. Sign in online to synchronize this device.';
            await prisma.settlement.update({
                where: { id: settlementId },
                data: { status: 'FAILED', failReason },
            });
            logOfflineTransactionDebug(traceId, 'db:failed', { settlementId, status: 'FAILED', failReason });
            return NextResponse.json({ status: 'FAILED', reason: failReason, traceId }, { status: 200 });
        }
        const signatureValid = verifyOfflineVoucherSignature(verificationKey, xdrBytes, signatureBuffer);
        logOfflineTransactionDebug(traceId, 'verify:ed25519', {
            settlementId,
            offlineDevicePublicKey: verificationKey,
            signatureB64: voucher.signatureB64,
            signatureHex: signatureBuffer.toString('hex'),
            signatureByteLength: signatureBuffer.length,
            signedXdrByteLength: xdrBytes.length,
            valid: signatureValid,
        });

        if (!signatureValid) {
            const failReason = 'Local Firewall Rejected: Invalid Ed25519 signature. Dropped to save gas.';
            console.warn(`[Settle] ${failReason}`);
            
            await prisma.settlement.update({
                where: { id: settlementId },
                data: { status: 'FAILED', failReason },
            });
            logOfflineTransactionDebug(traceId, 'db:failed', { settlementId, status: 'FAILED', failReason });

            if (senderPhone) {
                // Ensure SMS goes out but don't crash if Textbee is slow
                await sendSmsNotification(
                    senderPhone,
                    `Transaction failed: Invalid cryptographic signature.`
                ).catch(console.error);
            }

            return NextResponse.json({ status: 'FAILED', reason: failReason, traceId }, { status: 200 });
        }
        // ─────────────────────────────────────────────────────────────────────────

        const receiverShortIdBytes = Buffer.from(receiverShortId, 'ascii');
        const contractArguments = {
            gateway: gatewayPublicKey,
            sender: senderPublicKey,
            token: tokenContractId,
            receiver_short_id: receiverShortIdBytes,
            amount: amountStroops,
            protocol_toll: tollStroops,
            nonce: nonce32,
            signature: signatureBuffer,
        };

        logOfflineTransactionDebug(traceId, 'soroban:contract-payload', {
            settlementId,
            rpcUrl: contractConfig.rpcUrl,
            networkPassphrase: contractConfig.networkPassphrase,
            contractId: contractConfig.contractId,
            method: 'spend_offline',
            invokerPublicKey: gatewayPublicKey,
            arguments: {
                gateway: contractArguments.gateway,
                sender: contractArguments.sender,
                token: contractArguments.token,
                receiver_short_id_ascii: receiverShortId,
                receiver_short_id_hex: receiverShortIdBytes.toString('hex'),
                receiver_short_id_byteLength: receiverShortIdBytes.length,
                amount: contractArguments.amount,
                protocol_toll: contractArguments.protocol_toll,
                nonceB64: nonce32.toString('base64'),
                nonceHex: nonce32.toString('hex'),
                nonceByteLength: nonce32.length,
                signatureB64: signatureBuffer.toString('base64'),
                signatureHex: signatureBuffer.toString('hex'),
                signatureByteLength: signatureBuffer.length,
            },
        });

        const assembledTx = await pijinContract.spend_offline(
            contractArguments,
            { publicKey: gatewayPublicKey },
        );

        let assembledTransactionJson: unknown;
        try {
            assembledTransactionJson = JSON.parse(assembledTx.toJSON());
        } catch (serializationError) {
            assembledTransactionJson = {
                serializationError: serializationError instanceof Error
                    ? serializationError.message
                    : String(serializationError),
            };
        }
        const assembledTransactionXdr = assembledTx.toXDR();
        logOfflineTransactionDebug(traceId, 'soroban:assembled', {
            settlementId,
            assembledTransactionXdr,
            assembledTransactionXdrCharLength: assembledTransactionXdr.length,
            assembledTransactionJson,
        });

        const { sendTransactionResponse } = await assembledTx.signAndSend({
            signTransaction: async (unsignedTxXdr, signOptions) => {
                logOfflineTransactionDebug(traceId, 'soroban:signing-input', {
                    settlementId,
                    unsignedTxXdr,
                    unsignedTxXdrCharLength: unsignedTxXdr.length,
                    networkPassphrase: signOptions?.networkPassphrase ?? contractConfig.networkPassphrase,
                });
                const signed = await signWithRelayer(unsignedTxXdr, signOptions);
                logOfflineTransactionDebug(traceId, 'soroban:signed', {
                    settlementId,
                    signerAddress: signed.signerAddress,
                    signedTxXdr: signed.signedTxXdr,
                    signedTxXdrCharLength: signed.signedTxXdr.length,
                });
                return signed;
            },
        });

        const txHash: string | undefined = sendTransactionResponse?.hash;

        logOfflineTransactionDebug(traceId, 'soroban:submitted', {
            settlementId,
            txHash,
            sendTransactionResponse,
        });

        await prisma.settlement.update({
            where: { id: settlementId },
            data: { status: 'SETTLED', txHash: txHash ?? null },
        });

        logOfflineTransactionDebug(traceId, 'db:settled', {
            settlementId,
            previousStatus: 'PENDING',
            status: 'SETTLED',
            txHash: txHash ?? null,
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
            { status: 'SETTLED', txHash, amountStroops: amountStroops.toString(), traceId },
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

        logOfflineTransactionDebug(traceId, 'db:failed', {
            settlementId,
            status: 'FAILED',
            failureClass: isInfraError ? 'INFRASTRUCTURE' : 'BUSINESS',
            failReason,
            error: err,
        });

        if (isInfraError) {
            return NextResponse.json({ error: 'RPC unavailable', traceId }, { status: 500 });
        }

        // Notify sender of permanent business-logic failure (e.g. insufficient balance).
        if (senderPhone) {
            await sendSmsNotification(
                senderPhone,
                `Transaction failed: ${failReason.slice(0, 120)}`,
            ).catch(console.error);
        }

        return NextResponse.json(
            { status: 'FAILED', reason: failReason, traceId },
            { status: 200 },
        );
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

    if (!process.env.RELAYER_SECRET_KEY) {
        throw new Error('Missing RELAYER_SECRET_KEY');
    }

    const relayerKeypair = Keypair.fromSecret(process.env.RELAYER_SECRET_KEY);
    const passphrase = signOpts?.networkPassphrase ?? contractConfig.networkPassphrase;
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
