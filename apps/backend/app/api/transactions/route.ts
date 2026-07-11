/**
 * @swagger
 * /api/transactions:
 *   get:
 *     tags:
 *       - Wallet & Balances
 *     summary: Get settled offline P2P transactions (raw)
 *     description: |
 *       Returns up to **50 settled** `Settlement` records for a given `shortId`,
 *       ordered newest-first. Only records with `status = "SETTLED"` are included.
 *
 *       Unlike `/api/wallet/history`, this endpoint returns the raw Prisma settlement
 *       records including the token metadata join (`symbol`, `decimals`).
 *       `amountStroops` (BigInt) is serialised to a string to prevent JSON crashes.
 *
 *       > **Prefer `/api/wallet/history`** for the mobile app — it aggregates both
 *       > offline and online transactions in a unified, normalised format.
 *     parameters:
 *       - in: query
 *         name: shortId
 *         required: true
 *         schema:
 *           type: string
 *         description: The user's 6-character Base62 short ID.
 *         example: "aB3x9Q"
 *     responses:
 *       '200':
 *         description: List of settled transactions.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                       senderShortId:
 *                         type: string
 *                         example: "aB3x9Q"
 *                       receiverShortId:
 *                         type: string
 *                         example: "Zx7mNk"
 *                       amountStroops:
 *                         type: string
 *                         description: Serialised BigInt in stroops.
 *                         example: "1000000000"
 *                       status:
 *                         type: string
 *                         example: "SETTLED"
 *                       txHash:
 *                         type: string
 *                         nullable: true
 *                       token:
 *                         type: object
 *                         properties:
 *                           symbol:
 *                             type: string
 *                             example: "PHPC"
 *                           decimals:
 *                             type: integer
 *                             example: 7
 *       '400':
 *         description: Missing `shortId` parameter.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "shortId query parameter is required"
 *       '500':
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    
    const shortId = searchParams.get("shortId")?.trim();

    if (!shortId) {
      return NextResponse.json(
        { error: "shortId query parameter is required" },
        { status: 400 }
      );
    }

    const settlements = await prisma.settlement.findMany({
      where: { 
        OR: [
          { senderShortId: shortId },
          { receiverShortId: shortId }
        ],
        status: "SETTLED" 
      },
      include: {
        
        // frontend knows exactly what symbol to display (e.g., "PHPC")
        token: {
            select: { symbol: true, decimals: true }
        }
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    // We must serialize BigInt (amountStroops) to strings so JSON.stringify doesn't crash
    const serializedSettlements = settlements.map((settlement: typeof settlements[number]) => ({
        ...settlement,
        amountStroops: settlement.amountStroops.toString(),
    }));

    return NextResponse.json({
      success: true,
      data: serializedSettlements,
    });
  } catch (error) {
    console.error("[Transactions API]", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}