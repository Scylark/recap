// Lets this example use the SDK straight from ../../sdk-react-native in the repo.
// Apps that copy the SDK into their own folder (as AGENTS.md describes) don't need this file.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const sdk = path.resolve(__dirname, '../../sdk-react-native');
config.watchFolders = [sdk];
// Resolve react, react-native etc. only from this app, so there is one copy of React.
config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules')];
config.resolver.disableHierarchicalLookup = true;
module.exports = config;
