const path = require('path');
const Module = require('module');

// npm hoists metro / @expo/metro-config to the repo root but keeps expo, expo-asset
// and react-native under apps/mobile/node_modules (React 18 vs. other workspaces).
// Hoisted tooling lazily requires those packages (e.g. metro's
// `expo-asset/tools/hashAssetFiles`), which fails on EAS. Expose the app's
// node_modules to them, same approach as babel.config.js.
const mobileNodeModules = path.resolve(__dirname, 'node_modules');
const nodePathEntries = (process.env.NODE_PATH || '')
  .split(path.delimiter)
  .filter(Boolean);
if (!nodePathEntries.includes(mobileNodeModules)) {
  process.env.NODE_PATH = [mobileNodeModules, ...nodePathEntries].join(path.delimiter);
  Module._initPaths();
}

const { getDefaultConfig } = require('expo/metro-config');

// --- DYNAMIC PACKAGE RESOLVER (Teammate's Addition) ---
// Safely finds hoisted packages no matter where NPM installs them in the monorepo
function resolvePackageRoot(packageName) {
  const mainPath = require.resolve(packageName);
  let dir = path.dirname(mainPath);
  const targetFolder = packageName.includes('/') ? packageName.split('/').pop() : packageName;
  while (path.basename(dir) !== targetFolder && dir !== path.dirname(dir)) {
    dir = path.dirname(dir);
  }
  return dir;
}

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(projectRoot);

// Expo SDK 54 configures npm workspaces automatically. Keep only the custom
// package aliases below so Metro can still resolve transitive dependencies.

// --- STELLAR SDK POLYFILLS & ALIASES ---
// Metro (EAS/Android) often fails on package.json "exports" subpaths.
config.resolver.unstable_enablePackageExports = false;

// Dynamically resolve roots using the new helper
const stellarSdkRoot = resolvePackageRoot('@stellar/stellar-sdk');
const reactNativeSvgRoot = resolvePackageRoot('react-native-svg');
// Explicitly locate pijin_core in the workspace
const pijinCoreRoot = path.resolve(workspaceRoot, 'packages/pijin_core');
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
  // the TypeScript source.
  'react-native-svg': path.join(reactNativeSvgRoot, 'lib', 'commonjs', 'index.js'),
  'pijin_core': path.join(pijinCoreRoot, 'src', 'index.ts'),
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
