import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const merchant = await prisma.account.findFirst({
      where: { role: "MERCHANT" },
      orderBy: { createdAt: "desc" },
      select: { shortId: true },
    });

    if (!merchant) {
      return NextResponse.json(
        { error: "No merchant found in database" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: { shortId: merchant.shortId },
    });
  } catch (error) {
    console.error("[Merchants API]", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
