import { randomUUID } from 'node:crypto';
import type { ParsedOfflineVoucher } from '@/lib/offline-voucher';

const REDACTED_HEADER_NAMES = new Set([
  'authorization',
  'cookie',
  'proxy-authorization',
  'set-cookie',
  'upstash-signature',
  'x-api-key',
  'x-signature',
  'x-textbee-signature',
]);

export function isOfflineTransactionDebugEnabled(): boolean {
  return process.env.OFFLINE_TRANSACTION_DEBUG?.trim().toLowerCase() === 'true';
}

export function createOfflineTransactionTraceId(): string {
  return `offline-${randomUUID()}`;
}

export function sanitizeOfflineDebugUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    if (url.searchParams.has('secret')) {
      url.searchParams.set('secret', '[REDACTED]');
    }
    return url.toString();
  } catch {
    return rawUrl.replace(/([?&]secret=)[^&]*/gi, '$1[REDACTED]');
  }
}

export function sanitizeOfflineDebugHeaders(headers: Headers): Record<string, string> {
  return Object.fromEntries(
    Array.from(headers.entries(), ([name, value]) => [
      name,
      REDACTED_HEADER_NAMES.has(name.toLowerCase())
        ? `[REDACTED; ${value.length} chars]`
        : value,
    ]),
  );
}

function debugJson(value: unknown): string {
  const seen = new WeakSet<object>();

  return JSON.stringify(
    value,
    (_key, nestedValue: unknown) => {
      if (typeof nestedValue === 'bigint') return nestedValue.toString();
      if (nestedValue instanceof Error) {
        return {
          name: nestedValue.name,
          message: nestedValue.message,
          stack: nestedValue.stack,
        };
      }
      if (Buffer.isBuffer(nestedValue)) {
        return {
          byteLength: nestedValue.length,
          base64: nestedValue.toString('base64'),
          hex: nestedValue.toString('hex'),
        };
      }
      if (nestedValue instanceof Uint8Array) {
        const bytes = Buffer.from(nestedValue);
        return {
          byteLength: bytes.length,
          base64: bytes.toString('base64'),
          hex: bytes.toString('hex'),
        };
      }
      if (nestedValue && typeof nestedValue === 'object') {
        if (seen.has(nestedValue)) return '[Circular]';
        seen.add(nestedValue);
      }
      return nestedValue;
    },
    2,
  ) ?? 'null';
}

/**
 * Emits one grep-friendly, structured entry for the offline voucher demo.
 * Detailed logs are deliberately opt-in because SMS bodies contain payment
 * metadata and signatures. Authentication and private signing secrets are
 * never accepted by this logger.
 */
export function logOfflineTransactionDebug(
  traceId: string,
  stage: string,
  details: Record<string, unknown>,
): void {
  if (!isOfflineTransactionDebugEnabled()) return;

  console.log(
    `[OfflineVoucher:backend:${stage}] ${debugJson({
      traceId,
      timestamp: new Date().toISOString(),
      ...details,
    })}`,
  );
}

export function logOfflineVoucherDecompression(
  traceId: string,
  smsPayload: string,
  voucher: ParsedOfflineVoucher,
): void {
  if (!isOfflineTransactionDebugEnabled()) return;

  const parts = smsPayload.trim().split(':');
  const paddedNonce = voucher.nonceB64 + '='.repeat((4 - (voucher.nonceB64.length % 4)) % 4);
  const paddedSignature = voucher.signatureB64 + '='.repeat((4 - (voucher.signatureB64.length % 4)) % 4);

  logOfflineTransactionDebug(traceId, 'decompress-1:parts', {
    smsBody: smsPayload,
    payloadCharLength: smsPayload.length,
    partCount: parts.length,
    tokenIdStr: voucher.tokenIdStr,
    senderShortId: voucher.senderShortId,
    receiverShortId: voucher.receiverShortId,
    amountBase62: voucher.amountBase62,
    nonceB64: voucher.nonceB64,
    signatureB64: voucher.signatureB64,
    partCharLengths: parts.map((part) => part.length),
  });

  logOfflineTransactionDebug(traceId, 'decompress-1:amount', {
    amountBase62: voucher.amountBase62,
    amountBase62CharLength: voucher.amountBase62.length,
    amountStroops: voucher.amountStroops,
    amountDecimalCharLength: voucher.amountStroops.toString().length,
  });

  logOfflineTransactionDebug(traceId, 'decompress-2:base64', {
    nonceB64Unpadded: voucher.nonceB64,
    nonceB64UnpaddedCharLength: voucher.nonceB64.length,
    nonceB64Padded: paddedNonce,
    nonceB64PaddedCharLength: paddedNonce.length,
    nonceDecodedByteLength: voucher.nonce.length,
    nonceDecodedHex: voucher.nonce.toString('hex'),
    signatureB64Unpadded: voucher.signatureB64,
    signatureB64UnpaddedCharLength: voucher.signatureB64.length,
    signatureB64Padded: paddedSignature,
    signatureB64PaddedCharLength: paddedSignature.length,
    signatureDecodedByteLength: voucher.signature.length,
    signatureDecodedHex: voucher.signature.toString('hex'),
  });
}
