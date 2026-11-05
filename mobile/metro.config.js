// The app uses the shared API client and types from ../packages (Phase 6.1):
// Metro watches that folder and resolves every module from this app's
// node_modules, so the packages need no install of their own.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const packagesRoot = path.resolve(projectRoot, '../packages');

const config = getDefaultConfig(projectRoot);
config.watchFolders = [...(config.watchFolders ?? []), packagesRoot];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')];
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
