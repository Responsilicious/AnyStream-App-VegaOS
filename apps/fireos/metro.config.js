const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

// The shared app lives two folders up. Metro watches it and resolves @anystream/core to it, while every
// other package (react, react-native, tweetnacl) comes from this app's own node_modules so there is one copy.
const repoRoot = path.resolve(__dirname, '..', '..');
const core = path.join(repoRoot, 'packages', 'core');

/** @type {import('@react-native/metro-config').MetroConfig} */
const config = {
  watchFolders: [core],
  resolver: {
    nodeModulesPaths: [path.join(__dirname, 'node_modules')],
    disableHierarchicalLookup: true,
    extraNodeModules: {
      '@anystream/core': core,
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
