/**
 * @module schema-store
 *
 * Zustand store slice for the BeamFlow design-time schema system.
 *
 * Manages:
 * - A SchemaPropagationEngine instance (singleton per editor session)
 * - Cached PipelineSchema per workflow node ID
 * - Schema validation issues per node
 * - Lineage tracker integration
 *
 * Integration with workflow-store:
 *   Call syncFromWorkflow() whenever the workflow graph changes (nodes added/
 *   removed, edges connected/disconnected, node settings updated).
 *   The schema store will recompute only affected schemas.
 *
 * Architecture note:
 *   This store is deliberately separate from workflow-store to maintain a clean
 *   separation between the React Flow graph state and design-time schema state.
 *   The workflow store triggers schema updates; the schema store is read-only
 *   from the UI's perspective.
 */

import { create } from 'zustand';
import {
  SchemaPropagationEngine,
  schemaNodeRegistry,
  lineageTracker,
  emptySchema,
} from '@beamflow/schema';
import type {
  PipelineSchema,
  SchemaValidationIssue,
  SchemaChangeEvent,
} from '@beamflow/schema';
import { registerBuiltinSchemaNodes } from '@beamflow/nodes';

// ─── One-time registration of built-in schema node factories ─────────────────
// This runs once when the module is first imported.
registerBuiltinSchemaNodes(schemaNodeRegistry);

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SchemaNodeState {
  /** The computed output schema for this node. */
  outputSchema: PipelineSchema;
  /** Validation issues detected at design-time. */
  issues: SchemaValidationIssue[];
}

/** Shape of a workflow edge (simplified from React Flow). */
export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
}

/** Shape of a workflow node (simplified from React Flow). */
export interface WorkflowNode {
  id: string;
  /** The node type string, e.g. 'beamflow:csv-source'. */
  nodeType: string;
  /** Node settings as configured in the property panel. */
  settings: Record<string, unknown>;
}

// ─── Store interface ──────────────────────────────────────────────────────────

interface SchemaStoreState {
  /** Map<nodeId, SchemaNodeState> for all nodes in the current workflow. */
  schemas: Map<string, SchemaNodeState>;

  /** The propagation engine instance (one per editor session). */
  engine: SchemaPropagationEngine;

  /**
   * Synchronise the schema engine with the full current workflow graph.
   * Call this when nodes or edges are added/removed, or the workflow is loaded.
   *
   * This performs a full rebuild of the engine's node/edge graph and then
   * triggers a full recomputation.
   */
  syncFromWorkflow: (nodes: WorkflowNode[], edges: WorkflowEdge[]) => void;

  /**
   * Notify the schema engine that a specific node's settings have changed.
   * Triggers recomputation of that node and all its downstream nodes only.
   */
  onNodeSettingsChanged: (
    nodeId: string,
    nodeType: string,
    newSettings: Record<string, unknown>,
  ) => void;

  /**
   * Notify the schema engine that an edge was added.
   * Triggers recomputation of the target node and its descendants.
   */
  onEdgeAdded: (sourceNodeId: string, targetNodeId: string) => void;

  /**
   * Notify the schema engine that an edge was removed.
   * Triggers recomputation of the former target node and its descendants.
   */
  onEdgeRemoved: (sourceNodeId: string, targetNodeId: string) => void;

  /** Get the output schema for a node (or an empty schema if not computed). */
  getSchema: (nodeId: string) => PipelineSchema;

  /** Get schema validation issues for a node. */
  getIssues: (nodeId: string) => SchemaValidationIssue[];

  /** Whether a node has any error-level validation issues. */
  hasErrors: (nodeId: string) => boolean;

  /** Clear all schema state (e.g., when a new workflow is created). */
  clearSchemas: () => void;
}

// ─── Store implementation ─────────────────────────────────────────────────────

const engine = new SchemaPropagationEngine();

export const useSchemaStore = create<SchemaStoreState>((set, get) => {
  // Subscribe to engine change events and update the Zustand store
  engine.subscribe((event: SchemaChangeEvent) => {
    const { schemas } = get();
    const schemaNode = schemaNodeRegistry.create(
      // We need node type to run validateSchema — look it up from our local map
      // (populated during syncFromWorkflow)
      nodeTypeMap.get(event.nodeId) ?? '',
      event.nodeId,
      nodeSettingsMap.get(event.nodeId) ?? {},
    );

    const inputSchemas: PipelineSchema[] = [];
    for (const [sourceId, targetId] of edgeMap) {
      if (targetId === event.nodeId) {
        const sourceSchema = engine.getSchema(sourceId);
        if (sourceSchema) inputSchemas.push(sourceSchema);
      }
    }

    const issues = schemaNode?.validateSchema(inputSchemas) ?? [];

    // Log the schema change in development so developers can see it working
    console.info(`[Schema Engine] Node "${event.nodeId}" updated:`, {
      columns: event.schema.columns.map((c) => `${c.name} (${c.type})`),
      issuesCount: issues.length,
      issues
    });

    // Also update lineage
    lineageTracker.indexSchema(event.nodeId, event.schema);

    const newSchemas = new Map(schemas);
    newSchemas.set(event.nodeId, { outputSchema: event.schema, issues });

    set({ schemas: newSchemas });
  });

  return {
    schemas: new Map(),
    engine,

    syncFromWorkflow: (nodes, edges) => {
      // Clear and rebuild
      engine.clear();
      lineageTracker.clear();
      nodeTypeMap.clear();
      nodeSettingsMap.clear();
      edgeMap.length = 0;

      // Register all nodes
      for (const node of nodes) {
        nodeTypeMap.set(node.id, node.nodeType);
        nodeSettingsMap.set(node.id, node.settings);

        const schemaNode = schemaNodeRegistry.create(node.nodeType, node.id, node.settings);
        if (schemaNode) {
          engine.registerNode(schemaNode);
        } else {
          // Unknown node type — register a passthrough stub so propagation continues
          engine.registerNode({
            nodeId: node.id,
            getOutputSchema: (inputs) => inputs[0] ?? emptySchema(),
            validateSchema: () => [],
          });
        }
      }

      // Register all edges
      for (const edge of edges) {
        engine.addEdge(edge.source, edge.target);
        edgeMap.push([edge.source, edge.target]);
      }

      // Full recomputation
      engine.recomputeAll();
    },

    onNodeSettingsChanged: (nodeId, nodeType, newSettings) => {
      nodeSettingsMap.set(nodeId, newSettings);
      nodeTypeMap.set(nodeId, nodeType);

      const schemaNode = schemaNodeRegistry.create(nodeType, nodeId, newSettings);
      if (schemaNode) {
        engine.registerNode(schemaNode);
      }
      engine.invalidateFrom(nodeId);
    },

    onEdgeAdded: (sourceNodeId, targetNodeId) => {
      engine.addEdge(sourceNodeId, targetNodeId);
      edgeMap.push([sourceNodeId, targetNodeId]);
      engine.invalidateFrom(targetNodeId);
    },

    onEdgeRemoved: (sourceNodeId, targetNodeId) => {
      engine.removeEdge(sourceNodeId, targetNodeId);
      const idx = edgeMap.findIndex(
        ([s, t]) => s === sourceNodeId && t === targetNodeId,
      );
      if (idx !== -1) edgeMap.splice(idx, 1);
      engine.invalidateFrom(targetNodeId);
    },

    getSchema: (nodeId) => {
      return get().schemas.get(nodeId)?.outputSchema ?? emptySchema();
    },

    getIssues: (nodeId) => {
      return get().schemas.get(nodeId)?.issues ?? [];
    },

    hasErrors: (nodeId) => {
      const issues = get().schemas.get(nodeId)?.issues ?? [];
      return issues.some((i) => i.severity === 'error');
    },

    clearSchemas: () => {
      engine.clear();
      lineageTracker.clear();
      nodeTypeMap.clear();
      nodeSettingsMap.clear();
      edgeMap.length = 0;
      set({ schemas: new Map() });
    },
  };
});

// ─── Module-level maps (shared with engine subscriber closure) ────────────────
// These live outside Zustand because they're implementation details, not UI state.

const nodeTypeMap = new Map<string, string>();
const nodeSettingsMap = new Map<string, Record<string, unknown>>();
const edgeMap: [string, string][] = [];

// ─── Convenience hooks ────────────────────────────────────────────────────────

/**
 * React hook: get the output schema for a specific node.
 *
 * @example
 * const schema = useNodeSchema('node_abc123');
 * schema.columns.map(col => col.name) // ['Region', 'Sales', 'Qty']
 */
export function useNodeSchema(nodeId: string): PipelineSchema {
  return useSchemaStore((state) => state.getSchema(nodeId));
}

/**
 * React hook: get validation issues for a specific node.
 *
 * @example
 * const issues = useNodeIssues('node_abc123');
 * issues.filter(i => i.severity === 'error') // error-level issues only
 */
export function useNodeIssues(nodeId: string): SchemaValidationIssue[] {
  return useSchemaStore((state) => state.getIssues(nodeId));
}

/**
 * React hook: check if a node has any schema errors.
 * Useful for showing an error badge on the node.
 */
export function useNodeHasErrors(nodeId: string): boolean {
  return useSchemaStore((state) => state.hasErrors(nodeId));
}

/**
 * React hook: get autocomplete suggestions for a formula editor.
 * Returns all column names available in the input schema of the given node.
 *
 * @example
 * const { columns, functions } = useFormulaAutocomplete('formula_node_id');
 */
export function useFormulaAutocomplete(nodeId: string): {
  columns: Array<{ name: string; type: string }>;
  functions: string[];
} {
  const schema = useSchemaStore((state) => state.getSchema(nodeId));
  const { getBuiltinFunctionNames } = require('@beamflow/schema');

  return {
    columns: schema.columns.map((c) => ({ name: c.name, type: c.type })),
    functions: getBuiltinFunctionNames(),
  };
}
