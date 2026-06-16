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
    const serializedSettlements = settlements.map(settlement => ({
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