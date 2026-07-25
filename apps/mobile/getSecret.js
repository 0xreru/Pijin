const { mnemonicToSeedSync } = require('@scure/bip39');
const crypto = require('crypto');
const { Keypair } = require('@stellar/stellar-base');

const mnemonic = "answer feature recycle venue mammal hint bean wonder rebuild lion leader crack";

function toU32(n) {
  const buf = new Uint8Array(4);
  const view = new DataView(buf.buffer);
  view.setUint32(0, n, false);
  return buf;
}

function deriveHardened(seed, path) {
  const MASTER_SECRET = Buffer.from('ed25519 seed', 'utf8');
  const HARDENED_OFFSET = 0x80000000;

  let I = crypto.createHmac('sha512', MASTER_SECRET).update(seed).digest();
  let privateKey = I.subarray(0, 32);
  let chainCode = I.subarray(32);

  for (const index of path) {
    const hardenedIndex = index + HARDENED_OFFSET;
    const data = Buffer.alloc(1 + 32 + 4);
    data[0] = 0;
    privateKey.copy(data, 1);
    Buffer.from(toU32(hardenedIndex)).copy(data, 33);

    I = crypto.createHmac('sha512', chainCode).update(data).digest();
    privateKey = I.subarray(0, 32);
    chainCode = I.subarray(32);
  }

  return privateKey;
}

const seed = mnemonicToSeedSync(mnemonic);
const mainWalletPriv = deriveHardened(seed, [44, 148, 0]);
const mainWalletKeypair = Keypair.fromRawEd25519Seed(Buffer.from(mainWalletPriv));
console.log(mainWalletKeypair.secret());
