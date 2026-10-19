const { spawnSync } = require('node:child_process');

const result = spawnSync(process.execPath, process.argv.slice(2), {
  env: {
    ...process.env,
    // Expo SDK 54 otherwise changes Metro's server root to the workspace root.
    EXPO_NO_METRO_WORKSPACE_ROOT: '1',
  },
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
