const path = require('path');
const Module = require('module');

// npm can hoist babel-preset-expo while keeping Expo beside React 18 in this
// workspace. Make the mobile dependency directory visible to the hoisted
// preset so its internal `expo/config` import resolves without hoisting Expo.
const mobileNodeModules = path.resolve(__dirname, 'node_modules');
const nodePathEntries = (process.env.NODE_PATH || '')
  .split(path.delimiter)
  .filter(Boolean);

if (!nodePathEntries.includes(mobileNodeModules)) {
  process.env.NODE_PATH = [mobileNodeModules, ...nodePathEntries].join(path.delimiter);
  Module._initPaths();
}

module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
  };
};
