import { OfflinePaymentPayload, LegacyOfflinePaymentPayload } from '../types/payment';

export function parseOfflinePaymentPayload(raw: string): OfflinePaymentPayload {
  const trimmed = raw.trim();

  if (trimmed.includes(':') && !trimmed.startsWith('{')) {
    return parseColonSmsPayload(trimmed);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error('Payment QR is not valid JSON or SMS payload.');
  }

  if (!isObject(parsed)) {
    throw new Error('Payment QR payload must be an object.');
  }

  if (parsed.version === 2 && parsed.smsBody) {
    return validateV2Payload(parsed);
  }

  return legacyToV2(parsed);
}

function parseColonSmsPayload(smsBody: string): OfflinePaymentPayload {
  const [customerShortId, merchantShortId, amountStr] = smsBody.split(':');
  const amount = Number.parseInt(amountStr ?? '', 10);
  if (!customerShortId || !merchantShortId || !Number.isFinite(amount) || amount <= 0) {
    throw new Error('SMS payload is missing customer, merchant, or amount.');
  }

  return {
    type: 'ABOTPERA_OFFLINE_PAYMENT',
    version: 2,
    amount,
    currency: 'PHP',
    customerShortId,
    merchantShortId,
    smsBody,
    createdAt: new Date().toISOString(),
    expiresInMinutes: 10,
  };
}

function validateV2Payload(parsed: Record<string, unknown>): OfflinePaymentPayload {
  if (parsed.type !== 'ABOTPERA_OFFLINE_PAYMENT') {
    throw new Error('Payment QR has an unsupported type.');
  }
  if (typeof parsed.amount !== 'number' || parsed.amount <= 0) {
    throw new Error('Payment QR amount must be a positive number.');
  }
  if (typeof parsed.customerShortId !== 'string' || typeof parsed.merchantShortId !== 'string') {
    throw new Error('Payment QR must include customerShortId and merchantShortId.');
  }
  if (typeof parsed.smsBody !== 'string' || !parsed.smsBody.includes(':')) {
    throw new Error('Payment QR must include smsBody for settlement.');
  }

  return {
    type: 'ABOTPERA_OFFLINE_PAYMENT',
    version: 2,
    amount: parsed.amount,
    currency: 'PHP',
    customerShortId: parsed.customerShortId,
    merchantShortId: parsed.merchantShortId,
    customerPublicKey:
      typeof parsed.customerPublicKey === 'string' ? parsed.customerPublicKey : undefined,
    smsBody: parsed.smsBody,
    createdAt:
      typeof parsed.createdAt === 'string' ? parsed.createdAt : new Date().toISOString(),
    expiresInMinutes:
      typeof parsed.expiresInMinutes === 'number' ? parsed.expiresInMinutes : 10,
  };
}

function legacyToV2(parsed: Record<string, unknown>): OfflinePaymentPayload {
  const legacy = parsed as LegacyOfflinePaymentPayload;
  if (legacy.mvp !== true) {
    throw new Error('Unsupported legacy payment QR.');
  }
  throw new Error(
    'Legacy MVP QR cannot be settled. Customer must generate a new voucher after registering with the backend.'
  );
}

export function buildQrJsonFromVoucher(payload: OfflinePaymentPayload): string {
  return JSON.stringify(payload);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
