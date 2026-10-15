/**
 * Dev-only inspector for the offline SMS voucher the app hands to the native
 * SMS composer. The app never signs a webhook HMAC — the Textbee gateway phone
 * does that when it forwards the received SMS to /api/sms/webhook — so this
 * logs what the *client* sends, to compare against what the server received.
 *
 * Voucher: tokenId:senderShortId:receiverShortId:amountBase62:nonceB64:signatureB64
 * Contains no wallet secrets (the Ed25519 secret key is never part of it).
 */
const MAX_SMS_BODY_CHARS = 300; // mirrors MAX_SMS_BODY_CHARS in the backend webhook

export function debugSmsSend(source: string, gateway: string, payload: string, url: string): void {
  if (!__DEV__) return;

  const parts = payload.split(':');
  const issues: string[] = [];
  if (parts.length !== 6) issues.push(`expected 6 colon-separated parts, got ${parts.length}`);
  if (payload !== payload.trim()) issues.push('payload has leading/trailing whitespace');
  if (/[^\x20-\x7e]/.test(payload)) issues.push('payload has non-ASCII characters (SMS may re-encode to UCS-2)');
  if (payload.length > MAX_SMS_BODY_CHARS) issues.push(`payload ${payload.length} chars > backend limit ${MAX_SMS_BODY_CHARS}`);
  if (parts.some((p) => p.length === 0)) issues.push('one or more parts are empty');

  console.log(
    `[SMS Debug] source=${source} gateway=${gateway} payloadLen=${payload.length} urlLen=${url.length} ` +
      `parts=${parts.length} partLens=${parts.map((p) => p.length).join('/')} ` +
      `tokenId=${parts[0] ?? ''} sender=${parts[1] ?? ''} receiver=${parts[2] ?? ''} amountB62=${parts[3] ?? ''} ` +
      `nonceHead=${(parts[4] ?? '').slice(0, 8)} sigHead=${(parts[5] ?? '').slice(0, 8)}`,
  );
  console.log(`[SMS Debug] payload=${payload}`);
  console.log(`[SMS Debug] url=${url}`);
  if (issues.length) console.warn(`[SMS Debug] ISSUES: ${issues.join('; ')}`);
}
