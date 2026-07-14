/**
 * @swagger
 * /api/wallet/history:
 *   get:
 *     tags:
 *       - Wallet & Balances
 *     summary: Get unified transaction history
 *     description: |
 *       Aggregates transaction history from **three data sources in parallel**:
 *
 *       1. **Offline Settlements** (`Settlement` table) — SMS-based P2P transactions
 *          routed through the offline engine. Maps to `SEND` / `RECEIVE` types.
 *       2. **SEP-24 Anchor Transactions** (`AnchorTransaction` table) — Online
 *          GCash deposits and withdrawals. Maps to `TRANSFER` / `WITHDRAWAL` types.
 *
 *       3. **Online Soroban Transfers** (`OnlineTransfer` table) — Direct wallet
 *          payments. Maps to `SEND` / `RECEIVE` types with a `WALLET` tag.
 *
 *       Results are merged, sorted by timestamp (newest first), and capped at **50 items**.
 *       BigInt `amountStroops` values are converted to decimal strings using pure BigInt
 *       arithmetic to guarantee precision (no floating-point loss).
 *
 *       #### Rate Limiting
 *       **Sliding window — 10 requests per 10 seconds** per IP address.
 *       Keyed as `pijin:api:history`.
 *     parameters:
 *       - in: query
 *         name: shortId
 *         required: true
 *         schema:
 *           type: string
 *         description: The user's 6-character Base62 short ID. Used to query offline settlements.
 *         example: "aB3x9Q"
 *       - in: query
 *         name: publicKey
 *         required: true
 *         schema:
 *           type: string
 *           pattern: '^G[A-Z2-7]{55}$'
 *         description: The user's Stellar public key. Used to query SEP-24 anchor transactions.
 *         example: "GABC1234..."
 *     responses:
 *       '200':
 *         description: Unified transaction list returned successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 transactions:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                         description: Unique transaction ID (DB row ID or anchor UUID).
 *                       type:
 *                         type: string
 *                         enum: [SEND, RECEIVE, TRANSFER, WITHDRAWAL]
 *                       tag:
 *                         type: string
 *                         enum: [WALLET, OFFLINE]
 *                         description: Authoritative transaction channel, independent of direction.
 *                       title:
 *                         type: string
 *                         example: "Sent to aB3x9Q"
 *                       amount:
 *                         type: string
 *                         description: Decimal string. Debits (SEND/WITHDRAWAL) are prefixed with `-`.
 *                         example: "-50.5"
 *                       assetCode:
 *                         type: string
 *                         example: "PHPC"
 *                       status:
 *                         type: string
 *                         example: "SETTLED"
 *                       timestamp:
 *                         type: string
 *                         format: date-time
 *                       txHash:
 *                         type: string
 *                         nullable: true
 *                         description: Stellar transaction hash (only present for settled offline payments).
 *       '400':
 *         description: Missing required `shortId` or `publicKey` parameter.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Missing required parameter(s): shortId, publicKey"
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
 *         description: Database query failed.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Failed to fetch transaction history."
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { AnchorTransaction, Prisma } from '@prisma/client';
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
  prefix: "pijin:api:history",
});

// ---------------------------------------------------------------------------
// TYPES & INTERFACES
// ---------------------------------------------------------------------------
type TransactionType = 'SEND' | 'RECEIVE' | 'TRANSFER' | 'WITHDRAWAL';
type TransactionTag = 'WALLET' | 'OFFLINE';

interface TransactionHistoryItem {
  id: string;
  type: TransactionType;
  tag: TransactionTag;
  title: string;
  amount: string; // Human-readable decimal string. Debits are prefixed with '-'
  assetCode: string;
  status: string; // e.g., 'SETTLED', 'PENDING', 'FAILED'
  timestamp: string; // ISO 8601 string for reliable frontend sorting
  txHash?: string;
}

type SettlementRecord = Prisma.SettlementGetPayload<{ include: { token: true } }> & {
  senderName?: string;
  receiverName?: string;
};

type OnlineTransferRecord = Prisma.OnlineTransferGetPayload<{ include: { token: true } }> & {
  senderName?: string;
  recipientName?: string;
};

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
  
  let settlements: SettlementRecord[] = [];
  let anchorTransactions: AnchorTransaction[] = [];
  let onlineTransfers: OnlineTransferRecord[] = [];

  try {
    [settlements, anchorTransactions, onlineTransfers] = await Promise.all([
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

      // QUERY 3: Direct Online Soroban Transfers
      prisma.onlineTransfer.findMany({
        where: {
          OR: [
            { senderPublicKey: publicKey },
            { recipientPublicKey: publicKey },
          ],
        },
        include: { token: true },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ]);

    // Fetch accounts to resolve names for sender and receiver
    const shortIdsToFetch = new Set<string>();
    settlements.forEach(s => {
      if (s.senderShortId) shortIdsToFetch.add(s.senderShortId);
      if (s.receiverShortId) shortIdsToFetch.add(s.receiverShortId);
    });

    const publicKeysToFetch = new Set<string>();
    onlineTransfers.forEach(t => {
      if (t.senderPublicKey) publicKeysToFetch.add(t.senderPublicKey);
      if (t.recipientPublicKey) publicKeysToFetch.add(t.recipientPublicKey);
    });

    const accounts = await prisma.account.findMany({
      where: {
        OR: [
          { shortId: { in: Array.from(shortIdsToFetch) } },
          { stellarPublicKey: { in: Array.from(publicKeysToFetch) } },
        ],
      },
      select: { shortId: true, stellarPublicKey: true, firstName: true },
    });

    const shortIdAccountMap = new Map<string, string>();
    const publicKeyAccountMap = new Map<string, string>();
    accounts.forEach(acc => {
      const displayName = acc.firstName || acc.shortId;
      shortIdAccountMap.set(acc.shortId, displayName);
      publicKeyAccountMap.set(acc.stellarPublicKey, displayName);
    });

    // We mutate the settlements to include the resolved names for ease of mapping later
    settlements = settlements.map(s => ({
      ...s,
      senderName: shortIdAccountMap.get(s.senderShortId) || s.senderShortId,
      receiverName: shortIdAccountMap.get(s.receiverShortId) || s.receiverShortId,
    }));

    const abbreviatedKey = (key: string) => `${key.slice(0, 6)}...${key.slice(-4)}`;
    onlineTransfers = onlineTransfers.map(t => ({
      ...t,
      senderName: publicKeyAccountMap.get(t.senderPublicKey) || abbreviatedKey(t.senderPublicKey),
      recipientName: publicKeyAccountMap.get(t.recipientPublicKey) || abbreviatedKey(t.recipientPublicKey),
    }));

  } catch (err) {
    console.error('[Wallet History] DB parallel query failed:', err);
    return NextResponse.json({ error: 'Failed to fetch transaction history.' }, { status: 502 });
  }

  // --- 5. MAP SETTLEMENT RECORDS ---
  // We map the raw database rows into our standardized unified `TransactionHistoryItem` interface.
  const settlementItems: TransactionHistoryItem[] = settlements.map((s) => {
    const decimals  = s.token?.decimals ?? 7;
    const assetCode = s.token?.symbol   ?? 'UNKNOWN';
    
    const decimalAmount = stroopsToDecimalString(s.amountStroops, decimals);
    
    // Determine if the user was the sender or receiver
    const isSender = s.senderShortId === shortId;

    return {
      id:        s.id.toString(),
      type:      isSender ? 'SEND' : 'RECEIVE',
      tag:       'OFFLINE',
      title:     isSender ? `Sent to ${s.receiverName}` : `Received from ${s.senderName}`,
      amount:    isSender ? `-${decimalAmount}` : decimalAmount, // Debits show negative
      assetCode,
      status:    s.status,
      timestamp: s.createdAt.toISOString(),
      ...(s.txHash ? { txHash: s.txHash } : {}), // Only include txHash if it exists
    };
  });

  // --- 6. MAP ANCHOR TRANSACTION RECORDS ---
  const anchorItems: TransactionHistoryItem[] = anchorTransactions.map((a) => {
    const isDeposit = a.type === 'deposit';
    
    // SEP-24 semantics: amountOut is the actual crypto the user received. 
    // We fallback to amountIn if amountOut hasn't been set by the anchor yet.
    const rawAmount = a.amountOut ?? a.amountIn ?? '0';

    return {
      id:        a.id,
      type:      isDeposit ? 'TRANSFER' : 'WITHDRAWAL', 
      tag:       'WALLET',
      title:     isDeposit ? 'Wallet Transfer' : 'Wallet Withdrawal',
      amount:    isDeposit ? rawAmount : `-${rawAmount}`,
      assetCode: a.assetCode,
      status:    a.status,
      timestamp: a.createdAt.toISOString(),
    };
  });

  // --- 7. MAP DIRECT ONLINE TRANSFERS ---
  const onlineTransferItems: TransactionHistoryItem[] = onlineTransfers.map((t) => {
    const isSender = t.senderPublicKey === publicKey;
    const decimals = t.token?.decimals ?? 7;
    const decimalAmount = stroopsToDecimalString(t.amountStroops, decimals);

    return {
      id:        `online:${t.id}`,
      type:      isSender ? 'SEND' : 'RECEIVE',
      tag:       'WALLET',
      title:     isSender ? `Sent to ${t.recipientName}` : `Received from ${t.senderName}`,
      amount:    isSender ? `-${decimalAmount}` : decimalAmount,
      assetCode: t.token?.symbol ?? 'UNKNOWN',
      status:    t.status,
      timestamp: (t.confirmedAt ?? t.createdAt).toISOString(),
      txHash:    t.txHash,
    };
  });

  // --- 8. COMBINE, SORT, AND CULL ---
  const transactions = [...settlementItems, ...anchorItems, ...onlineTransferItems]
    // Sort everything universally by Timestamp (Newest first)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    // Enforce the ultimate limit of 50 items returning to the client to ensure mobile UI snappiness
    .slice(0, 50);

  console.info(`[Wallet History API] Refreshed | shortId=${shortId} | itemsReturned=${transactions.length}`);

  // SUCCESS: BigInts have already been safely converted to strings!
  return NextResponse.json({ transactions });
}
