import { getOrGenerateDeviceKeypair } from '../wallet/deviceKeyStore';
import { loadStoredAccount } from '../storage/accountStorage';
import { phpToStroops, CONTRACT_ID, TOKEN_ID } from '../../constants/stellar';
import { generateOfflineSmsPayload } from '../../utils/crypto';

// ---------------------------------------------------------------------------
// Env helpers
// ---------------------------------------------------------------------------

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(
      `[buildSmsPayload] Missing required environment variable: ${name}`
    );
  }
  return value.trim().replace(/^['"]+|['"]+$/g, '');
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type OfflineVoucherInput = {
  /** Short ID of the receiver (merchant). */
  receiverShortId: string;
  /** Stellar G-address of the receiver (merchant). */
  receiverPubKey: string;
  /**
   * Human-readable payment amount in PHP / XLM units.
   * Converted internally to stroops (× 10,000,000).
   */
  amountPhp: number;
};

export type OfflineVoucherResult = {
  /** The 6-part colon-separated SMS body, ready to send or QR-encode. */
  smsBody: string;
  /**
   * Unpadded Base64 representation of the 32-byte nonce,
   * embedded in `smsBody`. Exposed here for logging/display.
   */
  nonceB64: string;
  /**
   * Unpadded Base64 Ed25519 signature of the Soroban XDR tuple,
   * embedded in `smsBody`. Exposed here for debugging.
   */
  signatureB64: string;
  /** Amount in stroops (as a string for safe serialisation). */
  amountStroops: string;
};

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Builds a fully-signed offline SMS payment voucher that conforms to the
 * Pijin 6-part payload standard:
 *
 * ```
 * {tokenIdStr}:{senderShortId}:{receiverShortId}:{amountBase62}:{nonceB64}:{signatureB64}
 * ```
 *
 * **What this function does:**
 * 1. Loads the sender's stored account (for `senderShortId`).
 * 2. Retrieves / generates the device Ed25519 keypair from the secure enclave.
 * 3. Reads `EXPO_PUBLIC_GATEWAY_PUBLIC_KEY`, `EXPO_PUBLIC_CONTRACT_ID`, and
 *    `EXPO_PUBLIC_TOKEN_ID` from the environment.
 * 4. Converts `amountPhp` → `amountStroops` (BigInt, × 10_000_000).
 * 5. Delegates all cryptographic work to `generateOfflineSmsPayload` in
 *    `utils/crypto.ts` (nonce generation, XDR tuple, Ed25519 sign).
 *
 * @throws If the stored account is missing, inactive, or not a CUSTOMER.
 * @throws If any required environment variable is absent.
 */
export async function buildOfflineSmsVoucher(
  input: OfflineVoucherInput,
): Promise<OfflineVoucherResult> {
  const { receiverShortId, receiverPubKey, amountPhp } = input;

  // ── 1. Load sender identity from secure storage ────────────────────────────
  const account = await loadStoredAccount();
  if (!account?.shortId) {
    throw new Error('Sender short ID is missing. Please register first.');
  }
  if (account.role !== 'CUSTOMER') {
    throw new Error('Only CUSTOMER accounts can generate offline SMS vouchers.');
  }

  // ── 2. Retrieve (or create) the device signing key from the enclave ────────
  const deviceKeypair = await getOrGenerateDeviceKeypair();
  const senderSecretKey = deviceKeypair.secret();

  // ── 3. Gather environment configuration ───────────────────────────────────
  const gatewayPubKey   = requireEnv('EXPO_PUBLIC_GATEWAY_PUBLIC_KEY');
  const tokenContractId = CONTRACT_ID  || requireEnv('EXPO_PUBLIC_CONTRACT_ID');
  const tokenIdStr      = TOKEN_ID     || requireEnv('EXPO_PUBLIC_TOKEN_ID');

  // ── 4. Convert amount to stroops (BigInt, 7 decimal places) ───────────────
  const amountStroops = phpToStroops(amountPhp);
  if (amountStroops <= 0n) {
    throw new RangeError('Amount must be greater than zero.');
  }

  // ── 5. Generate the full cryptographic payload ─────────────────────────────
  const smsBody = await generateOfflineSmsPayload({
    senderSecretKey,
    senderShortId:  account.shortId,
    receiverShortId,
    receiverPubKey,
    amountStroops,
    gatewayPubKey,
    tokenContractId,
    tokenIdStr,
  });

  // ── 6. Extract nonce/signature from the payload for the result object ──────
  // Format: tokenIdStr:senderShortId:receiverShortId:amountBase62:nonceB64:sigB64
  const parts = smsBody.split(':');
  const nonceB64     = parts[4] ?? '';
  const signatureB64 = parts[5] ?? '';

  return {
    smsBody,
    nonceB64,
    signatureB64,
    amountStroops: amountStroops.toString(),
  };
}
