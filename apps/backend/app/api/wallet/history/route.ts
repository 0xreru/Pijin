import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// RATE LIMITER SETUP (Tier 1 Shield)
// ---------------------------------------------------------------------------
// We use a sliding window of 10 requests per 10 seconds per IP address.
// Since this is a public GET route, this strictly prevents malicious bots 
// from spamming the endpoint, exhausting Vercel invocations or Neon DB connections.
const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(10, "10 s"),
  analytics: false,
  prefix: "omnifi:api:history",
});

// ---------------------------------------------------------------------------
// TYPES & INTERFACES
// ---------------------------------------------------------------------------
type TransactionType = 'SEND' | 'RECEIVE' | 'TRANSFER' | 'WITHDRAWAL';

interface TransactionHistoryItem {
  id: string;
  type: TransactionType;
  title: string;
  amount: string; // Human-readable decimal string. Debits are prefixed with '-'
  assetCode: string;
  status: string; // e.g., 'SETTLED', 'PENDING', 'FAILED'
  timestamp: string; // ISO 8601 string for reliable frontend sorting
  txHash?: string;
}

// ---------------------------------------------------------------------------
// HELPER: PURE BIGINT MATH FOR DECIMALS
// ---------------------------------------------------------------------------
/**
 * Converts a BigInt of stroops (Stellar's smallest unit) to a formatted decimal string.
 * * WHY THIS MATTERS: 
 * JavaScript's `Number` type loses precision on very large numbers. By using pure 
 * BigInt arithmetic here, we mathematically divide and format the string without 
 * EVER touching a floating-point number, guaranteeing 100% precision.
 * * @param stroops - The raw amount in stroops (e.g., 10000000n for 1 XLM/PHPC)
 * @param decimals - The asset's decimal places (Stellar defaults to 7)
 */
function stroopsToDecimalString(stroops: bigint, decimals: number = 7): string {
  const divisor = BigInt(10 ** decimals);
  const whole = stroops / divisor;
  const remainder = stroops % divisor;

  // Pad the remainder to ensure correct decimal places (e.g., '5' becomes '0000005')
  // Then replace trailing zeros to keep the display clean.
  const fractional = remainder.toString().padStart(decimals, '0').replace(/0+$/, '');

  if (fractional.length === 0) {
    return whole.toString();
  }

  return `${whole}.${fractional}`;
}

// ---------------------------------------------------------------------------
// GET HANDLER: /api/wallet/history
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  // --- 1. IP-BASED RATE LIMITING ---
  // We extract the IP. Since NextRequest types can occasionally drop '.ip', 
  // we securely fall back to the Vercel standard 'x-forwarded-for' header.
  const ip = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "127.0.0.1";
  const { success } = await ratelimit.limit(ip);
  
  if (!success) {
    console.warn(`[Wallet History API] Rate limit exceeded for IP: ${ip}`);
    return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 });
  }

  // --- 2. EXTRACT PARAMETERS ---
  const { searchParams } = new URL(req.url);
  const shortId   = searchParams.get('shortId')?.trim();
  const publicKey = searchParams.get('publicKey')?.trim();

  // --- 3. INPUT VALIDATION ---
  if (!shortId || !publicKey) {
    const missing = [!shortId && 'shortId', !publicKey && 'publicKey'].filter(Boolean).join(', ');
    return NextResponse.json({ error: `Missing required parameter(s): ${missing}` }, { status: 400 });
  }

  // --- 4. PARALLEL DATA FETCH (API-Level Aggregation) ---
  // Instead of storing a duplicate "TransactionHistory" table, we query both the 
  // offline Settlement table and online AnchorTransaction table simultaneously.
  // Promise.all ensures both queries run at the exact same time, halving response time.
  
  let settlements: any[] = [];
  let anchorTransactions: any[] = [];

  try {
    [settlements, anchorTransactions] = await Promise.all([
      // QUERY 1: Offline SMS Settlements
      prisma.settlement.findMany({
        where: {
          OR: [
            { senderShortId: shortId },
            { receiverShortId: shortId }
          ],
        },
        include: { token: true }, // Joins the Token table to grab asset symbol & decimals
        orderBy: { createdAt: 'desc' },
        take: 50, // Pagination limits. Prevents memory overflow on large accounts!
      }),

      // QUERY 2: Online SEP-24 Anchor Transactions (Top-Ups / Withdrawals)
      prisma.anchorTransaction.findMany({
        where: { stellarAccount: publicKey },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ]);
  } catch (err) {
    console.error('[Wallet History] DB parallel query failed:', err);
    return NextResponse.json({ error: 'Failed to fetch transaction history.' }, { status: 502 });
  }

  // --- 5. MAP SETTLEMENT RECORDS ---
  // We map the raw database rows into our standardized unified `TransactionHistoryItem` interface.
  const settlementItems: TransactionHistoryItem[] = settlements.map((s: any) => {
    const decimals  = s.token?.decimals ?? 7;
    const assetCode = s.token?.symbol   ?? 'UNKNOWN';
    
    const decimalAmount = stroopsToDecimalString(s.amountStroops, decimals);
    
    // Determine if the user was the sender or receiver
    const isSender = s.senderShortId === shortId;

    return {
      id:        s.id.toString(),
      type:      isSender ? 'SEND' : 'RECEIVE',
      title:     isSender ? `Sent to ${s.receiverShortId}` : `Received from ${s.senderShortId}`,
      amount:    isSender ? `-${decimalAmount}` : decimalAmount, // Debits show negative
      assetCode,
      status:    s.status,
      timestamp: s.createdAt.toISOString(),
      ...(s.txHash ? { txHash: s.txHash } : {}), // Only include txHash if it exists
    };
  });

  // --- 6. MAP ANCHOR TRANSACTION RECORDS ---
  const anchorItems: TransactionHistoryItem[] = anchorTransactions.map((a: any) => {
    const isDeposit = a.type === 'deposit';
    
    // SEP-24 semantics: amountOut is the actual crypto the user received. 
    // We fallback to amountIn if amountOut hasn't been set by the anchor yet.
    const rawAmount = a.amountOut ?? a.amountIn ?? '0';

    return {
      id:        a.id,
      type:      isDeposit ? 'TRANSFER' : 'WITHDRAWAL', 
      title:     isDeposit ? 'Wallet Transfer' : 'Wallet Withdrawal',
      amount:    isDeposit ? rawAmount : `-${rawAmount}`,
      assetCode: a.assetCode,
      status:    a.status,
      timestamp: a.createdAt.toISOString(),
    };
  });

  // --- 7. COMBINE, SORT, AND CULL ---
  const transactions = [...settlementItems, ...anchorItems]
    // Sort everything universally by Timestamp (Newest first)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    // Enforce the ultimate limit of 50 items returning to the client to ensure mobile UI snappiness
    .slice(0, 50);

  console.info(`[Wallet History API] Refreshed | shortId=${shortId} | itemsReturned=${transactions.length}`);

  // SUCCESS: BigInts have already been safely converted to strings!
  return NextResponse.json({ transactions });
}