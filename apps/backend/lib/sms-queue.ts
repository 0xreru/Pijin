/**
 * @file lib/sms-queue.ts
 *
 * Low-priority SMS (payment receipts, settlement notices) are queued on QStash
 * and delivered by `/api/sms/dispatch`, throttled so they never starve OTPs on
 * the single TextBee SIM. OTPs are sent inline by `/api/otp/send` instead.
 *
 * If QStash is unavailable the message is delivered directly so nothing is lost.
 */

import { Client } from "@upstash/qstash";
import { deliverSms } from "@/lib/sms";

export const SMS_QUEUE_FLOW_KEY = "pijin-sms-notifications";
export const SMS_QUEUE_RATE_PER_MIN = 10;
export const SMS_QUEUE_PARALLELISM = 1;
export const SMS_QUEUE_RETRIES = 3;

export type SmsJob = { to: string; message: string; traceId?: string };

export type EnqueueResult = { queued: true; messageId: string } | { queued: false; delivered: boolean; error?: string };

let qstashClient: Client | null = null;

function getQstash(): Client | null {
  if (!process.env.QSTASH_TOKEN) return null;
  if (!qstashClient) qstashClient = new Client({ token: process.env.QSTASH_TOKEN });
  return qstashClient;
}

/** Same resolution as the SMS webhook: the request host so Vercel previews route to themselves. */
export function resolveAppUrl(req?: Request): string | null {
  const host = req?.headers.get("host");
  if (host) {
    const protocol = host.includes("localhost") ? "http" : "https";
    return `${protocol}://${host}`;
  }
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || null;
}

/** QStash deduplication ids must be URL-safe. */
function toDedupId(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 200);
}

/**
 * Queues an SMS for throttled delivery. Never throws.
 * `dedupKey` makes retries of the calling job (e.g. a QStash-retried settle) send once.
 */
export async function enqueueSms(
  to: string,
  message: string,
  options: { req?: Request; traceId?: string; dedupKey?: string } = {},
): Promise<EnqueueResult> {
  const qstash = getQstash();
  const appUrl = resolveAppUrl(options.req);

  if (qstash && appUrl) {
    try {
      const body: SmsJob = { to, message, traceId: options.traceId };
      const { messageId } = await qstash.publishJSON({
        url: `${appUrl}/api/sms/dispatch`,
        body,
        retries: SMS_QUEUE_RETRIES,
        flowControl: {
          key: SMS_QUEUE_FLOW_KEY,
          rate: SMS_QUEUE_RATE_PER_MIN,
          period: "1m",
          parallelism: SMS_QUEUE_PARALLELISM,
        },
        ...(options.dedupKey ? { deduplicationId: toDedupId(options.dedupKey) } : {}),
      });
      return { queued: true, messageId };
    } catch (err) {
      console.error("[SMS Queue] QStash publish failed, delivering directly:", err);
    }
  } else {
    console.warn("[SMS Queue] QStash or app URL not configured, delivering directly");
  }

  const result = await deliverSms(to, message);
  if (!result.success) console.error(`[SMS Queue] Direct delivery failed: ${result.error}`);
  return { queued: false, delivered: result.success, ...(result.success ? {} : { error: result.error }) };
}
