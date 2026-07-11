/**
 * @swagger
 * /api/vault-balance:
 *   get:
 *     tags:
 *       - Wallet & Balances
 *     summary: Get Soroban vault balance (offline wallet)
 *     description: |
 *       Queries the Pijin **Soroban smart contract** (`get_vault`) to return the
 *       on-chain offline vault balance for a user. The vault stores the spendable
 *       balance managed by the offline P2P payment engine.
 *
 *       You can look up the account by either:
 *       - `shortId` — resolves to a `stellarPublicKey` via the Prisma `Account` table, **or**
 *       - `stellarPublicKey` / `publicKey` — queried directly.
 *
 *       The raw Soroban result is in **stroops** (1/10,000,000 of a token unit).
 *       The response includes both the raw stroops and the human-readable `balancePHP`.
 *     parameters:
 *       - in: query
 *         name: shortId
 *         required: false
 *         schema:
 *           type: string
 *         description: The user's 6-character Base62 short ID (e.g. `aB3x9Q`). Mutually exclusive with `stellarPublicKey`.
 *         example: "aB3x9Q"
 *       - in: query
 *         name: stellarPublicKey
 *         required: false
 *         schema:
 *           type: string
 *           pattern: '^G[A-Z2-7]{55}$'
 *         description: Stellar Ed25519 public key. Also accepted as `publicKey`.
 *         example: "GABC1234..."
 *     responses:
 *       '200':
 *         description: Vault balance retrieved successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 stellarPublicKey:
 *                   type: string
 *                   example: "GABC1234..."
 *                 shortId:
 *                   type: string
 *                   nullable: true
 *                   example: "aB3x9Q"
 *                 balanceStroops:
 *                   type: string
 *                   description: Raw vault balance in stroops (serialised BigInt to avoid JS precision loss).
 *                   example: "1000000000"
 *                 balancePHP:
 *                   type: number
 *                   description: Human-readable balance (stroops / 10,000,000).
 *                   example: 100.0
 *       '400':
 *         description: Neither `shortId` nor `stellarPublicKey` provided, or invalid public key format.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *       '404':
 *         description: Account not found for the given `shortId`.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *       '502':
 *         description: Soroban RPC call to the Stellar network failed.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Failed to read vault balance from Stellar network."
 *       '500':
 *         description: Unexpected internal server error.
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
import { pijinContract } from "@/lib/pijin-contract";
import { Horizon } from "@stellar/stellar-sdk";

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
      const server = new Horizon.Server(process.env.SOROBAN_RPC_URL?.replace("soroban-testnet", "horizon-testnet") ?? "https://horizon-testnet.stellar.org");
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