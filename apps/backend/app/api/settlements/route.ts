import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { processOfflineSettlement } from "@/lib/settlement";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { smsBody } = body;

    if (!smsBody) {
      return NextResponse.json({ error: "Missing smsBody" }, { status: 400 });
    }

    const parts = smsBody.split(":");
    if (parts.length < 6) {
      return NextResponse.json({ error: "Malformed smsBody" }, { status: 400 });
    }

    const nonce = parts[4];

    // Check if the transaction with this cryptographic nonce was already processed
    const existing = await prisma.settlement.findUnique({
      where: { nonce },
    });

    if (existing) {
      console.log(`[Settlements API] Nonce ${nonce} already processed. Returning 409 Conflict.`);
      return NextResponse.json(
        { txHash: existing.txHash, status: existing.status },
        { status: 409 }
      );
    }

    // Process the settlement
    const result = await processOfflineSettlement({ smsContent: smsBody });

    if (!result.ok) {
      console.warn(`[Settlements API] Settlement failed: ${result.error}`);
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({
      txHash: result.txHash ?? null,
      status: "SETTLED",
    });
  } catch (error) {
    console.error("[Settlements API] Internal Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
