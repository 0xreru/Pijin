/**
 * @swagger
 * /api/wallet/balance:
 *   get:
 *     tags:
 *       - Wallet & Balances
 *     summary: Get on-chain Stellar wallet balance (online wallet)
 *     description: |
 *       Fetches the **Horizon Testnet** balance for a given Stellar account and
 *       asset code. Queries the `balances` array on the account record and locates
 *       the trustline matching the requested asset and its known issuer address.
 *
 *       **Supported assets:**
 *       | Code | Testnet Issuer |
 *       |------|---------------|
 *       | PHPC | `GDDKZAOAME26SD2GAQGGDUTI6F5VQ5CLXXELWOYOAXLUIQTQVLIFWZLY` |
 *       | USDC | `GDQGJU5JTW5IFCGS6JZTIGK57IKPW4N4LJWWEN7F3K3GSEJEYPVJ3BYA` |
 *
 *       **Graceful degradation:**
 *       - Account not found on Horizon (unfunded) → `{ balance: "0.00" }` (not an error).
 *       - Trustline not established → `{ balance: "0.00" }` (not an error).
 *
 *       #### Rate Limiting
 *       **Sliding window — 10 requests per 10 seconds** per IP address.
 *       Keyed as `pijin:api:balance`.
 *     parameters:
 *       - in: query
 *         name: publicKey
 *         required: true
 *         schema:
 *           type: string
 *           pattern: '^G[A-Z2-7]{55}$'
 *         description: The Stellar Ed25519 public key of the account to query.
 *         example: "GABC1234..."
 *       - in: query
 *         name: assetCode
 *         required: true
 *         schema:
 *           type: string
 *           enum: [PHPC, USDC]
 *         description: The asset code to query. Case-insensitive (normalised to uppercase).
 *         example: "PHPC"
 *     responses:
 *       '200':
 *         description: Balance retrieved (or zero if account/trustline not found).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 balance:
 *                   type: string
 *                   description: Decimal balance string as returned by Horizon (e.g. "100.0000000").
 *                   example: "250.5000000"
 *       '400':
 *         description: Missing or invalid query parameters.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *               examples:
 *                 missingKey: { value: { error: "Missing required query parameter: publicKey" } }
 *                 badKey: { value: { error: "Invalid Stellar public key format." } }
 *                 missingAsset: { value: { error: "Missing required query parameter: assetCode" } }
 *                 badAsset: { value: { error: "Unsupported asset code: 'XLM'. Supported assets: PHPC, USDC" } }
 *       '429':
 *         description: Rate limit exceeded.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Too many requests. Please try again later."
 *       '502':
 *         description: Horizon network error (non-404).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Failed to load account from Stellar network."
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
import { Horizon } from "@stellar/stellar-sdk";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

export const runtime = "nodejs";

// --- Rate Limiter Setup (Tier 1 Shield) ---
// Sliding window: 10 requests per 10 seconds per IP address
const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(10, "10 s"),
  analytics: false,
  prefix: "pijin:api:balance",
});

// Horizon Testnet server instance
const server = new Horizon.Server("https://horizon-testnet.stellar.org");

// Supported asset issuers on Testnet
const ASSET_ISSUERS: Record<string, string> = {
  PHPC: "GDDKZAOAME26SD2GAQGGDUTI6F5VQ5CLXXELWOYOAXLUIQTQVLIFWZLY",
  USDC: "GDQGJU5JTW5IFCGS6JZTIGK57IKPW4N4LJWWEN7F3K3GSEJEYPVJ3BYA",
};

export async function GET(req: NextRequest) {
  try {
    // --- 1. IP-Based Rate Limiting (Spam & DDoS Protection) ---
    const ip = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "127.0.0.1";
    const { success } = await ratelimit.limit(ip);
    
    if (!success) {
      console.warn(`[Wallet Balance API] Rate limit exceeded for IP: ${ip}`);
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429 }
      );
    }

    // --- 2. Extract Params ---
    const { searchParams } = new URL(req.url);
    const publicKey = searchParams.get("publicKey")?.trim();
    const assetCode = searchParams.get("assetCode")?.trim().toUpperCase();

    // --- 3. Input Validation ---
    if (!publicKey) {
      return NextResponse.json(
        { error: "Missing required query parameter: publicKey" },
        { status: 400 }
      );
    }

    if (!/^G[A-Z2-7]{55}$/.test(publicKey)) {
      return NextResponse.json(
        { error: "Invalid Stellar public key format." },
        { status: 400 }
      );
    }

    if (!assetCode) {
      return NextResponse.json(
        { error: "Missing required query parameter: assetCode" },
        { status: 400 }
      );
    }

    const issuer = ASSET_ISSUERS[assetCode];
    if (!issuer) {
      return NextResponse.json(
        {
          error: `Unsupported asset code: '${assetCode}'. Supported assets: ${Object.keys(ASSET_ISSUERS).join(", ")}`,
        },
        { status: 400 }
      );
    }

    // --- 4. Fetch Account from Horizon ---
    // By nesting this inside a try block, TypeScript perfectly infers the 
    // AccountResponse type natively from the v15 SDK without breaking.
    try {
      const account = await server.loadAccount(publicKey);
      
      // --- 5. Find the Matching Trustline Balance ---
      // We use 'any' here to bypass the missing BalanceLine type export in v15
      const trustlineBalance = account.balances.find((b: any) => {
        if (b.asset_type === "native") return false;
        return b.asset_code === assetCode && b.asset_issuer === issuer;
      });

      // If the account exists but hasn't established this trustline yet, return zero.
      if (!trustlineBalance) {
        console.info(
          `[Wallet Balance] No trustline found for ${assetCode} on account ${publicKey}`
        );
        return NextResponse.json({ balance: "0.00" });
      }

      return NextResponse.json({ balance: trustlineBalance.balance });

    } catch (err: any) {
      // A 404 from Horizon means the account is unfunded — treat as zero balance.
      // This is expected for newly generated keypairs that haven't received XLM yet.
      if (err?.response?.status === 404) {
        console.info(
          `[Wallet Balance] Account not found on Horizon (unfunded): ${publicKey}`
        );
        return NextResponse.json({ balance: "0.00" });
      }

      // Any other Horizon error is an upstream failure.
      console.error("[Wallet Balance] Horizon loadAccount error:", err);
      return NextResponse.json(
        { error: "Failed to load account from Stellar network." },
        { status: 502 }
      );
    }

  } catch (error) {
    console.error("[Wallet Balance API] Unexpected error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}