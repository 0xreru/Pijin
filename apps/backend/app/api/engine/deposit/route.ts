/**
 * @swagger
 * /api/engine/deposit:
 *   post:
 *     tags:
 *       - Offline Engine
 *     summary: Execute an online-to-offline vault deposit via Soroban
 *     description: |
 *       Locks tokens from a user's Stellar account into the offline Pijin vault by
 *       calling `pijinContract.deposit(...)` on the backend — where the Stellar SDK's
 *       `ContractClient` runs reliably under Node.js.
 *
 *       **Why this exists:** The Soroban SDK's `ContractClient` dynamically generates
 *       contract methods by parsing XDR at constructor time. This mechanism silently
 *       fails in React Native / Hermes, so `pijinContract.deposit` is `undefined`
 *       when called from the mobile app. Moving the call here fixes it permanently.
 *
 *       #### Authentication
 *       The caller must include an `Authorization: Bearer <sig>` header where `<sig>`
 *       is the Base64-encoded Ed25519 signature over the canonical message:
 *       `deposit:<senderPublicKey>:<amountStroops>`
 *       signed with the user's main wallet secret key. The backend verifies this
 *       before touching the Soroban RPC — same pre-flight firewall used by
 *       `/api/engine/settle`.
 *
 *       #### Processing pipeline
 *       1. Parse and validate the request body.
 *       2. Verify the Ed25519 signature against `senderPublicKey`.
 *       3. Convert `offlineDevicePubkeyHex` → `Buffer<32>` for the contract call.
 *       4. Call `pijinContract.deposit({ sender, token, pubkey, amount })` to simulate
 *          and assemble the transaction envelope on the backend (Node.js runtime).
 *       5. Return the assembled unsigned XDR to the mobile.
 *       6. The mobile signs with the sender's key and submits to the Soroban RPC.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - senderPublicKey
 *               - tokenAddress
 *               - offlineDevicePubkeyHex
 *               - amountStroops
 *             properties:
 *               senderPublicKey:
 *                 type: string
 *                 description: Stellar G-address of the depositing user.
 *                 example: "GABC1234..."
 *               tokenAddress:
 *                 type: string
 *                 description: SAC contract address of the token to lock (PHPC).
 *                 example: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"
 *               offlineDevicePubkeyHex:
 *                 type: string
 *                 description: Hex-encoded 32-byte raw Ed25519 public key of the device.
 *                 example: "a1b2c3d4..."
 *               amountStroops:
 *                 type: string
 *                 description: Amount to lock, in stroops (1/10,000,000 of a token unit).
 *                 example: "500000000"
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
 *                   description: Base64-encoded assembled Stellar transaction envelope.
 *                   example: "AAAAAgAAAA..."
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

// ---------------------------------------------------------------------------
// Runtime — MUST be nodejs; Soroban SDK requires native Buffer + crypto.
// ---------------------------------------------------------------------------
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Injects a SorobanCredentials::SourceAccount auth entry into the assembled
 * transaction's invokeHostFunction operation when the simulation returned no
 * auth entries (the testnet RPC runs simulation in auth-skip mode, so
 * require_auth() calls never produce auth entries in the simulation response).
 *
 * The auth entry covers the full invocation tree:
 *   root  → PijinContract.deposit(sender, token, pubkey, amount)
 *   sub   → PHPC_SAC.transfer(sender, pijinContract, amount)
 *
 * With SourceAccount credentials, tx.sign(senderKeypair) on the mobile
 * satisfies the authorization without any additional authorizeEntry() call.
 */
function injectSourceAccountAuth(
    xdrBase64: string,
    senderPublicKey: string,
    tokenAddress: string,
    amountBigInt: bigint,
): string {
    const envelope = xdr.TransactionEnvelope.fromXDR(xdrBase64, 'base64');
    const ops = envelope.v1().tx().operations();

    for (const op of ops) {
        const body = op.body();
        if (body.switch().name !== 'invokeHostFunction') continue;

        const invokeOp = body.invokeHostFunctionOp();
        const auth = invokeOp.auth();

        console.log(`[Deposit:auth] existing entries=${auth.length}`);

        // We always overwrite the auth entries with our manually constructed
        // SourceAccount credentials because the mobile app signs the transaction
        // envelope directly as the source account.
        // ── Build the auth entry manually ──────────────────────────────────
        // The testnet RPC skips auth during simulation so we construct the
        // SourceAccount auth entry from the known invocation parameters.

        const pijinContractScAddr = xdr.ScAddress.scAddressTypeContract(
            StrKey.decodeContract(contractConfig.contractId) as any
        );
        const tokenScAddr = xdr.ScAddress.scAddressTypeContract(
            StrKey.decodeContract(tokenAddress) as any
        );
        const senderScVal = new Address(senderPublicKey).toScVal();
        const pijinContractScVal = xdr.ScVal.scvAddress(pijinContractScAddr);
        const amountScVal = nativeToScVal(amountBigInt, { type: 'i128' });

        // Sub-invocation: PHPC_SAC.transfer(sender, pijinContract, amount)
        // This is called inside deposit() and also requires sender.require_auth()
        const sacTransferSubInvocation = new xdr.SorobanAuthorizedInvocation({
            function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
                new xdr.InvokeContractArgs({
                    contractAddress: tokenScAddr,
                    functionName: Buffer.from('transfer'),
                    args: [senderScVal, pijinContractScVal, amountScVal],
                })
            ),
            subInvocations: [],
        });

        // Root invocation: PijinContract.deposit(...) — clone args from the op
        const invokeContractArgs = invokeOp.hostFunction().invokeContract();
        const rootInvocation = new xdr.SorobanAuthorizedInvocation({
            function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
                new xdr.InvokeContractArgs({
                    contractAddress: pijinContractScAddr,
                    functionName: invokeContractArgs.functionName(),
                    args: invokeContractArgs.args(),
                })
            ),
            subInvocations: [sacTransferSubInvocation],
        });

        const authEntry = new xdr.SorobanAuthorizationEntry({
            credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
            rootInvocation,
        });

        console.log(`[Deposit:auth] Injected SourceAccount auth entry for ${senderPublicKey}`);
        invokeOp.auth([authEntry]);
    }

    return envelope.toXDR('base64');
}

// ---------------------------------------------------------------------------
// POST /api/engine/deposit
// ---------------------------------------------------------------------------
export async function POST(req: Request): Promise<Response> {
    // ── 1. Parse body ────────────────────────────────────────────────────────
    let body: {
        senderPublicKey?: string;
        tokenAddress?: string;
        offlineDevicePubkeyHex?: string;
        amountStroops?: string;
    };

    try {
        body = await req.json();
    } catch {
        console.error('[Deposit] Could not parse JSON body');
        return NextResponse.json({ error: 'Bad payload' }, { status: 400 });
    }

    const { senderPublicKey, tokenAddress, offlineDevicePubkeyHex, amountStroops } = body ?? {};

    // ── 2. Validate fields ───────────────────────────────────────────────────
    if (!senderPublicKey || !tokenAddress || !offlineDevicePubkeyHex || !amountStroops) {
        return NextResponse.json(
            { error: 'Missing required fields: senderPublicKey, tokenAddress, offlineDevicePubkeyHex, amountStroops' },
            { status: 400 },
        );
    }

    if (!/^G[A-Z2-7]{55}$/.test(senderPublicKey)) {
        return NextResponse.json({ error: 'Invalid senderPublicKey format' }, { status: 400 });
    }

    if (!/^[0-9a-fA-F]{64}$/.test(offlineDevicePubkeyHex)) {
        return NextResponse.json(
            { error: 'offlineDevicePubkeyHex must be a 64-char hex string (32 bytes)' },
            { status: 400 },
        );
    }

    let amountBigInt: bigint;
    try {
        amountBigInt = BigInt(amountStroops);
        if (amountBigInt <= 0n) throw new Error('non-positive');
    } catch {
        return NextResponse.json({ error: 'amountStroops must be a positive integer string' }, { status: 400 });
    }

    // ── 3. Verify Ed25519 signature (pre-flight firewall) ────────────────────
    //
    // The mobile signs:  deposit:<senderPublicKey>:<amountStroops>
    // and sends the raw 64-byte signature as Base64 in Authorization: Bearer
    //
    const authHeader = req.headers.get('Authorization') ?? '';
    const sigBase64 = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

    if (!sigBase64) {
        return NextResponse.json({ error: 'Missing Authorization header' }, { status: 401 });
    }

    try {
        const sigBuf = Buffer.from(sigBase64, 'base64');
        const msgBuf = Buffer.from(`deposit:${senderPublicKey}:${amountStroops}`);
        const senderKeypair = Keypair.fromPublicKey(senderPublicKey);

        if (!senderKeypair.verify(msgBuf, sigBuf)) {
            console.warn(`[Deposit] Signature verification failed for ${senderPublicKey}`);
            return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
        }
    } catch (err) {
        console.error('[Deposit] Signature check threw:', err);
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    console.log(
        `[Deposit] Verified | sender=${senderPublicKey} | amountStroops=${amountStroops} | token=${tokenAddress}`,
    );

    // ── 4. Convert device pubkey hex → Buffer<32> ────────────────────────────
    const pubkeyBuffer = Buffer.from(offlineDevicePubkeyHex, 'hex');

    // ── 5. Simulate with the RELAYER as the fee-source ───────────────────────
    //
    // KEY: When pijinContract.deposit() is called with publicKey=senderPublicKey
    // (sender == tx source), Soroban treats sender.require_auth() as an implicit
    // invoker and returns 0 auth entries. On-chain execution still requires an
    // explicit SorobanAuthorizationEntry — so the submission always fails with
    // txBAD_AUTH. Fix: simulate with the RELAYER as the source account. Now
    // sender != source, so the simulation generates an explicit Address-type
    // auth entry for the sender. We then rewrite it to SourceAccount credentials
    // and set the real source (sender) before returning the XDR to mobile.
    //
    const relayerPublicKey = process.env.RELAYER_PUBLIC_KEY;
    if (!relayerPublicKey) {
        return NextResponse.json({ error: 'Server misconfiguration: RELAYER_PUBLIC_KEY not set' }, { status: 500 });
    }

    let assembledTx: Awaited<ReturnType<typeof pijinContract.deposit>>;
    try {
        assembledTx = await pijinContract.deposit(
            {
                sender: senderPublicKey,
                token: tokenAddress,
                pubkey: pubkeyBuffer,
                amount: amountBigInt,
            },
            {
                // Use the relayer as the fee source so the simulation is forced
                // to produce an explicit auth entry for the sender.
                publicKey: relayerPublicKey,
            },
        );
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[Deposit] pijinContract.deposit simulation failed:', msg);
        return NextResponse.json({ error: `Soroban simulation failed: ${msg}` }, { status: 500 });
    }

    if (!assembledTx.built || (assembledTx.simulation && 'error' in assembledTx.simulation && (assembledTx.simulation as any).error)) {
        console.error('[Deposit] Soroban simulation failed on-chain:', (assembledTx.simulation as any)?.error);
        return NextResponse.json({ error: `Soroban simulation failed: ${(assembledTx.simulation as any)?.error}` }, { status: 500 });
    }

    // ── 6. Rebuild XDR with sender as source + SourceAccount auth entry ───────
    //
    // The assembled tx has relayer as source. We must:
    //   a) Rewrite sender's auth entries: Address → SourceAccount credentials.
    //   b) Fetch the sender's live account (sequence number) from the RPC.
    //   c) Rebuild the transaction with sender as source account.
    // The mobile then signs the envelope with the sender's key and submits.
    //
    try {
        const builtTx = assembledTx.built;
        if (!builtTx) {
            console.error('[Deposit] assembledTx.built is undefined after simulation');
            return NextResponse.json({ error: 'Soroban assembly produced no transaction' }, { status: 500 });
        }

        // (a) Inject SourceAccount auth entry (simulation runs in auth-skip mode
        //     on the testnet RPC and always returns 0 auth entries).
        const relayerXdr = builtTx.toEnvelope().toXDR('base64');
        const rewrittenXdr = injectSourceAccountAuth(
            relayerXdr, senderPublicKey, tokenAddress!, amountBigInt,
        );

        // (b) Fetch sender's live sequence number.
        const senderAccount = await sorobanRpcServer.getAccount(senderPublicKey);

        // (c) Rebuild the transaction using sender as the source account.
        //     Clone all operations and Soroban data from the rewritten XDR.
        const rewrittenEnvelope = xdr.TransactionEnvelope.fromXDR(rewrittenXdr, 'base64');
        const originalTx = rewrittenEnvelope.v1().tx();

        const rebuilt = new TransactionBuilder(senderAccount, {
            fee: originalTx.fee().toString(),
            networkPassphrase: contractConfig.networkPassphrase,
            // Soroban transactions carry no meaningful memo — skip addMemo
            // (raw xdr.Memo objects lack the toXDRObject() method that
            // TransactionBuilder.build() expects on the Memo class instance).
        });

        // Copy all operations
        for (const op of originalTx.operations()) {
            rebuilt.addOperation(op);
        }

        // Copy timebounds if present
        const conds = originalTx.cond();
        if (conds.switch().name === 'precondTime') {
            const tb = conds.timeBounds();
            const minTime = parseInt(tb.minTime().toString(), 10);
            const maxTime = parseInt(tb.maxTime().toString(), 10);
            if (maxTime === 0) {
                // Soroban transactions require a valid maxTime (TimeoutInfinite is invalid)
                rebuilt.setTimeout(300);
            } else {
                rebuilt.setTimebounds(minTime, maxTime);
            }
        } else {
            rebuilt.setTimeout(300);
        }

        // Copy Soroban data (footprint + resource limits)
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

        console.log(`[Deposit] Assembled XDR ready | sender=${senderPublicKey} | amountStroops=${amountStroops}`);

        return NextResponse.json({ xdr: xdrOut }, { status: 200 });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[Deposit] XDR extraction failed:', msg);
        return NextResponse.json({ error: `Failed to extract assembled XDR: ${msg}` }, { status: 500 });
    }
}
