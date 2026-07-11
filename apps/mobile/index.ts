import { Buffer } from 'buffer';
import 'react-native-get-random-values';
import 'react-native-url-polyfill/auto';

if (typeof global.Buffer === 'undefined') {
  global.Buffer = Buffer;
}

// Patch Stellar SDK Transaction & FeeBumpTransaction prototype.toXDR
// under Hermes/React Native, as toXDR() without arguments might return a CSV string of numbers
// instead of a Base64 string since Uint8Array.prototype.toString('base64') is not supported.
import { Transaction, FeeBumpTransaction } from '@stellar/stellar-sdk';

const patchToXDR = (prototype: any) => {
  const originalToXDR = prototype.toXDR;
  if (!originalToXDR) return;

  prototype.toXDR = function (this: any, ...args: any[]) {
    const result = originalToXDR.apply(this, args);
    if (typeof result === 'string' && result.includes(',')) {
      const bytesArray = result.split(',').map((numStr) => parseInt(numStr, 10));
      const uint8Bytes = new Uint8Array(bytesArray);
      return Buffer.from(uint8Bytes).toString('base64');
    }
    return result;
  };
};

patchToXDR(Transaction.prototype);
patchToXDR(FeeBumpTransaction.prototype);
import '@walletconnect/react-native-compat';

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
