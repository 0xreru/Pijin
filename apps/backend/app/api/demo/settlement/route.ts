/**
 * @swagger
 * /api/demo/settlement:
 *   get:
 *     tags:
 *       - Demo & Testnet
 *     summary: Poll the settlement status of a simulator voucher
 *     description: |
 *       Lets the simulator show **Transaction Settled** and link the hash on Stellar Expert.
 *       The record is returned only if `senderShortId` matches the voucher's sender;
 *       otherwise the response is `NOT_FOUND`.
 *     security:
 *       - DemoAccessCode: []
 *     parameters:
 *       - in: query
 *         name: nonce
 *         required: true
 *         schema:
 *           type: string
 *           pattern: '^[A-Za-z0-9+/]{43}$'
 *         description: Unpadded Base64 voucher nonce (32 bytes).
 *       - in: query
 *         name: senderShortId
 *         required: true
 *         schema:
 *           type: string
 *           pattern: '^[0-9A-Za-z]{6}$'
 *     responses:
 *       '200':
 *         description: Current status (NOT_FOUND, or the settlement's PENDING / SETTLED / FAILED status).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: SETTLED
 *                 txHash:
 *                   type: string
 *                   nullable: true
 *                 failureReason:
 *                   type: string
 *                   nullable: true
 *       '400':
 *         description: Invalid parameters.
 *       '401':
 *         description: Wrong or missing access code.
 *       '404':
 *         description: Demo mode is disabled.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  assertDemoAccessCode,
  assertDemoEnabled,
  assertDemoTestnet,
  DemoDisabledError,
  DemoUnauthorizedError,
} from '@/lib/demo/config';
import {
  isDemoSettlementNonce,
  isDemoShortId,
  type DemoSettlementStatus,
} from '@/lib/demo/settlement-status';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function noStore<T>(body: T, status = 200): NextResponse<T> {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store, private',
      Pragma: 'no-cache',
    },
  });
}

function errorResponse(error: unknown): NextResponse {
  const message =
    error instanceof Error ? error.message : 'Settlement status request failed';
  if (error instanceof DemoDisabledError) return noStore({ error: message }, 404);
  if (error instanceof DemoUnauthorizedError) return noStore({ error: message }, 401);

  console.error('[DemoSettlementStatus]', message);
  return noStore({ error: 'Unable to read settlement status' }, 500);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    assertDemoEnabled();
    assertDemoTestnet();
    assertDemoAccessCode(request.headers.get('x-demo-access-code'));

    const nonce = request.nextUrl.searchParams.get('nonce')?.trim() ?? '';
    const senderShortId =
      request.nextUrl.searchParams.get('senderShortId')?.trim() ?? '';
    if (!isDemoSettlementNonce(nonce) || !isDemoShortId(senderShortId)) {
      return noStore({ error: 'Invalid settlement lookup parameters' }, 400);
    }

    const settlement = await prisma.settlement.findUnique({
      where: { nonce },
      select: {
        senderShortId: true,
        status: true,
        txHash: true,
        failReason: true,
      },
    });

    if (!settlement || settlement.senderShortId !== senderShortId) {
      const response: DemoSettlementStatus = {
        status: 'NOT_FOUND',
        txHash: null,
        failureReason: null,
      };
      return noStore(response);
    }

    const response: DemoSettlementStatus = {
      status: settlement.status,
      txHash: settlement.txHash,
      failureReason: settlement.failReason,
    };
    return noStore(response);
  } catch (error) {
    return errorResponse(error);
  }
}
