/**
 * @module @beamflow/core/plugin
 *
 * Plugin loading system for BeamFlow.
 *
 * Plugins are the mechanism through which all node types enter the system.
 * The core knows nothing about CSV, SQL, or any specific nodes — plugins
 * register them during startup.
 *
 * Extension points:
 * - Implement IPlugin to create a new plugin
 * - Use PluginLoader.load() to register plugins at startup
 * - Future: dynamic loading from npm packages
 */

import type { IPlugin, INodeDefinition } from '@beamflow/shared';
import type { NodeRegistry } from './registry.js';

/** Metadata about a loaded plugin. */
export interface LoadedPlugin {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly nodeCount: number;
  readonly loadedAt: string;
}

/**
 * Loads and manages BeamFlow plugins.
 * Each plugin registers its node definitions with the node registry.
 */
export class PluginLoader {
  private readonly loadedPlugins = new Map<string, LoadedPlugin>();

  constructor(private readonly registry: NodeRegistry) {}

  /**
   * Load a single plugin.
   * Calls the plugin's register() method, passing a callback that registers
   * each node definition with the registry.
   *
   * @throws Error if a plugin with the same name is already loaded.
   */
  load(plugin: IPlugin): LoadedPlugin {
    if (this.loadedPlugins.has(plugin.name)) {
      throw new Error(
        `Plugin "${plugin.name}" is already loaded. ` +
          `Unload it first before reloading.`,
      );
    }

    let nodeCount = 0;

    const registerNode = (definition: INodeDefinition): void => {
      this.registry.register(definition);
      nodeCount++;
    };

    plugin.register(registerNode);

    const loaded: LoadedPlugin = {
      name: plugin.name,
      version: plugin.version,
      description: plugin.description,
      nodeCount,
      loadedAt: new Date().toISOString(),
    };

    this.loadedPlugins.set(plugin.name, loaded);

    console.log(
      `[PluginLoader] Loaded "${plugin.name}" v${plugin.version} (${nodeCount} nodes)`,
    );

    return loaded;
  }

  /**
   * Load multiple plugins at once.
   * Plugins are loaded in order; if one fails, previously loaded plugins remain.
   */
  loadAll(plugins: IPlugin[]): LoadedPlugin[] {
    return plugins.map((plugin) => this.load(plugin));
  }

  /**
   * Get metadata about a loaded plugin.
   */
  getLoaded(name: string): LoadedPlugin | undefined {
    return this.loadedPlugins.get(name);
  }

  /**
   * Get all loaded plugins.
   */
  getAllLoaded(): LoadedPlugin[] {
    return Array.from(this.loadedPlugins.values());
  }

  /**
   * Check if a plugin is loaded.
   */
  isLoaded(name: string): boolean {
    return this.loadedPlugins.has(name);
  }
}

/**
 * Create a new PluginLoader instance bound to a registry.
 */
export function createPluginLoader(registry: NodeRegistry): PluginLoader {
  return new PluginLoader(registry);
}
