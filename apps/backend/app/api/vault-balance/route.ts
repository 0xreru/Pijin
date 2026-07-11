import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { pijinContract } from "@/lib/pijin-contract";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const shortId = searchParams.get("shortId")?.trim();
    const publicKeyParam = (searchParams.get("stellarPublicKey") || searchParams.get("publicKey"))?.trim();

    let stellarPublicKey = "";
    let shortIdFound: string | null = null;

    if (shortId) {
      const account = await prisma.account.findUnique({
        where: { shortId },
      });

      if (!account) {
        return NextResponse.json({ error: `Account not found for Short ID: ${shortId}` }, { status: 404 });
      }

      stellarPublicKey = account.stellarPublicKey;
      shortIdFound = account.shortId;
    } else if (publicKeyParam) {
      if (!/^G[A-Z2-7]{55}$/.test(publicKeyParam)) {
        return NextResponse.json({ error: "Invalid Stellar Public Key format" }, { status: 400 });
      }
      stellarPublicKey = publicKeyParam;

      // Look up account to get the associated short ID
      const account = await prisma.account.findUnique({
        where: { stellarPublicKey },
      });
      if (account) {
        shortIdFound = account.shortId;
      }
    } else {
      return NextResponse.json({ error: "Please provide either 'shortId' or 'stellarPublicKey' query parameter" }, { status: 400 });
    }

    let balanceStroops: bigint = BigInt(0);
    try {
      const tx = await pijinContract.get_vault({
        user: stellarPublicKey,
        token: process.env.TOKEN_ID ?? ""
      });

      if (tx && tx.result !== undefined && tx.result !== null) {
        balanceStroops = BigInt(tx.result);
      }
    } catch (sdkError: any) {
      console.error("[Vault Viewer] Soroban SDK get_vault call failed:", sdkError);
      return NextResponse.json({ error: "Failed to read vault balance from Stellar network." }, { status: 502 });
    }

    const balancePHP = Number(balanceStroops) / 10_000_000;

    return NextResponse.json({
      success: true,
      stellarPublicKey,
      shortId: shortIdFound,
      balanceStroops: balanceStroops.toString(),
      balancePHP,
    });

  } catch (error) {
    console.error("[Vault Viewer API]", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}