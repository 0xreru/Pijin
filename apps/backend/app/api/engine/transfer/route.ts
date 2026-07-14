/**
 * @swagger
 * /api/engine/transfer:
 *   post:
 *     tags:
 *       - Offline Engine
 *     summary: Execute an online token transfer via Soroban
 *     description: |
 *       Transfers tokens from the sender's Stellar account to a recipient.
 *
 *       #### Authentication
 *       The caller must include an `Authorization: Bearer <sig>` header where `<sig>`
 *       is the Base64-encoded Ed25519 signature over the canonical message:
 *       `transfer:v2:online:<tokenAddress>:<senderPublicKey>:<recipientPublicKey>:<amountStroops>`
 *       signed with the user's main wallet secret key.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - senderPublicKey
 *               - recipientPublicKey
 *               - tokenAddress
 *               - amountStroops
 *               - paymentMode
 *               - clientProtocol
 *             properties:
 *               senderPublicKey:
 *                 type: string
 *               recipientPublicKey:
 *                 type: string
 *               tokenAddress:
 *                 type: string
 *               amountStroops:
 *                 type: string
 *               paymentMode:
 *                 type: string
 *                 enum: [online]
 *               clientProtocol:
 *                 type: integer
 *                 enum: [2]
 *     responses:
 *       '200':
 *         description: Assembled unsigned XDR returned for mobile to sign and submit.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 xdr:
 *                   type: string
 *       '426':
 *         description: The mobile bundle is too old to declare versioned online-transfer intent.
 */
import { NextResponse } from 'next/server';
import { Keypair, xdr, StrKey, TransactionBuilder, Address, nativeToScVal, Contract } from '@stellar/stellar-sdk';
import { sorobanRpcServer, contractConfig } from '@/lib/pijin-contract';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const ONLINE_TRANSFER_PROTOCOL = 2;

function injectSourceAccountAuth(
    xdrBase64: string,
    senderPublicKey: string,
    tokenAddress: string,
    amountBigInt: bigint,
    recipientPublicKey: string
): string {
    const envelope = xdr.TransactionEnvelope.fromXDR(xdrBase64, 'base64');
    const ops = envelope.v1().tx().operations();

    for (const op of ops) {
        const body = op.body();
        if (body.switch().name !== 'invokeHostFunction') continue;

        const invokeOp = body.invokeHostFunctionOp();
        
        const tokenScAddr = xdr.ScAddress.scAddressTypeContract(
            StrKey.decodeContract(tokenAddress) as any
        );

        const senderScVal = new Address(senderPublicKey).toScVal();
        const recipientScVal = new Address(recipientPublicKey).toScVal();
        const amountScVal = nativeToScVal(amountBigInt, { type: 'i128' });

        const rootInvocation = new xdr.SorobanAuthorizedInvocation({
            function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
                new xdr.InvokeContractArgs({
                    contractAddress: tokenScAddr,
                    functionName: 'transfer',
                    args: [senderScVal, recipientScVal, amountScVal],
                })
            ),
            subInvocations: [],
        });

        const authEntry = new xdr.SorobanAuthorizationEntry({
            credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
            rootInvocation,
        });

        invokeOp.auth([authEntry]);
    }

    return envelope.toXDR('base64');
}

export async function POST(req: Request): Promise<Response> {
    let body: {
        senderPublicKey?: string;
        recipientPublicKey?: string;
        tokenAddress?: string;
        amountStroops?: string;
        paymentMode?: string;
        clientProtocol?: number;
    };

    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: 'Bad payload' }, { status: 400 });
    }

    const {
        senderPublicKey,
        recipientPublicKey,
        tokenAddress,
        amountStroops,
        paymentMode,
        clientProtocol,
    } = body ?? {};

    if (!senderPublicKey || !recipientPublicKey || !tokenAddress || !amountStroops) {
        return NextResponse.json(
            { error: 'Missing required fields: senderPublicKey, recipientPublicKey, tokenAddress, amountStroops' },
            { status: 400 },
        );
    }

    // Fail closed for old mobile bundles. Before protocol v2, a stale React
    // closure could call this online endpoint while the visible flow was
    // offline. Requiring an explicit versioned rail also prevents a proxy from
    // changing the user's signed intent.
    if (paymentMode !== 'online' || clientProtocol !== ONLINE_TRANSFER_PROTOCOL) {
        console.warn('[Online Transfer] Rejected stale or ambiguous client intent', {
            clientProtocol: clientProtocol ?? null,
            paymentMode: paymentMode ?? null,
            senderPublicKey,
            recipientPublicKey,
            amountStroops,
        });
        return NextResponse.json(
            {
                error: 'Client upgrade required: explicit online transfer intent is missing.',
                code: 'ONLINE_TRANSFER_PROTOCOL_REQUIRED',
            },
            { status: 426 },
        );
    }

    if (!/^G[A-Z2-7]{55}$/.test(senderPublicKey) || !/^G[A-Z2-7]{55}$/.test(recipientPublicKey)) {
        return NextResponse.json({ error: 'Invalid public key format' }, { status: 400 });
    }

    let amountBigInt: bigint;
    try {
        amountBigInt = BigInt(amountStroops);
        if (amountBigInt <= 0n) throw new Error('non-positive');
    } catch {
        return NextResponse.json({ error: 'amountStroops must be a positive integer string' }, { status: 400 });
    }

    const authHeader = req.headers.get('Authorization') ?? '';
    const sigBase64 = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

    if (!sigBase64) {
        return NextResponse.json({ error: 'Missing Authorization header' }, { status: 401 });
    }

    try {
        const sigBuf = Buffer.from(sigBase64, 'base64');
        const msgBuf = Buffer.from(
            `transfer:v${ONLINE_TRANSFER_PROTOCOL}:online:${tokenAddress}:${senderPublicKey}:${recipientPublicKey}:${amountStroops}`,
        );
        const senderKeypair = Keypair.fromPublicKey(senderPublicKey);

        if (!senderKeypair.verify(msgBuf, sigBuf)) {
            return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
        }
    } catch (err) {
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    console.info('[Online Transfer] Authorized explicit online intent', {
        clientProtocol,
        senderPublicKey,
        recipientPublicKey,
        tokenAddress,
        amountStroops,
    });

    const relayerPublicKey = process.env.RELAYER_PUBLIC_KEY;
    if (!relayerPublicKey) {
        return NextResponse.json({ error: 'Server misconfiguration: RELAYER_PUBLIC_KEY not set' }, { status: 500 });
    }

    try {
        const relayerAccount = await sorobanRpcServer.getAccount(relayerPublicKey);
        const tokenContract = new Contract(tokenAddress);
        
        let tx = new TransactionBuilder(relayerAccount, {
            fee: '100000',
            networkPassphrase: contractConfig.networkPassphrase,
        })
        .addOperation(
            tokenContract.call('transfer',
                new Address(senderPublicKey).toScVal(),
                new Address(recipientPublicKey).toScVal(),
                nativeToScVal(amountBigInt, { type: 'i128' })
            )
        )
        .setTimeout(300)
        .build();

        const simulated = await sorobanRpcServer.simulateTransaction(tx);
        
        if ('error' in simulated && simulated.error) {
            return NextResponse.json({ error: `Soroban simulation failed: ${simulated.error}` }, { status: 500 });
        }
        
        if (!('transactionData' in simulated) || !simulated.transactionData) {
            return NextResponse.json({ error: 'Soroban simulation produced no transaction data' }, { status: 500 });
        }

        const relayerXdr = tx.toEnvelope().toXDR('base64');
        const rewrittenXdr = injectSourceAccountAuth(relayerXdr, senderPublicKey, tokenAddress, amountBigInt, recipientPublicKey);

        const senderAccount = await sorobanRpcServer.getAccount(senderPublicKey);

        const rewrittenEnvelope = xdr.TransactionEnvelope.fromXDR(rewrittenXdr, 'base64');
        const originalTx = rewrittenEnvelope.v1().tx();

        const feeToUse = 'minResourceFee' in simulated && simulated.minResourceFee 
            ? (parseInt(simulated.minResourceFee, 10) + 1000).toString() 
            : '100000';

        const rebuilt = new TransactionBuilder(senderAccount, {
            fee: feeToUse,
            networkPassphrase: contractConfig.networkPassphrase,
        });

        for (const op of originalTx.operations()) {
            rebuilt.addOperation(op);
        }
        rebuilt.setTimeout(300);
        rebuilt.setSorobanData(simulated.transactionData.build());

        const finalTx = rebuilt.build();
        const xdrOut = finalTx.toEnvelope().toXDR('base64');

        return NextResponse.json({ xdr: xdrOut }, { status: 200 });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ error: `Failed to extract assembled XDR: ${msg}` }, { status: 500 });
    }
}
