/**
 * @swagger
 * /api/settlements:
 *   post:
 *     tags:
 *       - Offline Engine
 *     summary: Process an offline SMS payment settlement (direct path)
 *     description: |
 *       Directly processes an offline SMS payment payload without going through the
 *       QStash message broker. This is the **synchronous path** used for testing or
 *       direct client calls.
 *
 *       **Payload format** (`smsBody` string, colon-delimited, exactly 6 parts):
 *       ```
 *       <tokenId>:<senderShortId>:<receiverShortId>:<amountBase62>:<nonce>:<signature>
 *       ```
 *
 *       **Idempotency:** The `nonce` (part 5) is checked against the `Settlement` table.
 *       If already processed, returns `409 Conflict` with the existing `txHash` and `status`.
 *
 *       > **In production**, prefer `/api/sms/webhook` → QStash → `/api/engine/settle`
 *       > which provides retry guarantees, deduplication, and signature verification.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [smsBody]
 *             properties:
 *               smsBody:
 *                 type: string
 *                 description: Raw colon-delimited SMS payment payload (exactly 6 parts).
 *                 example: "1:aB3x9Q:Zx7mNk:3v5K:base64nonce==:base64sig=="
 *     responses:
 *       '200':
 *         description: Settlement processed and on-chain transaction confirmed.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 txHash:
 *                   type: string
 *                   nullable: true
 *                   description: Stellar transaction hash if settlement succeeded.
 *                 status:
 *                   type: string
 *                   example: "SETTLED"
 *       '400':
 *         description: Missing `smsBody` or malformed payload (fewer than 6 colon-separated parts).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *               examples:
 *                 missing: { value: { error: "Missing smsBody" } }
 *                 malformed: { value: { error: "Malformed smsBody" } }
 *       '409':
 *         description: Duplicate nonce — this transaction has already been processed.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 txHash:
 *                   type: string
 *                   nullable: true
 *                 status:
 *                   type: string
 *       '500':
 *         description: Internal server error.
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
import { processOfflineSettlement } from "@/lib/settlement";
import { parseOfflineVoucher } from "@/lib/offline-voucher";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { smsBody } = body;

    if (!smsBody) {
      return NextResponse.json({ error: "Missing smsBody" }, { status: 400 });
    }

    let nonce: string;
    try {
      nonce = parseOfflineVoucher(smsBody).nonceB64;
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Malformed smsBody" },
        { status: 400 },
      );
    }

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
