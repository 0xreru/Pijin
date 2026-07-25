import { deriveKeysFromMnemonic } from '../src/services/wallet/mnemonic';

const mnemonic = process.argv.slice(2).join(' ');

if (!mnemonic) {
  console.error('Please provide your 12-word seed phrase as an argument.');
  console.error('Example: npx tsx scripts/getSecret.ts "word1 word2 word3..."');
  process.exit(1);
}

try {
  const keys = deriveKeysFromMnemonic(mnemonic);
  console.log('\n✅ Derived Keys Successfully!\n');
  console.log('Main Wallet Public Key:  ', keys.mainWalletKeypair.publicKey());
  console.log('Main Wallet SECRET KEY:  ', keys.mainWalletKeypair.secret());
  console.log('\nDevice Wallet Public Key:', keys.deviceKeypair.publicKey());
  console.log('Device Wallet SECRET KEY:', keys.deviceKeypair.secret());
  console.log('\n👉 Add the Main Wallet SECRET KEY to your backend .env file:');
  console.log(`NEXT_PUBLIC_DEMO_SECRET_KEY="${keys.mainWalletKeypair.secret()}"\n`);
} catch (err: any) {
  console.error('Error:', err.message);
}
