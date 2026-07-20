import { Buffer } from 'buffer';
import { Address, Keypair, xdr, nativeToScVal } from '@stellar/stellar-sdk';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BASE62_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE62 = BigInt(62);

// ---------------------------------------------------------------------------
// Public Types
// ---------------------------------------------------------------------------

export type SmsPayloadParams = {
  /** Ed25519 secret key (Stellar strkey, e.g. "S…") of the sender's device key */
  senderSecretKey: string;
  /** Exact 6-character, case-sensitive Base62 sender ID */
  senderShortId: string;
  /** Exact 6-character, case-sensitive Base62 receiver ID */
  receiverShortId: string;
  /** Payment amount expressed in stroops (1 XLM = 10_000_000 stroops) */
  amountStroops: bigint;
  /** Stellar G-address of the gateway/relayer */
  gatewayPubKey: string;
  /** Soroban contract ID (C-address) of the token contract */
  tokenContractId: string;
  /** Asset ticker used for protocol toll calculation, e.g. "PHPC" */
  tokenSymbol: string;
  /**
   * The numeric token identifier stored in the Pijin DB, serialized as a
   * decimal string.  Prefixed to the SMS payload so the backend can look up
   * the correct token record without an extra round-trip.
   */
  tokenIdStr: string;
};

// ---------------------------------------------------------------------------
// Utility: Base62 encoding
// ---------------------------------------------------------------------------

/**
 * Encodes a non-negative BigInt as a Base62 string using the alphabet
 * `0-9A-Za-z`.  This is the compact amount representation used in the Pijin
 * SMS payload to minimise character usage in constrained SMS messages.
 *
 * @param num - A non-negative BigInt to encode.
 * @returns    A Base62 string (never empty; returns "0" for input 0n).
 */
export function encodeBase62(num: bigint): string {
  if (num < 0n) {
    throw new RangeError('encodeBase62: input must be a non-negative BigInt');
  }
  if (num === 0n) return '0';

  let result = '';
  let n = num;
  while (n > 0n) {
    result = BASE62_ALPHABET[Number(n % BASE62)] + result;
    n = n / BASE62;
  }
  return result;
}

/**
 * Decodes a Base62 string back to a BigInt.
 */
export function decodeBase62(str: string): bigint {
  let result = 0n;
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    const index = BASE62_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error(`decodeBase62: invalid character ${char}`);
    }
    result = result * BASE62 + BigInt(index);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Utility: Base64 helpers
// ---------------------------------------------------------------------------

/**
 * Strips trailing `=` padding from a Base64 string to save SMS characters.
 * The backend restores the padding before decoding.
 */
export function stripBase64Padding(b64: string): string {
  return b64.replace(/=+$/, '');
}

// ---------------------------------------------------------------------------
// Core: XDR Tuple builder
// ---------------------------------------------------------------------------

/**
 * Constructs the canonical Soroban XDR `Vec<ScVal>` (acting as a tuple) that
 * the PijinContract `spend_offline` function verifies on-chain.
 *
 * Field order must match the Rust contract exactly:
 *   [ amount (i128), protocol_toll (i128), nonce (BytesN<32>),
 *     receiver_short_id (BytesN<6>), gateway (Address), token (Address) ]
 *
 * @returns A Node.js `Buffer` containing the serialised XDR bytes.
 */
function buildXdrTuple(
  amountStroops: bigint,
  tollStroops: bigint,
  nonce32: Uint8Array,
  receiverShortId: string,
  gatewayPubKey: string,
  tokenContractId: string,
): Buffer {
  const amountScVal  = nativeToScVal(amountStroops, { type: 'i128' });
  const tollScVal     = nativeToScVal(tollStroops, { type: 'i128' });
  const nonceScVal   = xdr.ScVal.scvBytes(Buffer.from(nonce32));
  if (!/^[0-9A-Za-z]{6}$/.test(receiverShortId)) {
    throw new Error('Receiver short ID must be exactly 6 case-sensitive Base62 characters');
  }
  const receiverScVal = xdr.ScVal.scvBytes(Buffer.from(receiverShortId, 'ascii'));
  const gatewayScVal  = Address.fromString(gatewayPubKey).toScVal();
  const tokenScVal    = Address.fromString(tokenContractId).toScVal();

  const tuple = xdr.ScVal.scvVec([
    amountScVal,
    tollScVal,
    nonceScVal,
    receiverScVal,
    gatewayScVal,
    tokenScVal,
  ]);

  return Buffer.from(tuple.toXDR());
}

// ---------------------------------------------------------------------------
// Main export: generateOfflineSmsPayload
// ---------------------------------------------------------------------------

/**
 * Generates a complete, cryptographically-signed Pijin offline SMS voucher.
 *
 * ### What happens internally
 * 1. **Nonce** – 32 cryptographically-secure random bytes via `expo-crypto`.
 * 2. **XDR Tuple** – Serialises the payment parameters into a Soroban
 *    `Vec<ScVal>` and calls `.toXDR()` to produce the canonical byte sequence
 *    that the on-chain `spend_offline` verifier hashes and checks.
 * 3. **Ed25519 Sign** – Signs the raw XDR bytes with the sender's device key
 *    (the same key registered in the Pijin backend as `offlineDeviceKey`).
 * 4. **Base62 Amount** – Compresses `amountStroops` to Base62 for brevity.
 * 5. **Base64 (no padding)** – Encodes nonce and signature for SMS transport.
 *
 * ### SMS payload format (6 parts, colon-separated)
 * ```
 * {tokenIdStr}:{senderShortId}:{receiverShortId}:{amountBase62}:{nonceB64}:{signatureB64}
 * ```
 *
 * @returns The final SMS body string ready to be sent or encoded into a QR.
 */
export async function generateOfflineSmsPayload(
  params: SmsPayloadParams,
): Promise<string> {
  const {
    senderSecretKey,
    senderShortId,
    receiverShortId,
    amountStroops,
    gatewayPubKey,
    tokenContractId,
    tokenIdStr,
    tokenSymbol,
  } = params;

  if (!/^[0-9A-Za-z]{6}$/.test(senderShortId)) {
    throw new Error('Sender short ID must be exactly 6 case-sensitive Base62 characters');
  }
  if (!/^[0-9A-Za-z]{6}$/.test(receiverShortId)) {
    throw new Error('Receiver short ID must be exactly 6 case-sensitive Base62 characters');
  }
  if (!/^\d+$/.test(tokenIdStr)) {
    throw new Error('Token database ID must contain decimal digits only');
  }
  if (amountStroops <= 0n) {
    throw new Error('Payment amount must be greater than zero');
  }

  // ── Step 1: Generate a cryptographically-secure 32-byte nonce ──────────────
  const nonce32 = new Uint8Array(32);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(nonce32);
  } else if (typeof global !== 'undefined' && (global as any).crypto?.getRandomValues) {
    (global as any).crypto.getRandomValues(nonce32);
  } else {
    throw new Error('Secure random number generation is unavailable on this device');
  }
  // LOG C — second compression: prove nonce was generated
  console.log(
    `\n[OfflineVoucher] ── COMPRESS-2: Nonce Generated ────────────────────\n` +
    `  nonceHexPreview : ${Buffer.from(nonce32.slice(0, 8)).toString('hex')}\n` +
    `  byteLength      : ${nonce32.byteLength}\n` +
    `──────────────────────────────────────────────────────────────────────`
  );
  
  const isPHPC = tokenSymbol === 'PHPC';
  const tollStroops = isPHPC ? 5000000n : 0n; // 0.50 PHPC protocol toll
  // ── Step 2: Serialize the Soroban XDR Tuple ────────────────────────────────
  const xdrBuffer = buildXdrTuple(
    amountStroops,
    tollStroops,
    nonce32,
    receiverShortId,
    gatewayPubKey,
    tokenContractId,
  );
  // LOG D — second compression: prove XDR tuple was built with correct params
  console.log(
    `\n[OfflineVoucher] ── COMPRESS-2: XDR Tuple Built ────────────────────\n` +
    `  xdrByteLength   : ${xdrBuffer.length}\n` +
    `  tollStroops     : ${tollStroops.toString()}\n` +
    `  gatewayPubKey   : ${gatewayPubKey}\n` +
    `  tokenContractId : ${tokenContractId}\n` +
    `──────────────────────────────────────────────────────────────────────`
  );

  // ── Step 3: Sign the XDR bytes with the sender's Ed25519 device key ────────
  // Yield one tick to the event loop to prevent UI jank on the JS thread.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));

  const senderKeypair = Keypair.fromSecret(senderSecretKey);
  const signatureBytes = senderKeypair.sign(xdrBuffer);
  // LOG E — second compression: prove device key signed the XDR blob
  console.log(
    `\n[OfflineVoucher] ── COMPRESS-2: Ed25519 Signed ────────────────────\n` +
    `  signatureByteLength : ${signatureBytes.length}\n` +
    `  devicePublicKey     : ${senderKeypair.publicKey()}\n` +
    `  xdrByteLength       : ${xdrBuffer.length}\n` +
    `──────────────────────────────────────────────────────────────────────`
  );

  // ── Step 4: Encode amount as Base62 ──────────────────────────────────────────
  const amountBase62 = encodeBase62(amountStroops);
  // LOG B — first compression: prove amount was Base62 encoded
  console.log(
    `\n[OfflineVoucher] ── COMPRESS-1: Amount Base62 Encoded ──────────────\n` +
    `  amountStroops   : ${amountStroops.toString()}\n` +
    `  amountBase62    : ${amountBase62}\n` +
    `  senderShortId   : ${senderShortId}\n` +
    `  receiverShortId : ${receiverShortId}\n` +
    `──────────────────────────────────────────────────────────────────────`
  );

  // ── Step 5: Base64-encode nonce and signature, strip padding ─────────────────────
  const nonceB64 = stripBase64Padding(
    Buffer.from(nonce32).toString('base64'),
  );
  const signatureB64 = stripBase64Padding(
    Buffer.from(signatureBytes).toString('base64'),
  );
  // LOG F — second compression: prove nonce and signature were Base64 encoded
  console.log(
    `\n[OfflineVoucher] ── COMPRESS-2: Base64 Encoded ────────────────────\n` +
    `  nonceB64          : ${nonceB64}\n` +
    `  nonceB64Length    : ${nonceB64.length}\n` +
    `  signatureB64      : ${signatureB64}\n` +
    `  signatureB64Length: ${signatureB64.length}\n` +
    `──────────────────────────────────────────────────────────────────────`
  );

  // ── Step 6: Assemble the 6-part SMS payload ──────────────────────────────────────────
  const smsPayload = [
    tokenIdStr,
    senderShortId,
    receiverShortId,
    amountBase62,
    nonceB64,
    signatureB64,
  ].join(':');
  // LOG G — final: prove payload assembled correctly
  console.log(
    `\n[OfflineVoucher] ── COMPRESS-2: Payload Assembled ──────────────────\n` +
    `  totalLength : ${smsPayload.length}\n` +
    `  partCount   : ${smsPayload.split(':').length}\n` +
    `  tokenIdStr  : ${tokenIdStr}\n` +
    `  smsBody     : ${smsPayload}\n` +
    `──────────────────────────────────────────────────────────────────────`
  );

  return smsPayload;
}
