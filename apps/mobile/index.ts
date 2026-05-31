import { Buffer } from 'buffer';
import 'react-native-get-random-values';
import 'react-native-url-polyfill/auto';

if (typeof global.Buffer === 'undefined') {
  global.Buffer = Buffer;
}
import '@walletconnect/react-native-compat';

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
