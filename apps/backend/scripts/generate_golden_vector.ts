import { Address, Keypair, nativeToScVal, xdr } from '@stellar/stellar-sdk';

// Deterministic seed for sender keypair
const seed = Buffer.alloc(32, 1);
const senderKeypair = Keypair.fromRawEd25519Seed(seed);
const senderPublicKey = senderKeypair.publicKey();
const senderRawPubkey = senderKeypair.rawPublicKey();

// Fixed deterministic inputs
const amountStroops = 100_000_000n;
const tollStroops = 5_000_000n;
const nonce = Buffer.alloc(32, 0x2a); // 42 in hex
const receiverShortId = 'aB3x9Q';

// Deterministic contract, gateway, and token addresses
const gatewayKeypair = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 2));
const gatewayPublicKey = gatewayKeypair.publicKey();

// 32-byte hex for contract addresses
const tokenContractBytes = Buffer.alloc(32, 3);
const tokenContractAddress = Address.contract(tokenContractBytes).toString();

const contractAddressBytes = Buffer.alloc(32, 4);
const contractAddress = Address.contract(contractAddressBytes).toString();

// Construct the 7-tuple:
// (amount, protocol_toll, nonce, receiver_short_id, gateway, token, contract)
const tuple = xdr.ScVal.scvVec([
  nativeToScVal(amountStroops, { type: 'i128' }),
  nativeToScVal(tollStroops, { type: 'i128' }),
  xdr.ScVal.scvBytes(nonce),
  xdr.ScVal.scvBytes(Buffer.from(receiverShortId, 'ascii')),
  Address.fromString(gatewayPublicKey).toScVal(),
  Address.fromString(tokenContractAddress).toScVal(),
  Address.fromString(contractAddress).toScVal(),
]);

const xdrBytes = tuple.toXDR();
const signature = senderKeypair.sign(xdrBytes);

console.log(JSON.stringify({
  senderPublicKey,
  senderRawPubkeyHex: senderRawPubkey.toString('hex'),
  amountStroops: amountStroops.toString(),
  tollStroops: tollStroops.toString(),
  nonceHex: nonce.toString('hex'),
  receiverShortId,
  gatewayPublicKey,
  tokenContractAddress,
  contractAddress,
  xdrHex: xdrBytes.toString('hex'),
  signatureHex: signature.toString('hex'),
}, null, 2));
