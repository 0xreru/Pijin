const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Metro (EAS/Android) often fails on package.json "exports" subpaths.
config.resolver.unstable_enablePackageExports = false;

function resolvePackageRoot(packageName) {
  const mainPath = require.resolve(packageName);
  let dir = path.dirname(mainPath);
  const targetFolder = packageName.includes('/') ? packageName.split('/').pop() : packageName;
  while (path.basename(dir) !== targetFolder && dir !== path.dirname(dir)) {
    dir = path.dirname(dir);
  }
  return dir;
}

const stellarSdkRoot = resolvePackageRoot('@stellar/stellar-sdk');
const reactNativeSvgRoot = resolvePackageRoot('react-native-svg');

const stellarFull = path.join(stellarSdkRoot, 'lib');

config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  buffer: require.resolve('buffer/'),
  url: require.resolve('react-native-url-polyfill'),
};

// Use full SDK build with explicit aliases for React Native.
const stellarAliases = {
  '@stellar/stellar-sdk': path.join(stellarFull, 'index.js'),
  '@stellar/stellar-sdk/contract': path.join(stellarFull, 'contract/index.js'),
  '@stellar/stellar-sdk/rpc': path.join(stellarFull, 'rpc/index.js'),
  'eventsource': path.join(__dirname, 'empty-module.js'),
  // Force Metro to use the compiled CommonJS build of react-native-svg instead of
  // the TypeScript source. The TS source (src/index.ts) eagerly imports
  // NativeSvgViewModule.ts which calls TurboModuleRegistry.getEnforcing() at module
  // load time — crashing Expo Go before any screen renders. The compiled build uses
  // lazy Object.defineProperty getters that are safe to load without a native binary.
  'react-native-svg': path.join(reactNativeSvgRoot, 'lib', 'commonjs', 'index.js'),
};

const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (stellarAliases[moduleName]) {
    return {
      type: 'sourceFile',
      filePath: stellarAliases[moduleName],
    };
  }
  if (defaultResolveRequest) {
    return defaultResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
