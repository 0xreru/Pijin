import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { abotPeraContract } from "@/lib/omnifi-contract";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const shortId = searchParams.get("shortId")?.trim();
    const publicKeyParam = (searchParams.get("stellarPublicKey") || searchParams.get("publicKey"))?.trim();

    let stellarPublicKey = "";
    let shortIdFound: string | null = null;

    // 1. Resolve Stellar Public Key from the parameters
    if (shortId) {
      const account = await prisma.account.findUnique({
        where: { shortId },
      });

      if (!account) {
        return NextResponse.json(
          { error: `Account not found for Short ID: ${shortId}` },
          { status: 404 }
        );
      }

      stellarPublicKey = account.stellarPublicKey;
      shortIdFound = account.shortId;
    } else if (publicKeyParam) {
      // Basic Stellar Public Key format validation
      if (!/^G[A-Z2-7]{55}$/.test(publicKeyParam)) {
        return NextResponse.json(
          { error: "Invalid Stellar Public Key format" },
          { status: 400 }
        );
      }
      stellarPublicKey = publicKeyParam;

      // Try to find if this key has an associated shortId in our DB
      const account = await prisma.account.findUnique({
        where: { stellarPublicKey },
      });
      if (account) {
        shortIdFound = account.shortId;
      }
    } else {
      return NextResponse.json(
        { error: "Please provide either 'shortId' or 'stellarPublicKey' / 'publicKey' query parameter" },
        { status: 400 }
      );
    }

    console.log(`[Vault Viewer] Querying vault balance for key: ${stellarPublicKey}`);

    // 2. Query the Soroban Smart Contract via the abotpera-sdk
    let balanceStroops: bigint = BigInt(0);
    try {
      const tx = await abotPeraContract.get_vault({
        customer: stellarPublicKey,
      });

      // tx.result will contain the i128 returned from the contract simulation
      if (tx && tx.result !== undefined && tx.result !== null) {
        balanceStroops = BigInt(tx.result);
      }
    } catch (sdkError: any) {
      console.error("[Vault Viewer] Soroban SDK get_vault call failed:", sdkError);
      return NextResponse.json(
        { error: "Failed to read vault balance from Stellar network. Network might be busy or unreachable." },
        { status: 502 }
      );
    }

    // 3. Divide by 10,000,000 to convert Stellar Stroops to PHP
    const balancePHP = Number(balanceStroops) / 10_000_000;

    return NextResponse.json({
      success: true,
      stellarPublicKey,
      shortId: shortIdFound,
      balanceStroops: balanceStroops.toString(),
      balancePHP,
    });

  } catch (error: any) {
    console.error("[Vault Viewer API Error]:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
