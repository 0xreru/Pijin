type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null;
}

function parseMessage(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

/**
 * Accepts both the legacy Pijin handoff and the SEP-24 transaction callback
 * shape. The transaction id is checked whenever the callback supplies one.
 */
export function isReadySep24WithdrawalMessage(
  value: unknown,
  expectedTransactionId: string,
): boolean {
  const message = parseMessage(value);
  if (!isRecord(message)) return false;

  const transaction = isRecord(message.transaction) ? message.transaction : message;
  const transactionId =
    typeof transaction.id === 'string'
      ? transaction.id
      : typeof message.transaction_id === 'string'
        ? message.transaction_id
        : null;

  if (transactionId && transactionId !== expectedTransactionId) return false;

  return (
    transaction.status === 'pending_user_transfer_start' ||
    (message.type === 'success' && message.status === 'pending_user_transfer_start')
  );
}

/** Requests the standard SEP-24 browser callback without losing URL state. */
export function withSep24PostMessageCallback(interactiveUrl: string): string {
  const url = new URL(interactiveUrl);
  url.searchParams.set('callback', 'postMessage');
  return url.toString();
}
