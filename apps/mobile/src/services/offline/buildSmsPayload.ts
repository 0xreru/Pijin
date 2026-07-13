import { getEnrolledDeviceKeypair } from '../wallet/deviceKeyStore';
import { loadStoredAccount } from '../storage/accountStorage';
import { phpToStroops, TOKEN_ID, TOKEN_DB_ID } from '../../constants/stellar';
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
// Default token: PHPC
// ---------------------------------------------------------------------------

/**
 * The default offline payment token. The signed payload must use the token
 * contract/SAC address, not the Pijin vault contract address, because the
 * backend and Soroban contract include the token address in the signed tuple.
 */
export const PHPC_TOKEN: SelectedToken = {
  symbol:     'PHPC',
  contractId: TOKEN_ID ||
              'CD26OANM4I4GF2GBC47UYTSP3FUBZRQ7WGMGECEQHMZ2D6QV2LXJTNIS',
  tokenDbId:  (process.env.EXPO_PUBLIC_TOKEN_DB_ID ?? '').replace(/^['"]|['"]$/g, '') ||
              '1',
};

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
  /** Stellar G-address of the receiver (merchant). */
  receiverPubKey: string;
  /**
   * Human-readable payment amount in PHP / XLM units.
   * Converted internally to stroops (× 10,000,000).
   */
  amountPhp: number;
  /**
   * The token to use for this offline payment.
   * Defaults to PHPC (TOKEN_ID / TOKEN_DB_ID from env) when omitted.
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
 * 3. Reads `EXPO_PUBLIC_GATEWAY_PUBLIC_KEY` and `EXPO_PUBLIC_TOKEN_ID` from
 *    the environment.
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
  const {
    receiverShortId,
    receiverPubKey,
    amountPhp,
    selectedToken = PHPC_TOKEN,   // default: PHPC — change when multi-token lands
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

  // ── 3. Resolve token — caller-supplied takes priority; fall back to env ────
  const gatewayPubKey   = requireEnv('EXPO_PUBLIC_GATEWAY_PUBLIC_KEY');
  const tokenContractId = selectedToken?.contractId
    || requireEnv('EXPO_PUBLIC_TOKEN_ID');
  const tokenIdStr      = selectedToken?.tokenDbId
    || TOKEN_DB_ID
    || process.env.EXPO_PUBLIC_TOKEN_DB_ID
    || '1';
  const tokenSymbol     = selectedToken?.symbol ?? 'PHPC';

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
