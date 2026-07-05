const path = require('path');
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

// --- MONOREPO CONFIGURATION ---
// 1. Watch all files within the monorepo root so Metro can see hoisted packages
config.watchFolders = [workspaceRoot];

// 2. Let Metro know where to resolve packages (local first, then root)
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// 3. Force Metro to resolve dependencies correctly through the workspace
config.resolver.disableHierarchicalLookup = true;

// --- STELLAR SDK POLYFILLS & ALIASES ---
// Metro (EAS/Android) often fails on package.json "exports" subpaths.
config.resolver.unstable_enablePackageExports = false;

// Dynamically resolve roots using the new helper
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
  // the TypeScript source.
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