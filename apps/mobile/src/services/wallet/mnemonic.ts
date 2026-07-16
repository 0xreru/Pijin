import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { Keypair } from '@stellar/stellar-base';
import { Buffer } from 'buffer';
import { hmac } from '@noble/hashes/hmac';
import { sha512 } from '@noble/hashes/sha512';

export interface DerivedKeys {
  mainWalletKeypair: Keypair;
  deviceKeypair: Keypair;
}

/**
 * Generates a standard 12-word BIP-39 mnemonic phrase.
 */
export function generateWalletMnemonic(): string {
  // 128 bits of entropy = 12 words
  return generateMnemonic(wordlist, 128);
}

/**
 * Validates whether a given string is a valid BIP-39 mnemonic.
 */
export function isValidMnemonic(mnemonic: string): boolean {
  return validateMnemonic(mnemonic, wordlist);
}

/**
 * Helper to convert an index to a 4-byte Uint8Array (Big Endian)
 */
function toU32(n: number): Uint8Array {
  const buf = new Uint8Array(4);
  const view = new DataView(buf.buffer);
  view.setUint32(0, n, false);
  return buf;
}

/**
 * Minimal SLIP-0010 Ed25519 Derivation
 */
function deriveHardened(seed: Uint8Array, path: number[]): Uint8Array {
  const MASTER_SECRET = new Uint8Array(Buffer.from('ed25519 seed', 'utf8'));
  const HARDENED_OFFSET = 0x80000000;

  // Master key
  let I = hmac(sha512, MASTER_SECRET, seed);
  let privateKey = I.slice(0, 32);
  let chainCode = I.slice(32);

  // Derive along path
  for (const index of path) {
    const hardenedIndex = index + HARDENED_OFFSET;
    // data = 0x00 || privateKey || index
    const data = new Uint8Array(1 + 32 + 4);
    data.set([0], 0);
    data.set(privateKey, 1);
    data.set(toU32(hardenedIndex), 33);

    I = hmac(sha512, chainCode, data);
    privateKey = I.slice(0, 32);
    chainCode = I.slice(32);
  }

  return privateKey;
}

/**
 * Derives the Stellar Main Wallet and Offline Device Key from a 12-word mnemonic.
 * Uses standard HD derivation paths for Stellar (m/44'/148'/0' and m/44'/148'/1').
 */
export function deriveKeysFromMnemonic(mnemonic: string): DerivedKeys {
  if (!isValidMnemonic(mnemonic)) {
    throw new Error('Invalid mnemonic phrase provided.');
  }

  // Convert mnemonic to a 512-bit seed
  const seed = mnemonicToSeedSync(mnemonic);
  
  // m/44'/148'/0'
  const mainWalletPriv = deriveHardened(seed, [44, 148, 0]);
  const mainWalletKeypair = Keypair.fromRawEd25519Seed(Buffer.from(mainWalletPriv));
  
  // m/44'/148'/1'
  const deviceWalletPriv = deriveHardened(seed, [44, 148, 1]);
  const deviceKeypair = Keypair.fromRawEd25519Seed(Buffer.from(deviceWalletPriv));

  return {
    mainWalletKeypair,
    deviceKeypair,
  };
}
