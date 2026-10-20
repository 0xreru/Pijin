
/**
 * @swagger
 * /api/sms/dispatch:
 *   post:
 *     tags:
 *       - SMS Gateway
 *     summary: QStash worker that delivers queued notification SMS
 *     description: |
 *       Internal endpoint invoked **only by QStash** (signature verified with
 *       `QSTASH_CURRENT_SIGNING_KEY` / `QSTASH_NEXT_SIGNING_KEY`). Jobs are published by
 *       `enqueueSms()` with flow control (10 / min, parallelism 1) so receipts never
 *       starve OTP delivery on the TextBee SIM.
 *
 *       - `200` delivered, or permanently undeliverable (no retry).
 *       - `500` transient gateway failure → QStash retries, then dead-letters.
 *     security:
 *       - QStashSignature: []
 *     responses:
 *       '200':
 *         description: Delivered or permanently failed.
 *       '400':
 *         description: Malformed job body.
 *       '401':
 *         description: Missing or invalid QStash signature.
 *       '500':
 *         description: Transient failure; QStash will retry.
 */
import { NextResponse } from "next/server";
import { verifyQStashSignature } from "@/lib/qstash-security";
import { deliverSms } from "@/lib/sms";
import { maskPhoneNumber } from "@/lib/sms-security";
import type { SmsJob } from "@/lib/sms-queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const rawBody = await req.text();

  const verification = await verifyQStashSignature(req, rawBody);
  if (!verification.valid) {
    console.warn(`[SMS Dispatch] Rejected: ${verification.error}`);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let job: SmsJob;
  try {
    job = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof job?.to !== "string" || typeof job?.message !== "string" || !job.message) {
    return NextResponse.json({ error: "Job requires `to` and `message`" }, { status: 400 });
  }

  // QStash owns retries; one gateway attempt per device keeps the function short.
  const result = await deliverSms(job.to, job.message, { retries: 0, deadlineMs: 9_000 });
  const trace = job.traceId ? ` traceId=${job.traceId}` : "";

  if (result.success) {
    console.info(`[SMS Dispatch] Delivered to ${maskPhoneNumber(job.to)} via ${result.gateway}${trace}`);
    return NextResponse.json({ success: true });
  }

  if (result.retryable) {
    console.warn(`[SMS Dispatch] Transient failure for ${maskPhoneNumber(job.to)}: ${result.error}${trace}`);
    return NextResponse.json({ error: "SMS delivery failed, will retry" }, { status: 500 });
  }

  console.error(`[SMS Dispatch] Permanent failure for ${maskPhoneNumber(job.to)}: ${result.error}${trace}`);
  return NextResponse.json({ success: false, error: "Undeliverable" });
}
