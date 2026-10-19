/**
 * Backwards-compatible receipt helper. All sending logic (timeouts, retry
 * classification, SIM selection, fallback device) lives in `lib/sms.ts`.
 */
import { deliverSms } from "@/lib/sms";

export async function sendSmsReceipt(
  phoneNumber: string,
  message: string
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  const result = await deliverSms(phoneNumber, message);
  return result.success
    ? { success: true, data: result.data }
    : { success: false, error: result.error };
}
