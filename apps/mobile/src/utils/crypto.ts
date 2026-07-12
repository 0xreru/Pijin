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
  /** 6–8 char short ID that identifies the sender in the Pijin registry */
  senderShortId: string;
  /** 6–8 char short ID that identifies the receiver/merchant */
  receiverShortId: string;
  /** Stellar G-address of the receiver */
  receiverPubKey: string;
  /** Payment amount expressed in stroops (1 XLM = 10_000_000 stroops) */
  amountStroops: bigint;
  /** Stellar G-address of the gateway/relayer */
  gatewayPubKey: string;
  /** Soroban contract ID (C-address) of the token contract */
  tokenContractId: string;
  /**
   * The numeric token identifier stored in the Pijin DB, serialized as a
   * decimal string.  Prefixed to the SMS payload so the backend can look up
   * the correct token record without an extra round-trip.
   */
  tokenIdStr: string;
  tokenSymbol: string;
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
 *     receiver (Address), gateway (Address), token (Address) ]
 *
 * @returns A Node.js `Buffer` containing the serialised XDR bytes.
 */
function buildXdrTuple(
  amountStroops: bigint,
  tollStroops: bigint,
  nonce32: Uint8Array,
  receiverPubKey: string,
  gatewayPubKey: string,
  tokenContractId: string,
): Buffer {
  const amountScVal  = nativeToScVal(amountStroops, { type: 'i128' });
  const tollScVal     = nativeToScVal(tollStroops, { type: 'i128' });
  const nonceScVal   = xdr.ScVal.scvBytes(Buffer.from(nonce32));
  const receiverScVal = Address.fromString(receiverPubKey).toScVal();
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
    receiverPubKey,
    amountStroops,
    gatewayPubKey,
    tokenContractId,
    tokenIdStr,
    tokenSymbol,
  } = params;

  // ── Step 1: Generate a cryptographically-secure 32-byte nonce ──────────────
  const nonce32 = new Uint8Array(32);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(nonce32);
  } else if (typeof global !== 'undefined' && (global as any).crypto?.getRandomValues) {
    (global as any).crypto.getRandomValues(nonce32);
  } else {
    for (let i = 0; i < 32; i++) {
      nonce32[i] = Math.floor(Math.random() * 256);
    }
  }
  
  const tollStroops = tokenSymbol === 'PHPC' ? 5000000n : 0n;
  // ── Step 2: Serialize the Soroban XDR Tuple ────────────────────────────────
  const xdrBuffer = buildXdrTuple(
    amountStroops,
    tollStroops,
    nonce32,
    receiverPubKey,
    gatewayPubKey,
    tokenContractId,
  );

  // ── Step 3: Sign the XDR bytes with the sender's Ed25519 device key ────────
  // Yield one tick to the event loop to prevent UI jank on the JS thread.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));

  const senderKeypair = Keypair.fromSecret(senderSecretKey);
  const signatureBytes = senderKeypair.sign(xdrBuffer);

  // ── Step 4: Encode amount as Base62 ────────────────────────────────────────
  const amountBase62 = encodeBase62(amountStroops);

  // ── Step 5: Base64-encode nonce and signature, strip padding ───────────────
  const nonceB64 = stripBase64Padding(
    Buffer.from(nonce32).toString('base64'),
  );
  const signatureB64 = stripBase64Padding(
    Buffer.from(signatureBytes).toString('base64'),
  );

  // ── Step 6: Assemble the 6-part SMS payload ────────────────────────────────
  return [
    tokenIdStr,
    senderShortId,
    receiverShortId,
    amountBase62,
    nonceB64,
    signatureB64,
  ].join(':');
}
