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
import { resolveSubflowOutputs } from '@beamflow/shared';
import { useWorkflowStore } from '../store/workflow-store';
import { trace } from './trace';

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
  /** React Flow source handle — used to match subflow output ports by name. */
  sourceHandle?: string | null;
  /** React Flow target handle — used to match subflow input ports by name. */
  targetHandle?: string | null;
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

function expandNodesAndEdgesForSchema(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  subflowCache: Record<string, any>
): { expandedNodes: WorkflowNode[], expandedEdges: WorkflowEdge[], subflowIssues: Map<string, SchemaValidationIssue> } {
  const expandedNodes = [...nodes];
  const expandedEdges = [...edges];
  // Design-time issues surfaced by the output-boundary classifier (e.g. an
  // orphaned terminal). Keyed by the offending node id; merged into the schemas
  // map after recompute so the node shows a warning WITHOUT blanking downstream.
  const subflowIssues = new Map<string, SchemaValidationIssue>();

  let hasSubflows = true;
  let depth = 0;
  while (hasSubflows) {
    if (depth++ > 10) break; // prevent infinite loops
    hasSubflows = false;
    
    // Find a subflow node that hasn't been expanded yet.
    // We can just find any system:subflow that doesn't have an internal proxy yet.
    // Actually, to make it easier, let's change the type of the expanded subflow node 
    // to 'system:subflow-proxy' so we don't process it again.
    const subflowNodeIndex = expandedNodes.findIndex(n => n.nodeType === 'system:subflow');
    if (subflowNodeIndex === -1) break;
    hasSubflows = true;

    const subflowNode = expandedNodes[subflowNodeIndex];
    // Change type to proxy so it's not expanded again
    subflowNode.nodeType = 'system:subflow-proxy';
    
    const subflowId = subflowNode.settings?.subflowId as string;
    const subflowDef = subflowId ? subflowCache[subflowId] : null;

    if (!subflowDef) {
      // If we don't have the definition, just leave it as a proxy that outputs nothing
      continue;
    }

    const prefix = `sub_${subflowNode.id}_`;
    
    // Map internal nodes
    const internalNodes = subflowDef.nodes.map((n: any) => {
      // Substitute parameters!
      const mappedSettings = { ...n.settings };
      if (subflowDef.metadata?.parameters) {
        for (const param of subflowDef.metadata.parameters) {
          if (param.targetNodeId === n.id && subflowNode.settings && param.id in subflowNode.settings) {
            mappedSettings[param.targetSettingKey] = subflowNode.settings[param.id];
          }
        }
      }
      return {
        id: prefix + n.id,
        nodeType: n.type,
        settings: mappedSettings,
      };
    });

    // Map internal edges
    const internalEdges = subflowDef.connections.map((c: any) => ({
      id: prefix + c.id,
      source: prefix + c.sourceNodeId,
      target: prefix + c.targetNodeId,
    }));

    expandedNodes.push(...internalNodes);
    expandedEdges.push(...internalEdges);

    const inputNodes = internalNodes.filter((n: any) => n.nodeType === 'system:subflow-input');
    const outputNodes = internalNodes.filter((n: any) => n.nodeType === 'system:subflow-output');

    // Build name → internal node id maps for port matching. The parent edge's handle
    // carries the boundary port name (see createSubflowFromSelection); older single-IO
    // subflows have no name match and fall back to index 0.
    const inputByName = new Map<string, string>();
    inputNodes.forEach((n: any) => {
      const name = (n.settings?.inputName as string) ?? '';
      if (name) inputByName.set(name, n.id);
    });

    // Rewire incoming edges Parent -> subflowNode  TO  Parent -> matching subflow-input.
    if (inputNodes.length > 0) {
      for (const e of expandedEdges) {
        if (e.target === subflowNode.id) {
          const byName = e.targetHandle ? inputByName.get(e.targetHandle) : undefined;
          e.target = byName ?? inputNodes[0].id;
        }
      }
    }

    // Resolve the output boundary with the shared classifier (same rules as the
    // server): auto-derive a single-terminal output when there's no explicit
    // output node, and propagate EVERY valid output to the proxy. If the classifier
    // reports an ambiguous/orphaned case we still wire the valid outputs (so schema
    // keeps flowing) and just record an issue — never blank everything.
    const activeInternal = internalNodes.filter(
      (n: any) => n.nodeType !== 'system:subflow-input' && n.nodeType !== 'system:subflow-output',
    );
    const resolution = resolveSubflowOutputs(
      activeInternal.map((n: any) => ({ id: n.id })),
      outputNodes.map((n: any) => ({ id: n.id })),
      internalEdges.map((e: any) => ({ from: e.source, to: e.target })),
    );
    for (const routing of resolution.outputs) {
      expandedEdges.push({
        id: `proxy_${subflowNode.id}_${routing.sourceId}`,
        source: routing.sourceId,
        target: subflowNode.id,
        sourceHandle: null,
        targetHandle: null,
      });
    }
    if (resolution.error) {
      subflowIssues.set(resolution.error.nodeId, {
        severity: 'error' as any,
        nodeId: resolution.error.nodeId,
        message: resolution.error.message,
      } as SchemaValidationIssue);
    }
  }

  return { expandedNodes, expandedEdges, subflowIssues };
}

export const useSchemaStore = create<SchemaStoreState>((set, get) => {
  // Subscribe to engine change events and update the Zustand store
  engine.subscribe((event: SchemaChangeEvent) => {
    const { schemas } = get();
    // Use 'system:subflow' for the proxy so it builds the right schema node
    const actualNodeType = nodeTypeMap.get(event.nodeId) === 'system:subflow-proxy' 
      ? 'system:subflow' 
      : (nodeTypeMap.get(event.nodeId) ?? '');

    const schemaNode = schemaNodeRegistry.create(
      actualNodeType,
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

    // Trace the schema recompute (only when the flow tracer is enabled).
    trace.schema(event.nodeId, event.schema.columns.map((c) => `${c.name}:${c.type}`));

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
      // Full rebuild. Reset the schemas map too, so nodes that no longer exist
      // don't leave a stale entry behind (the engine only re-emits for current
      // nodes; deleted ones would otherwise keep their last computed schema).
      engine.clear();
      lineageTracker.clear();
      nodeTypeMap.clear();
      nodeSettingsMap.clear();
      edgeMap.length = 0;
      set({ schemas: new Map() });

      // subflowCache is a hidden input to expansion; read it from the store.
      const subflowCache = useWorkflowStore.getState().subflowCache;

      const { expandedNodes, expandedEdges, subflowIssues } = expandNodesAndEdgesForSchema(
        JSON.parse(JSON.stringify(nodes)),
        JSON.parse(JSON.stringify(edges)),
        subflowCache
      );

      // Register all nodes
      for (const node of expandedNodes) {
        nodeTypeMap.set(node.id, node.nodeType);
        nodeSettingsMap.set(node.id, node.settings);

        // Map proxy back to generic custom/passthrough behavior
        if (node.nodeType === 'system:subflow-proxy') {
          engine.registerNode({
            nodeId: node.id,
            getOutputSchema: (inputs) => inputs[0] ?? emptySchema(),
            validateSchema: () => [],
          });
          continue;
        }

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
      for (const edge of expandedEdges) {
        engine.addEdge(edge.source, edge.target);
        edgeMap.push([edge.source, edge.target]);
      }

      // Full recomputation
      engine.recomputeAll();

      // Merge any output-boundary issues from expansion onto the offending nodes
      // (recomputeAll emitted schemas first; we augment their issues without
      // touching computed columns — schema still propagated for valid outputs).
      if (subflowIssues.size > 0) {
        const merged = new Map(get().schemas);
        for (const [nodeId, issue] of subflowIssues) {
          const entry = merged.get(nodeId);
          merged.set(nodeId, {
            outputSchema: entry?.outputSchema ?? emptySchema(),
            issues: [...(entry?.issues ?? []), issue],
          });
        }
        set({ schemas: merged });
      }
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
