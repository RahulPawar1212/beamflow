/**
 * @module @beamflow/core
 *
 * Public API for the core package.
 *
 * This package provides:
 * - NodeRegistry: the central catalog of all available node types
 * - PluginLoader: loads plugins and registers their nodes
 * - Validation utilities: validates node settings against schemas
 */

export { NodeRegistry, createRegistry } from './registry.js';
export type { RegistryListener, RegistryEvent } from './registry.js';

export { PluginLoader, createPluginLoader } from './plugin.js';
export type { LoadedPlugin } from './plugin.js';

export { validateNodeSettings, isNodeValid } from './validation.js';
