import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const merchantShortId = searchParams.get("merchantShortId")?.trim();

    if (!merchantShortId) {
      return NextResponse.json(
        { error: "merchantShortId query parameter is required" },
        { status: 400 }
      );
    }

    const settlements = await prisma.settlement.findMany({
      where: { merchantShortId, status: "SUCCESS" },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return NextResponse.json({
      success: true,
      data: settlements,
    });
  } catch (error) {
    console.error("[Transactions API]", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
