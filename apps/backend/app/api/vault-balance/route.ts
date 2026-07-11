import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { pijinContract } from "@/lib/pijin-contract";
import { Horizon } from "@stellar/stellar-sdk";

const HORIZON_URL = process.env.SOROBAN_RPC_URL?.replace("soroban-testnet", "horizon-testnet") ?? "https://horizon-testnet.stellar.org";
const server = new Horizon.Server(HORIZON_URL);

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
    let balancePHP: number = 0;

    try {
      const account = await server.loadAccount(stellarPublicKey);
      
      const issuer = process.env.PHPC_ISSUER_PUBKEY ?? "GDDKZAOAME26SD2GAQGGDUTI6F5VQ5CLXXELWOYOAXLUIQTQVLIFWZLY";
      const trustlineBalance = account.balances.find((b: any) => {
        if (b.asset_type === "native") return false;
        return b.asset_code === "PHPC" && b.asset_issuer === issuer;
      });

      if (trustlineBalance) {
        balancePHP = parseFloat(trustlineBalance.balance);
        balanceStroops = BigInt(Math.round(balancePHP * 10_000_000));
      }
    } catch (err: any) {
      if (err?.response?.status === 404) {
        console.info(`[Vault Balance API] Account not found on Horizon: ${stellarPublicKey}`);
      } else {
        console.error("[Vault Balance API] Horizon loadAccount error:", err);
        return NextResponse.json({ error: "Failed to read balance from Stellar network." }, { status: 502 });
      }
    }

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