/**
 * @swagger
 * /api/wallet/transfers/confirm:
 *   post:
 *     tags:
 *       - Wallet & Balances
 *     summary: Confirm an online transfer for history
 *     description: |
 *       After the app submits a transfer assembled by `POST /api/engine/transfer`, it
 *       posts the hash here. Parties, token, and amount come from the intent stored at
 *       assembly time; the request carries only the hash. The record moves to `SETTLED`
 *       only when Soroban RPC reports that exact hash as successful.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [txHash]
 *             properties:
 *               txHash:
 *                 type: string
 *                 pattern: '^[a-fA-F0-9]{64}$'
 *     responses:
 *       '200':
 *         description: Transfer settled (or was already settled).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 txHash:
 *                   type: string
 *                 status:
 *                   type: string
 *                   example: SETTLED
 *                 confirmedAt:
 *                   type: string
 *                   format: date-time
 *       '400':
 *         description: Bad JSON or malformed hash.
 *       '404':
 *         description: No transfer intent exists for this hash.
 *       '409':
 *         description: Not yet visible to RPC (status PENDING); retry shortly.
 *       '422':
 *         description: The transaction failed on-chain (status FAILED).
 *       '502':
 *         description: Soroban RPC unavailable.
 */

/**
 * Confirms an online transfer previously assembled by /api/engine/transfer.
 *
 * The request contains only the transaction hash. All parties, token, and
 * amount come from the authenticated intent persisted during assembly. The
 * status is advanced only when Soroban RPC reports the exact hash as SUCCESS.
 */
import { NextResponse } from 'next/server';
import { rpc } from '@stellar/stellar-sdk';
import { prisma } from '@/lib/prisma';
import { sorobanRpcServer } from '@/lib/pijin-contract';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TX_HASH_PATTERN = /^[a-f0-9]{64}$/i;

export async function POST(req: Request): Promise<Response> {
  let txHash: string;

  try {
    const body = await req.json();
    txHash = typeof body?.txHash === 'string' ? body.txHash.trim().toLowerCase() : '';
  } catch {
    return NextResponse.json({ error: 'Bad payload' }, { status: 400 });
  }

  if (!TX_HASH_PATTERN.test(txHash)) {
    return NextResponse.json({ error: 'txHash must be a 64-character hexadecimal string' }, { status: 400 });
  }

  const transfer = await prisma.onlineTransfer.findUnique({ where: { txHash } });
  if (!transfer) {
    return NextResponse.json({ error: 'Unknown online transfer' }, { status: 404 });
  }

  if (transfer.status === 'SETTLED') {
    return NextResponse.json({ txHash, status: transfer.status, confirmedAt: transfer.confirmedAt });
  }

  try {
    const chainTransaction = await sorobanRpcServer.getTransaction(txHash);

    if (chainTransaction.status === rpc.Api.GetTransactionStatus.NOT_FOUND) {
      return NextResponse.json(
        { txHash, status: 'PENDING', error: 'Transaction has not reached the RPC history window yet' },
        { status: 409 },
      );
    }

    if (chainTransaction.status === rpc.Api.GetTransactionStatus.FAILED) {
      const failed = await prisma.onlineTransfer.update({
        where: { txHash },
        data: { status: 'FAILED' },
      });
      return NextResponse.json({ txHash, status: failed.status }, { status: 422 });
    }

    const settled = await prisma.onlineTransfer.update({
      where: { txHash },
      data: { status: 'SETTLED', confirmedAt: new Date() },
    });

    console.info(`[Online Transfer History] Confirmed | txHash=${txHash}`);
    return NextResponse.json({ txHash, status: settled.status, confirmedAt: settled.confirmedAt });
  } catch (error) {
    console.error('[Online Transfer History] RPC confirmation failed:', error);
    return NextResponse.json({ error: 'Unable to verify transaction with Soroban RPC' }, { status: 502 });
  }
}
