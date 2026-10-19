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
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(15, "10 s"),
  analytics: false,
  prefix: "pijin:api:transactions",
});

export async function GET(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "127.0.0.1";
    const { success } = await ratelimit.limit(ip);
    if (!success) {
      return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 });
    }

    const { searchParams } = new URL(req.url);
    const shortId = searchParams.get("shortId")?.trim();
    const rawLimit = searchParams.get("limit")?.trim();
    const sinceParam = searchParams.get("since")?.trim();

    if (!shortId) {
      return NextResponse.json(
        { error: "shortId query parameter is required" },
        { status: 400 }
      );
    }

    const requestedLimit = rawLimit ? Math.min(Math.max(parseInt(rawLimit, 10) || 50, 1), 100) : 50;
    const sinceDate = sinceParam ? new Date(sinceParam) : null;
    const validSince = sinceDate && !isNaN(sinceDate.getTime()) ? sinceDate : null;

    const redis = Redis.fromEnv();
    const cacheKey = `pijin:cache:transactions:${shortId}:${requestedLimit}:${sinceParam ?? 'all'}`;
    try {
      const cached = await redis.get<{ success: boolean; data: unknown[] }>(cacheKey);
      if (cached?.data) {
        return NextResponse.json(
          { ...cached, cached: true },
          {
            headers: {
              "Cache-Control": "public, s-maxage=5, stale-while-revalidate=5",
              "X-Cache": "HIT",
            },
          },
        );
      }
    } catch {
      // cache miss or transient redis error
    }

    const dateFilter = validSince ? { gte: validSince } : undefined;

    const settlements = await prisma.settlement.findMany({
      where: { 
        OR: [
          { senderShortId: shortId },
          { receiverShortId: shortId }
        ],
        status: "SETTLED",
        ...(dateFilter ? { createdAt: dateFilter } : {}),
      },
      include: {
        token: {
          select: { symbol: true, decimals: true }
        }
      },
      orderBy: { createdAt: "desc" },
      take: requestedLimit,
    });

    const shortIdsToFetch = new Set<string>();
    settlements.forEach(s => {
      if (s.senderShortId) shortIdsToFetch.add(s.senderShortId);
      if (s.receiverShortId) shortIdsToFetch.add(s.receiverShortId);
    });

    const accounts = await prisma.account.findMany({
      where: { shortId: { in: Array.from(shortIdsToFetch) } },
      select: { shortId: true, firstName: true },
    });

    const accountMap = new Map<string, string>();
    accounts.forEach(acc => {
      accountMap.set(acc.shortId, acc.firstName || acc.shortId);
    });

    // We must serialize BigInt (amountStroops) to strings so JSON.stringify doesn't crash
    const serializedSettlements = settlements.map((settlement: typeof settlements[number]) => ({
      ...settlement,
      amountStroops: settlement.amountStroops.toString(),
      senderName: accountMap.get(settlement.senderShortId) || settlement.senderShortId,
      receiverName: accountMap.get(settlement.receiverShortId) || settlement.receiverShortId,
    }));

    const responsePayload = {
      success: true,
      data: serializedSettlements,
    };

    try {
      await redis.set(cacheKey, responsePayload, { ex: 5 });
    } catch {
      // transient redis error
    }

    return NextResponse.json(responsePayload, {
      headers: {
        "Cache-Control": "public, s-maxage=5, stale-while-revalidate=5",
        "X-Cache": "MISS",
      },
    });
  } catch (error) {
    console.error("[Transactions API]", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}