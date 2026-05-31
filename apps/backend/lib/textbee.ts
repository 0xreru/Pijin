/**
 * Reusable helper function to trigger the final SMS receipt to the merchant/customer.
 * Makes POST request to configured SMS gateway endpoint.
 */
export async function sendSmsReceipt(
  phoneNumber: string,
  message: string
): Promise<{ success: boolean; data?: any; error?: string }> {
  console.log(`[Textbee] Preparing to send SMS to ${phoneNumber}: "${message}"`);

  // Preferred: explicit gateway URL override.
  // Default: official Textbee endpoint derived from TEXTBEE_DEVICE_ID.
  const deviceId = process.env.TEXTBEE_DEVICE_ID?.trim();
  const gatewayUrl =
    process.env.TEXTBEE_GATEWAY_URL ??
    (deviceId
      ? `https://api.textbee.dev/api/v1/gateway/devices/${deviceId}/send-sms`
      : process.env.TEXTBEE_TAILSCALE_URL);
  const apiKey = process.env.TEXTBEE_API_KEY;
  const simSubscriptionIdRaw = process.env.TEXTBEE_SIM_SUBSCRIPTION_ID;
  const simSubscriptionId =
    simSubscriptionIdRaw && simSubscriptionIdRaw.trim().length > 0
      ? Number.parseInt(simSubscriptionIdRaw, 10)
      : undefined;
  const timeoutMs = Number.parseInt(process.env.TEXTBEE_TIMEOUT_MS ?? "4500", 10);
  const maxRetries = Number.parseInt(process.env.TEXTBEE_RETRIES ?? "2", 10);

  if (!gatewayUrl) {
    return {
      success: false,
      error: "Missing TEXTBEE endpoint config (set TEXTBEE_GATEWAY_URL or TEXTBEE_DEVICE_ID)",
    };
  }
  if (!apiKey) {
    return {
      success: false,
      error: "Missing TEXTBEE_API_KEY",
    };
  }

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    };

    const payload = {
      recipients: [phoneNumber],
      message,
      ...(Number.isInteger(simSubscriptionId)
        ? { simSubscriptionId }
        : {}),
    };

    console.log(`[Textbee] Sending POST to SMS Gateway at: ${gatewayUrl}`);
    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      let response: Response;
      try {
        response = await fetch(gatewayUrl, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (networkError: any) {
        console.error(
          `[Textbee] Network error on attempt ${attempt}/${maxRetries + 1}:`,
          networkError?.message ?? networkError
        );
        if (attempt <= maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
          continue;
        }
        const causeCode = networkError?.cause?.code ? ` (${networkError.cause.code})` : "";
        return {
          success: false,
          error: `${networkError?.message || "Gateway unreachable"}${causeCode}`,
        };
      }

      if (!response.ok) {
        const errText = await response.text();
        console.error(
          `[Textbee] Gateway status ${response.status} on attempt ${attempt}/${maxRetries + 1}:`,
          errText
        );
        if (attempt <= maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
          continue;
        }
        return {
          success: false,
          error: `HTTP ${response.status}: ${errText || "Unknown Gateway error"}`,
        };
      }

      let responseData: any = null;
      try {
        responseData = await response.json();
      } catch {
        responseData = { message: "No JSON response" };
      }

      console.log("[Textbee] SMS sent successfully via Android Gateway!");
      return {
        success: true,
        data: responseData,
      };
    }
    return {
      success: false,
      error: "Exhausted retry attempts",
    };

  } catch (error: any) {
    const causeCode = error?.cause?.code ? ` (${error.cause.code})` : "";
    console.error("[Textbee] Failed to send SMS via Gateway:", error);
    return {
      success: false,
      error: `${error.message || "Failed to connect to local Tailscale Android Gateway"}${causeCode}`,
    };
  }
}
