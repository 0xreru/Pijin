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
import { Keypair, Transaction, xdr, StrKey } from '@stellar/stellar-sdk';
import { pijinContract } from '@/lib/pijin-contract';

// ---------------------------------------------------------------------------
// Runtime — MUST be nodejs; Soroban SDK requires native Buffer + crypto.
// ---------------------------------------------------------------------------
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Rewrites SorobanAuthorizationEntry objects that use Address credentials for
 * `targetPublicKey` to SourceAccount credentials instead.
 *
 * Why: The deposit tx source IS the sender. `SorobanCredentials::SourceAccount`
 * means "authorized by whoever signed this transaction at the envelope level",
 * which is exactly what `tx.sign(senderKeypair)` on the mobile provides.
 * This eliminates the need for a separate `authorizeEntry()` call on mobile,
 * which would require fetching the current ledger sequence and has Hermes
 * compatibility risks with the Stellar SDK.
 */
function useSourceAccountAuth(tx: Transaction, targetPublicKey: string): void {
    const targetPubKeyBytes = StrKey.decodeEd25519PublicKey(targetPublicKey);

    for (const op of tx.operations as any[]) {
        if (!Array.isArray(op.auth)) continue;

        op.auth = op.auth.map((entry: xdr.SorobanAuthorizationEntry) => {
            const creds = entry.credentials();

            // Only touch Address-type credentials
            if (creds.switch().name !== 'sorobanCredentialsAddress') return entry;

            const addr = creds.address().address();

            // Only touch Account-type addresses (not contract addresses)
            if (addr.switch().name !== 'scAddressTypeAccount') return entry;

            const entryPubKeyBytes = addr.accountId().ed25519();

            // Only rewrite entries belonging to the target sender
            if (!Buffer.from(entryPubKeyBytes).equals(Buffer.from(targetPubKeyBytes))) {
                return entry;
            }

            // Replace with SourceAccount credentials — tx.sign() satisfies this
            console.log(`[Deposit] Rewriting auth entry for ${targetPublicKey} → SourceAccount credentials`);
            return new xdr.SorobanAuthorizationEntry({
                credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
                rootInvocation: entry.rootInvocation(),
            });
        });
    }
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

    // ── 5. Call pijinContract.deposit ────────────────────────────────────────
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
                // Provide the sender as the fee-payer so the SDK can assemble
                // a valid transaction envelope.
                publicKey: senderPublicKey,
            },
        );
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[Deposit] pijinContract.deposit simulation failed:', msg);
        return NextResponse.json({ error: `Soroban simulation failed: ${msg}` }, { status: 500 });
    }

    // ── 6. Return the assembled unsigned XDR for the mobile to sign ──────────
    //
    // The deposit transaction's source account IS the sender, so only their
    // key can authorize it. The relayer cannot sign on their behalf.
    // We return the assembled XDR and the mobile signs + submits it directly.
    //
    try {
        const builtTx = assembledTx.built;
        if (!builtTx) {
            console.error('[Deposit] assembledTx.built is undefined after simulation');
            return NextResponse.json({ error: 'Soroban assembly produced no transaction' }, { status: 500 });
        }

        // Rewrite sender's auth entries from Address → SourceAccount credentials
        // so the mobile's tx.sign() call fully satisfies sender.require_auth().
        useSourceAccountAuth(builtTx, senderPublicKey);

        const xdr = builtTx.toEnvelope().toXDR('base64');

        console.log(`[Deposit] Assembled XDR ready | sender=${senderPublicKey} | amountStroops=${amountStroops}`);

        return NextResponse.json({ xdr }, { status: 200 });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[Deposit] XDR extraction failed:', msg);
        return NextResponse.json({ error: `Failed to extract assembled XDR: ${msg}` }, { status: 500 });
    }
}
