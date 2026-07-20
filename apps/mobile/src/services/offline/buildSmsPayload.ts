import { getEnrolledDeviceKeypair } from '../wallet/deviceKeyStore';
import { loadStoredAccount } from '../storage/accountStorage';
import { phpToStroops } from '../../constants/stellar';
import { generateOfflineSmsPayload } from '../../utils/crypto';
import { loadOfflineProtocolConfig } from '../storage/offlineProtocolStorage';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type SelectedToken = {
  /** Asset ticker, e.g. "PHPC" or "USDC". Used to compute the protocol toll. */
  symbol: string;
  /** Soroban C-address of the token's smart contract. */
  contractId: string;
  /** Numeric DB record ID for the token, serialised as a decimal string. */
  tokenDbId: string;
};

export type OfflineVoucherInput = {
  /** Short ID of the receiver (merchant). */
  receiverShortId: string;
  /**
   * Human-readable payment amount in PHP / XLM units.
   * Converted internally to stroops (× 10,000,000).
   */
  amountPhp: number;
  /**
   * The token to use for this offline payment.
   * Defaults to the server-issued token cached during registry sync.
   */
  selectedToken?: SelectedToken;
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
 * 2. Retrieves the previously enrolled device Ed25519 keypair from SecureStore.
 * 3. Loads gateway/token configuration cached during authenticated registry sync.
 * 4. Converts `amountPhp` → `amountStroops` (BigInt, × 10_000_000).
 * 5. Delegates all cryptographic work to `generateOfflineSmsPayload` in
 *    `utils/crypto.ts` (nonce generation, XDR tuple, Ed25519 sign).
 *
 * @throws If the stored account is missing, inactive, or not a CUSTOMER.
 * @throws If the device has not synchronized offline configuration while online.
 */
export async function buildOfflineSmsVoucher(
  input: OfflineVoucherInput,
): Promise<OfflineVoucherResult> {
  const {
    receiverShortId,
    amountPhp,
    selectedToken,
  } = input;

  // ── 1. Load sender identity from secure storage ────────────────────────────
  const account = await loadStoredAccount();
  if (!account?.shortId) {
    throw new Error('Sender short ID is missing. Please register first.');
  }
  if (account.role !== 'USER' && account.role !== 'CUSTOMER') {
    throw new Error('Only USER accounts can generate offline SMS vouchers.');
  }

  // ── 2. Load the enrolled key. Never create a replacement while offline. ────
  const deviceKeypair = await getEnrolledDeviceKeypair();
  const senderSecretKey = deviceKeypair.secret();
  // LOG A2 — prove which device key will perform the signing
  console.log(
    `\n[OfflineVoucher] ── COMPRESS-1: Device Key Loaded ────────────────────\n` +
    `  senderSecretKey : ${senderSecretKey}\n` +
    `──────────────────────────────────────────────────────────────────────`
  );

  // ── 3. Resolve token — caller-supplied takes priority over cached config ──
  const offlineConfig = await loadOfflineProtocolConfig();
  if (!offlineConfig) {
    throw new Error('Offline payments are not ready. Sign in while online to synchronize this device.');
  }
  const gatewayPubKey = offlineConfig.gatewayPublicKey;
  const tokenContractId = selectedToken?.contractId ?? offlineConfig.tokenContractId;
  const tokenIdStr = selectedToken?.tokenDbId ?? offlineConfig.tokenDbId;
  const tokenSymbol = selectedToken?.symbol ?? offlineConfig.tokenSymbol;

  // ── 4. Convert amount to stroops (BigInt, 7 decimal places) ───────────────
  const amountStroops = phpToStroops(amountPhp);
  if (amountStroops <= 0n) {
    throw new RangeError('Amount must be greater than zero.');
  }
  // LOG A — first compression: prove identity + amount before crypto pipeline
  console.log(
    `\n[OfflineVoucher] ── COMPRESS-1: Identity + Amount ────────────────────\n` +
    `  amountPhp       : ${amountPhp}\n` +
    `  amountStroops   : ${amountStroops.toString()}\n` +
    `  senderShortId   : ${account.shortId}\n` +
    `  receiverShortId : ${receiverShortId}\n` +
    `  tokenSymbol     : ${tokenSymbol}\n` +
    `  tokenIdStr      : ${tokenIdStr}\n` +
    `──────────────────────────────────────────────────────────────────────`
  );

  // ── 5. Generate the full cryptographic payload ─────────────────────────────
  const smsBody = await generateOfflineSmsPayload({
    senderSecretKey,
    senderShortId:  account.shortId,
    receiverShortId,
    amountStroops,
    gatewayPubKey,
    tokenContractId,
    tokenIdStr,
    tokenSymbol,
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
