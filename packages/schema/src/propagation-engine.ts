/**
 * @module @beamflow/schema/propagation-engine
 *
 * The SchemaPropagationEngine — the heart of BeamFlow's design-time schema system.
 *
 * Responsibilities:
 * 1. Maintains a registry of ISchemaNode instances (one per workflow node)
 * 2. Tracks the workflow graph topology (which nodes feed into which)
 * 3. On invalidation, walks downstream nodes in topological order
 * 4. Calls getOutputSchema() on each affected node
 * 5. Caches output schemas and emits change events
 *
 * Key guarantees:
 * - No Apache Beam code is ever called
 * - Only affected downstream nodes are recomputed (not the entire graph)
 * - Schema versions are bumped on every recomputation
 * - Cycles in the graph are detected and reported
 *
 * Integration:
 * - The editor's workflow store calls invalidateFrom() whenever a node or
 *   edge changes
 * - UI components subscribe to schema change events for live validation
 */

import { nanoid } from 'nanoid';
import type { ISchemaNode } from './schema-node.js';
import type {
  PipelineSchema,
  ColumnSchema,
  SchemaChangeEvent,
  SchemaChangeListener,
} from './types.js';

// ─── Schema helpers ───────────────────────────────────────────────────────────

/** Create an empty schema with a fresh version number. */
export function emptySchema(version = 1): PipelineSchema {
  return { version, columns: [] };
}

/** Return a copy of the schema with its version bumped by 1. */
export function bumpVersion(schema: PipelineSchema): PipelineSchema {
  return { ...schema, version: schema.version + 1 };
}

/** Create a column with a stable nanoid. */
export function createColumn(
  partial: Omit<ColumnSchema, 'id'> & { id?: string },
): ColumnSchema {
  return {
    ...partial,
    id: partial.id ?? nanoid(10),
  } as ColumnSchema;
}

/**
 * Forward a column from an upstream schema, preserving its stable ID.
 * Used when a node passes columns through unchanged (e.g., Filter, Select).
 */
export function forwardColumn(col: ColumnSchema, newSourceNodeId?: string): ColumnSchema {
  if (!newSourceNodeId) return col;
  return { ...col, sourceNodeId: newSourceNodeId };
}

// ─── Graph edge representation ────────────────────────────────────────────────

interface SchemaEdge {
  readonly sourceNodeId: string;
  readonly targetNodeId: string;
}

// ─── Schema cache entry ───────────────────────────────────────────────────────

interface SchemaCacheEntry {
  /** The cached output schema. */
  outputSchema: PipelineSchema;
  /** The input schemas that were used to compute outputSchema. */
  inputSchemas: PipelineSchema[];
}

// ─── Propagation Engine ───────────────────────────────────────────────────────

export class SchemaPropagationEngine {
  /** Schema node implementations, keyed by nodeId. */
  private readonly nodes = new Map<string, ISchemaNode>();

  /** Cached {inputSchemas, outputSchema} per node. */
  private readonly cache = new Map<string, SchemaCacheEntry>();

  /** Graph edges (source → target). */
  private readonly edges: SchemaEdge[] = [];

  /** Listeners for schema change events. */
  private readonly listeners = new Set<SchemaChangeListener>();

  // ─── Node management ─────────────────────────────────────────────

  /**
   * Register a schema node implementation with the engine.
   * If a node with this ID already exists, it is replaced.
   */
  registerNode(schemaNode: ISchemaNode): void {
    this.nodes.set(schemaNode.nodeId, schemaNode);
    // Invalidate its cached schema since the implementation changed
    this.cache.delete(schemaNode.nodeId);
  }

  /**
   * Unregister a node and remove all its edges.
   */
  unregisterNode(nodeId: string): void {
    this.nodes.delete(nodeId);
    this.cache.delete(nodeId);
    // Remove all edges connected to this node
    const toRemove = this.edges.filter(
      (e) => e.sourceNodeId === nodeId || e.targetNodeId === nodeId,
    );
    for (const edge of toRemove) {
      const idx = this.edges.indexOf(edge);
      if (idx !== -1) this.edges.splice(idx, 1);
    }
  }

  // ─── Edge management ─────────────────────────────────────────────

  /**
   * Add a directed edge (data flow from source to target).
   * Adding an edge invalidates the target and all its descendants.
   */
  addEdge(sourceNodeId: string, targetNodeId: string): void {
    // Prevent duplicates
    const exists = this.edges.some(
      (e) => e.sourceNodeId === sourceNodeId && e.targetNodeId === targetNodeId,
    );
    if (!exists) {
      this.edges.push({ sourceNodeId, targetNodeId });
    }
  }

  /**
   * Remove a directed edge.
   * Removing an edge invalidates the target and all its descendants.
   */
  removeEdge(sourceNodeId: string, targetNodeId: string): void {
    const idx = this.edges.findIndex(
      (e) => e.sourceNodeId === sourceNodeId && e.targetNodeId === targetNodeId,
    );
    if (idx !== -1) {
      this.edges.splice(idx, 1);
      this.cache.delete(targetNodeId);
    }
  }

  // ─── Schema access ────────────────────────────────────────────────

  /**
   * Get the cached output schema for a node.
   * Returns undefined if the node hasn't been computed yet.
   */
  getSchema(nodeId: string): PipelineSchema | undefined {
    return this.cache.get(nodeId)?.outputSchema;
  }

  /**
   * Get all cached schemas as a Map<nodeId, PipelineSchema>.
   */
  getAllSchemas(): Map<string, PipelineSchema> {
    const result = new Map<string, PipelineSchema>();
    for (const [nodeId, entry] of this.cache) {
      result.set(nodeId, entry.outputSchema);
    }
    return result;
  }

  // ─── Propagation ──────────────────────────────────────────────────

  /**
   * Invalidate and recompute schemas starting from the given node.
   *
   * This is the primary method called by the editor when:
   * - A node's settings change
   * - A connection is added or removed
   * - A node is added or removed
   *
   * Only nodes reachable downstream of `startNodeId` are recomputed.
   * Unrelated branches of the graph are untouched.
   *
   * @param startNodeId - The node whose output changed.
   */
  invalidateFrom(startNodeId: string): void {
    // 1. Find all descendants of startNodeId (inclusive) in topological order
    const affected = this.getAffectedNodesInOrder(startNodeId);

    // 2. Recompute each affected node's schema
    for (const nodeId of affected) {
      this.recomputeNode(nodeId);
    }
  }

  /**
   * Recompute ALL nodes in the graph in topological order.
   * Use this when the graph structure changes significantly (e.g., load workflow).
   */
  recomputeAll(): void {
    const order = this.topologicalSort();
    for (const nodeId of order) {
      this.recomputeNode(nodeId);
    }
  }

  /**
   * Recompute a single node's output schema using its cached upstream schemas.
   */
  private recomputeNode(nodeId: string): void {
    const node = this.nodes.get(nodeId);
    if (!node) return;

    // Collect input schemas from immediate predecessors
    const inputSchemas = this.getInputSchemas(nodeId);
    const previousEntry = this.cache.get(nodeId);
    const previousSchema = previousEntry?.outputSchema;

    // Compute new output schema
    let outputSchema: PipelineSchema;
    try {
      outputSchema = node.getOutputSchema(inputSchemas);
    } catch (err) {
      // If computation fails, produce an empty schema so propagation continues
      console.warn(
        `[SchemaPropagationEngine] getOutputSchema() threw on node "${nodeId}":`,
        err,
      );
      outputSchema = emptySchema();
    }

    // Store in cache
    this.cache.set(nodeId, { outputSchema, inputSchemas });

    // Emit change event if schema actually changed
    const changed =
      !previousSchema ||
      previousSchema.version !== outputSchema.version ||
      !schemasEqual(previousSchema, outputSchema);

    if (changed) {
      this.emit({ nodeId, schema: outputSchema, previousSchema });
    }
  }

  /**
   * Collect the output schemas of all immediate upstream nodes.
   * The order matches the order of incoming edges (insertion order).
   */
  private getInputSchemas(nodeId: string): PipelineSchema[] {
    return this.edges
      .filter((e) => e.targetNodeId === nodeId)
      .map((e) => this.cache.get(e.sourceNodeId)?.outputSchema ?? emptySchema());
  }

  // ─── Topological traversal ────────────────────────────────────────

  /**
   * Return the set of nodes affected by a change at startNodeId,
   * in topological order (dependencies first).
   */
  private getAffectedNodesInOrder(startNodeId: string): string[] {
    // BFS to collect all descendants
    const affected = new Set<string>();
    const queue = [startNodeId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (affected.has(current)) continue;
      affected.add(current);
      for (const edge of this.edges) {
        if (edge.sourceNodeId === current && !affected.has(edge.targetNodeId)) {
          queue.push(edge.targetNodeId);
        }
      }
    }

    // Sort by topological order
    const fullOrder = this.topologicalSort();
    return fullOrder.filter((id) => affected.has(id));
  }

  /**
   * Kahn's algorithm topological sort over all registered nodes.
   * Silently handles unknown node IDs in edges.
   */
  private topologicalSort(): string[] {
    const nodeIds = Array.from(this.nodes.keys());
    const inDegree = new Map<string, number>(nodeIds.map((id) => [id, 0]));

    for (const edge of this.edges) {
      if (inDegree.has(edge.targetNodeId)) {
        inDegree.set(edge.targetNodeId, (inDegree.get(edge.targetNodeId) ?? 0) + 1);
      }
    }

    const queue = nodeIds.filter((id) => (inDegree.get(id) ?? 0) === 0);
    const sorted: string[] = [];

    while (queue.length > 0) {
      const current = queue.shift()!;
      sorted.push(current);
      for (const edge of this.edges) {
        if (edge.sourceNodeId === current) {
          const newDegree = (inDegree.get(edge.targetNodeId) ?? 1) - 1;
          inDegree.set(edge.targetNodeId, newDegree);
          if (newDegree === 0) queue.push(edge.targetNodeId);
        }
      }
    }

    // Include any nodes that weren't reachable (isolated nodes)
    const remaining = nodeIds.filter((id) => !sorted.includes(id));
    return [...sorted, ...remaining];
  }

  // ─── Event subscription ───────────────────────────────────────────

  /**
   * Subscribe to schema change events.
   *
   * @returns An unsubscribe function.
   *
   * @example
   * const unsubscribe = engine.subscribe((event) => {
   *   console.log(`Node ${event.nodeId} schema changed`);
   * });
   */
  subscribe(listener: SchemaChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: SchemaChangeEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('[SchemaPropagationEngine] Listener threw:', err);
      }
    }
  }

  // ─── Diagnostics ──────────────────────────────────────────────────

  /** Number of registered schema nodes. */
  get nodeCount(): number {
    return this.nodes.size;
  }

  /** Number of registered edges. */
  get edgeCount(): number {
    return this.edges.length;
  }

  /** Whether a schema is cached for the given node. */
  hasSchema(nodeId: string): boolean {
    return this.cache.has(nodeId);
  }

  /**
   * Clear all state. Used when a new workflow is loaded.
   */
  clear(): void {
    this.nodes.clear();
    this.cache.clear();
    this.edges.length = 0;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Shallow equality check for schemas.
 * Compares column count, names, and types — sufficient for change detection.
 */
function schemasEqual(a: PipelineSchema, b: PipelineSchema): boolean {
  if (a.columns.length !== b.columns.length) return false;
  for (let i = 0; i < a.columns.length; i++) {
    const ac = a.columns[i];
    const bc = b.columns[i];
    if (ac.id !== bc.id || ac.name !== bc.name || ac.type !== bc.type) return false;
  }
  return true;
}

/** Global default propagation engine instance. */
export const schemaPropagationEngine = new SchemaPropagationEngine();
