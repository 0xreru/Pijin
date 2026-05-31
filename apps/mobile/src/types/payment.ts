export type OfflinePaymentPayload = {
  type: 'ABOTPERA_OFFLINE_PAYMENT';
  version: 2;
  amount: number;
  currency: 'PHP';
  customerShortId: string;
  merchantShortId: string;
  customerPublicKey?: string;
  smsBody: string;
  createdAt: string;
  expiresInMinutes: number;
};

/** @deprecated MVP v1 JSON-only payloads */
export type LegacyOfflinePaymentPayload = {
  type: 'ABOTPERA_OFFLINE_PAYMENT';
  amount: number;
  currency: 'PHP';
  customerPublicKey?: string;
  createdAt: string;
  expiresInMinutes: number;
  localVoucherId?: string;
  mvp: true;
};
