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
