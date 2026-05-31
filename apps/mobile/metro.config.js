const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Metro (EAS/Android) often fails on package.json "exports" subpaths.
config.resolver.unstable_enablePackageExports = false;

const stellarSdkRoot = path.join(
  __dirname,
  'node_modules',
  '@stellar',
  'stellar-sdk'
);

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
