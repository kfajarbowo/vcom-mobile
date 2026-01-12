const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');
const path = require('path');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('metro-config').MetroConfig}
 */
const config = {
  resolver: {
    // Add support for TypeScript files in node_modules
    sourceExts: ['js', 'jsx', 'json', 'ts', 'tsx'],
    nodeModulesPaths: [path.resolve(__dirname, 'node_modules')],
  },
  watchFolders: [path.resolve(__dirname)],
  // Ignore build directories to prevent watch errors
  watcher: {
    watchman: {
      ignore_dirs: [
        'node_modules/react-native-device-info/android/build',
        'node_modules/**/android/build',
        'node_modules/**/ios/build',
      ],
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
