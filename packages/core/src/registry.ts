/**
 * @module @beamflow/core/registry
 *
 * The central node registry. This is the heart of BeamFlow's plugin architecture.
 *
 * Design decisions:
 * - The registry knows NOTHING about specific node types
 * - All node definitions must implement INodeDefinition from @beamflow/shared
 * - Registration is event-driven so UI can react to new nodes
 * - Factory function (createRegistry) over singleton for testability
 */

import type { INodeDefinition, NodeCategory } from '@beamflow/shared';

/** Callback for registry change events. */
export type RegistryListener = (event: RegistryEvent) => void;

/** Events emitted by the registry. */
export interface RegistryEvent {
  readonly type: 'registered' | 'unregistered';
  readonly definition: INodeDefinition;
}

/**
 * The node registry — catalogs all available node types.
 * Plugins register their node definitions here during startup.
 */
export class NodeRegistry {
  private readonly definitions = new Map<string, INodeDefinition>();
  private readonly listeners = new Set<RegistryListener>();

  /**
   * Register a node definition.
   * @throws Error if a definition with the same type is already registered.
   */
  register(definition: INodeDefinition): void {
    if (this.definitions.has(definition.type)) {
      throw new Error(
        `Node type "${definition.type}" is already registered. ` +
          `Unregister it first or use a different type identifier.`,
      );
    }

    this.definitions.set(definition.type, definition);
    this.emit({ type: 'registered', definition });
  }

  /**
   * Unregister a node definition by type.
   * @returns true if the definition was found and removed.
   */
  unregister(type: string): boolean {
    const definition = this.definitions.get(type);
    if (!definition) return false;

    this.definitions.delete(type);
    this.emit({ type: 'unregistered', definition });
    return true;
  }

  /**
   * Get a node definition by its type identifier.
   */
  get(type: string): INodeDefinition | undefined {
    return this.definitions.get(type);
  }

  /**
   * Get all node definitions in a specific category.
   */
  getByCategory(category: NodeCategory): INodeDefinition[] {
    return Array.from(this.definitions.values()).filter(
      (def) => def.category === category,
    );
  }

  /**
   * Get all registered node definitions.
   */
  getAll(): INodeDefinition[] {
    return Array.from(this.definitions.values());
  }

  /**
   * Check if a node type is registered.
   */
  has(type: string): boolean {
    return this.definitions.has(type);
  }

  /**
   * Get the total number of registered node types.
   */
  get size(): number {
    return this.definitions.size;
  }

  /**
   * Subscribe to registry change events.
   * @returns Unsubscribe function.
   */
  subscribe(listener: RegistryListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Clear all registered definitions and listeners.
   * Primarily for testing.
   */
  clear(): void {
    this.definitions.clear();
    this.listeners.clear();
  }

  private emit(event: RegistryEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('[NodeRegistry] Listener error:', error);
      }
    }
  }
}

/**
 * Factory function to create a new NodeRegistry instance.
 * Prefer this over direct instantiation for testability.
 */
export function createRegistry(): NodeRegistry {
  return new NodeRegistry();
}
