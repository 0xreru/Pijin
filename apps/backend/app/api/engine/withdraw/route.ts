/**
 * @swagger
 * /api/engine/withdraw:
 *   post:
 *     tags:
 *       - Offline Engine
 *     summary: Execute an offline-to-online vault withdrawal via Soroban
 *     description: |
 *       Unlocks tokens from a user's offline Pijin vault back to their Stellar account by
 *       calling `pijinContract.withdraw(...)` on the backend.
 *
 *       #### Authentication
 *       The caller must include an `Authorization: Bearer <sig>` header where `<sig>`
 *       is the Base64-encoded Ed25519 signature over the canonical message:
 *       `withdraw:<senderPublicKey>:<amountStroops>`
 *       signed with the user's main wallet secret key.
 *
 *       #### Processing pipeline
 *       1. Parse and validate the request body.
 *       2. Verify the Ed25519 signature against `senderPublicKey`.
 *       3. Call `pijinContract.withdraw({ sender, token, amount })` to simulate
 *          and assemble the transaction envelope on the backend.
 *       4. Return the assembled unsigned XDR to the mobile.
 *       5. The mobile signs with the sender's key and submits to the Soroban RPC.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - senderPublicKey
 *               - tokenAddress
 *               - amountStroops
 *             properties:
 *               senderPublicKey:
 *                 type: string
 *                 description: Stellar G-address of the withdrawing user.
 *               tokenAddress:
 *                 type: string
 *                 description: SAC contract address of the token (PHPC).
 *               amountStroops:
 *                 type: string
 *                 description: Amount to unlock, in stroops.
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
 *       '400':
 *         description: Missing or invalid request fields.
 *       '401':
 *         description: Ed25519 signature verification failed.
 *       '500':
 *         description: Soroban simulation failed.
 */
import { NextResponse } from 'next/server';
import { Keypair, xdr, StrKey, TransactionBuilder, Address, nativeToScVal } from '@stellar/stellar-sdk';
import { pijinContract, sorobanRpcServer, contractConfig } from '@/lib/pijin-contract';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function injectSourceAccountAuth(
    xdrBase64: string,
    senderPublicKey: string,
): string {
    const envelope = xdr.TransactionEnvelope.fromXDR(xdrBase64, 'base64');
    const ops = envelope.v1().tx().operations();

    for (const op of ops) {
        const body = op.body();
        if (body.switch().name !== 'invokeHostFunction') continue;

        const invokeOp = body.invokeHostFunctionOp();
        
        const pijinContractScAddr = xdr.ScAddress.scAddressTypeContract(
            StrKey.decodeContract(contractConfig.contractId) as any
        );

        // Root invocation: PijinContract.withdraw(...)
        const invokeContractArgs = invokeOp.hostFunction().invokeContract();
        const rootInvocation = new xdr.SorobanAuthorizedInvocation({
            function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
                new xdr.InvokeContractArgs({
                    contractAddress: pijinContractScAddr,
                    functionName: invokeContractArgs.functionName(),
                    args: invokeContractArgs.args(),
                })
            ),
            subInvocations: [], // Withdraw does not require sender to authorize the internal token transfer
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
        tokenAddress?: string;
        amountStroops?: string;
    };

    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: 'Bad payload' }, { status: 400 });
    }

    const { senderPublicKey, tokenAddress, amountStroops } = body ?? {};

    if (!senderPublicKey || !tokenAddress || !amountStroops) {
        return NextResponse.json(
            { error: 'Missing required fields: senderPublicKey, tokenAddress, amountStroops' },
            { status: 400 },
        );
    }

    if (!/^G[A-Z2-7]{55}$/.test(senderPublicKey)) {
        return NextResponse.json({ error: 'Invalid senderPublicKey format' }, { status: 400 });
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
        const msgBuf = Buffer.from(`withdraw:${senderPublicKey}:${amountStroops}`);
        const senderKeypair = Keypair.fromPublicKey(senderPublicKey);

        if (!senderKeypair.verify(msgBuf, sigBuf)) {
            return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
        }
    } catch (err) {
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    const relayerPublicKey = process.env.RELAYER_PUBLIC_KEY;
    if (!relayerPublicKey) {
        return NextResponse.json({ error: 'Server misconfiguration: RELAYER_PUBLIC_KEY not set' }, { status: 500 });
    }

    let assembledTx: Awaited<ReturnType<typeof pijinContract.withdraw>>;
    try {
        assembledTx = await pijinContract.withdraw(
            {
                sender: senderPublicKey,
                token: tokenAddress,
                amount: amountBigInt,
            },
            {
                publicKey: relayerPublicKey,
            },
        );
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ error: `Soroban simulation failed: ${msg}` }, { status: 500 });
    }

    if (!assembledTx.built || (assembledTx.simulation && 'error' in assembledTx.simulation && (assembledTx.simulation as any).error)) {
        return NextResponse.json({ error: `Soroban simulation failed: ${(assembledTx.simulation as any)?.error}` }, { status: 500 });
    }

    try {
        const builtTx = assembledTx.built;
        if (!builtTx) {
            return NextResponse.json({ error: 'Soroban assembly produced no transaction' }, { status: 500 });
        }

        const relayerXdr = builtTx.toEnvelope().toXDR('base64');
        const rewrittenXdr = injectSourceAccountAuth(relayerXdr, senderPublicKey);

        const senderAccount = await sorobanRpcServer.getAccount(senderPublicKey);

        const rewrittenEnvelope = xdr.TransactionEnvelope.fromXDR(rewrittenXdr, 'base64');
        const originalTx = rewrittenEnvelope.v1().tx();

        const rebuilt = new TransactionBuilder(senderAccount, {
            fee: originalTx.fee().toString(),
            networkPassphrase: contractConfig.networkPassphrase,
        });

        for (const op of originalTx.operations()) {
            rebuilt.addOperation(op);
        }

        const conds = originalTx.cond();
        if (conds.switch().name === 'precondTime') {
            const tb = conds.timeBounds();
            const minTime = parseInt(tb.minTime().toString(), 10);
            const maxTime = parseInt(tb.maxTime().toString(), 10);
            if (maxTime === 0) {
                rebuilt.setTimeout(300);
            } else {
                rebuilt.setTimebounds(minTime, maxTime);
            }
        } else {
            rebuilt.setTimeout(300);
        }

        if (assembledTx.simulation && (assembledTx.simulation as any).transactionData) {
            rebuilt.setSorobanData((assembledTx.simulation as any).transactionData.build());
        } else {
            const sorobanData = originalTx.ext();
            if ((sorobanData.switch() as any)?.name === 'extV1' || sorobanData.switch() === 0) {
                rebuilt.setSorobanData((sorobanData as any).v1().sorobanData());
            }
        }

        const finalTx = rebuilt.build();
        const xdrOut = finalTx.toEnvelope().toXDR('base64');

        return NextResponse.json({ xdr: xdrOut }, { status: 200 });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ error: `Failed to extract assembled XDR: ${msg}` }, { status: 500 });
    }
}
