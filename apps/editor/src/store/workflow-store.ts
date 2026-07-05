/**
 * Zustand store for the workflow editor.
 *
 * Manages:
 * - React Flow nodes and edges
 * - Selected node state
 * - Undo/redo history
 * - Node definitions (from API)
 * - Pipeline metadata
 */

import { create } from 'zustand';
import type { Node, Edge, OnNodesChange, OnEdgesChange, OnConnect, Connection } from '@xyflow/react';
import { applyNodeChanges, applyEdgeChanges, addEdge } from '@xyflow/react';
import { nanoid } from 'nanoid';
import type { NodeDef, SerializedWorkflowDTO } from '../api/client';
import {
  type CustomNodeDef,
  loadCustomNodes,
  saveCustomNodes,
  toNodeDef,
  compileInlineIR,
  isCustomType,
  CUSTOM_NODE_PREFIX,
} from '../customNodes';
import { api } from '../api/client';

// ─── Types ──────────────────────────────────────────────────────────

export interface NodeData {
  label: string;
  nodeType: string;
  category: string;
  icon: string;
  settings: Record<string, unknown>;
  [key: string]: unknown;
}

interface HistoryEntry {
  nodes: Node<NodeData>[];
  edges: Edge[];
}

export type ToastKind = 'success' | 'error' | 'info';

export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
}

export interface GeneratedArtifact {
  code: string;
  filename?: string;
  language?: string;
  requirements?: string[];
}

interface WorkflowState {
  // Pipeline metadata
  pipelineId: string | null;
  pipelineName: string;

  // React Flow state
  nodes: Node<NodeData>[];
  edges: Edge[];
  selectedNodeId: string | null;

  // Node definitions. `nodeDefinitions` is the merged list (built-in + custom)
  // consumed by the palette and property panel; the two source lists below feed
  // it so either can be updated independently.
  nodeDefinitions: NodeDef[];
  builtInDefinitions: NodeDef[];
  customNodeDefs: CustomNodeDef[];

  // Undo/redo
  history: HistoryEntry[];
  historyIndex: number;

  // UI state
  isGenerating: boolean;
  isExecuting: boolean;
  isSaving: boolean;
  generatedCode: string | null;
  generatedArtifact: GeneratedArtifact | null;
  executionLogs: string[];
  executionStatus: 'idle' | 'running' | 'success' | 'error';
  lastSavedAt: string | null;
  isDirty: boolean;
  toasts: Toast[];

  // Actions
  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;
  setSelectedNode: (id: string | null) => void;
  addNode: (type: string, position: { x: number; y: number }) => void;
  updateNodeSettings: (nodeId: string, settings: Record<string, unknown>) => void;
  removeSelectedNodes: () => void;
  setNodeDefinitions: (defs: NodeDef[]) => void;
  setPipelineId: (id: string | null) => void;
  setPipelineName: (name: string) => void;
  setGenerating: (v: boolean) => void;
  setExecuting: (v: boolean) => void;
  setSaving: (v: boolean) => void;
  setGeneratedCode: (code: string | null) => void;
  setGeneratedArtifact: (artifact: GeneratedArtifact | null) => void;
  setExecutionLogs: (logs: string[]) => void;
  appendExecutionLog: (line: string) => void;
  setExecutionStatus: (status: WorkflowState['executionStatus']) => void;
  markSaved: () => void;
  updateNodeLabel: (nodeId: string, label: string) => void;
  removeNode: (nodeId: string) => void;

  // Toasts
  addToast: (kind: ToastKind, message: string) => void;
  dismissToast: (id: string) => void;

  // Custom nodes
  loadCustomNodeDefs: () => void;
  upsertCustomNode: (def: CustomNodeDef) => void;
  deleteCustomNode: (id: string) => void;
  importCustomNodes: (defs: CustomNodeDef[]) => number;
  /** Group currently-selected nodes into a composite custom node. */
  groupSelectedIntoNode: (name: string) => Promise<{ ok: boolean; error?: string }>;
  /** How many nodes are currently selected (for enabling the group action). */
  selectedCount: () => number;

  // Undo/redo
  undo: () => void;
  redo: () => void;
  pushHistory: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  // Serialization
  toWorkflow: () => SerializedWorkflowDTO;
  loadWorkflow: (workflow: SerializedWorkflowDTO) => void;
  clearWorkflow: () => void;
}

const MAX_HISTORY = 50;

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  // Initial state
  pipelineId: null,
  pipelineName: 'Untitled Pipeline',
  nodes: [],
  edges: [],
  selectedNodeId: null,
  nodeDefinitions: [],
  builtInDefinitions: [],
  customNodeDefs: [],
  history: [],
  historyIndex: -1,
  isGenerating: false,
  isExecuting: false,
  isSaving: false,
  generatedCode: null,
  generatedArtifact: null,
  executionLogs: [],
  executionStatus: 'idle',
  lastSavedAt: null,
  isDirty: false,
  toasts: [],

  // ─── React Flow handlers ────────────────────────────────────────

  onNodesChange: (changes) => {
    // Only mark dirty on meaningful changes (position/add/remove), not selection
    const meaningful = changes.some(
      (c) => c.type === 'position' || c.type === 'add' || c.type === 'remove' || c.type === 'dimensions',
    );
    set({
      nodes: applyNodeChanges(changes, get().nodes) as Node<NodeData>[],
      ...(meaningful ? { isDirty: true } : {}),
    });
  },

  onEdgesChange: (changes) => {
    const meaningful = changes.some((c) => c.type === 'add' || c.type === 'remove');
    set({
      edges: applyEdgeChanges(changes, get().edges),
      ...(meaningful ? { isDirty: true } : {}),
    });
  },

  onConnect: (connection: Connection) => {
    get().pushHistory();
    set({
      edges: addEdge({ ...connection, id: `edge_${nanoid(8)}` }, get().edges),
      isDirty: true,
    });
  },

  // ─── Node actions ───────────────────────────────────────────────

  setSelectedNode: (id) => set({ selectedNodeId: id }),

  addNode: (type, position) => {
    const state = get();
    const def = state.nodeDefinitions.find((d) => d.type === type);
    if (!def) return;

    state.pushHistory();

    // Build default settings from definition
    const defaultSettings: Record<string, unknown> = {};
    for (const s of def.settings) {
      if (s.defaultValue !== undefined) {
        defaultSettings[s.key] = s.defaultValue;
      }
    }

    const newNode: Node<NodeData> = {
      id: `node_${nanoid(8)}`,
      type: def.category, // maps to our custom node components
      position,
      data: {
        label: def.name,
        nodeType: def.type,
        category: def.category,
        icon: def.icon,
        settings: defaultSettings,
      },
    };

    set({ nodes: [...state.nodes, newNode], selectedNodeId: newNode.id, isDirty: true });
  },

  updateNodeSettings: (nodeId, settings) => {
    const state = get();
    state.pushHistory();
    set({
      nodes: state.nodes.map((n) =>
        n.id === nodeId
          ? { ...n, data: { ...n.data, settings: { ...n.data.settings, ...settings } } }
          : n,
      ),
      isDirty: true,
    });
  },

  updateNodeLabel: (nodeId, label) => {
    const state = get();
    state.pushHistory();
    set({
      nodes: state.nodes.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, label } } : n,
      ),
      isDirty: true,
    });
  },

  removeNode: (nodeId) => {
    const state = get();
    state.pushHistory();
    set({
      nodes: state.nodes.filter((n) => n.id !== nodeId),
      edges: state.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
      selectedNodeId: state.selectedNodeId === nodeId ? null : state.selectedNodeId,
      isDirty: true,
    });
  },

  removeSelectedNodes: () => {
    const state = get();
    const selectedIds = state.nodes.filter((n) => n.selected).map((n) => n.id);
    if (selectedIds.length === 0) return;

    state.pushHistory();
    set({
      nodes: state.nodes.filter((n) => !n.selected),
      edges: state.edges.filter(
        (e) => !selectedIds.includes(e.source) && !selectedIds.includes(e.target),
      ),
      selectedNodeId:
        selectedIds.includes(state.selectedNodeId || '') ? null : state.selectedNodeId,
      isDirty: true,
    });
  },

  setNodeDefinitions: (defs) => {
    const custom = get().customNodeDefs.map(toNodeDef);
    set({ builtInDefinitions: defs, nodeDefinitions: [...defs, ...custom] });
  },
  setPipelineId: (id) => set({ pipelineId: id }),
  setPipelineName: (name) => set({ pipelineName: name, isDirty: true }),
  setGenerating: (v) => set({ isGenerating: v }),
  setExecuting: (v) => set({ isExecuting: v }),
  setSaving: (v) => set({ isSaving: v }),
  setGeneratedCode: (code) => set({ generatedCode: code }),
  setGeneratedArtifact: (artifact) =>
    set({ generatedArtifact: artifact, generatedCode: artifact?.code ?? null }),
  setExecutionLogs: (logs) => set({ executionLogs: logs }),
  appendExecutionLog: (line) =>
    set({ executionLogs: [...get().executionLogs, line] }),
  setExecutionStatus: (status) => set({ executionStatus: status }),
  markSaved: () =>
    set({ isDirty: false, lastSavedAt: new Date().toISOString() }),

  // ─── Toasts ─────────────────────────────────────────────────────
  addToast: (kind, message) => {
    const id = `toast_${nanoid(6)}`;
    set({ toasts: [...get().toasts, { id, kind, message }] });
    // Auto-dismiss after 4s
    setTimeout(() => {
      set({ toasts: get().toasts.filter((t) => t.id !== id) });
    }, 4000);
  },
  dismissToast: (id) =>
    set({ toasts: get().toasts.filter((t) => t.id !== id) }),

  // ─── Custom nodes ───────────────────────────────────────────────
  loadCustomNodeDefs: () => {
    const defs = loadCustomNodes();
    set({
      customNodeDefs: defs,
      nodeDefinitions: [...get().builtInDefinitions, ...defs.map(toNodeDef)],
    });
  },

  upsertCustomNode: (def) => {
    const existing = get().customNodeDefs;
    const idx = existing.findIndex((d) => d.id === def.id);
    const next =
      idx >= 0
        ? existing.map((d) => (d.id === def.id ? def : d))
        : [...existing, def];
    saveCustomNodes(next);
    set({
      customNodeDefs: next,
      nodeDefinitions: [...get().builtInDefinitions, ...next.map(toNodeDef)],
    });
  },

  deleteCustomNode: (id) => {
    const next = get().customNodeDefs.filter((d) => d.id !== id);
    saveCustomNodes(next);
    set({
      customNodeDefs: next,
      nodeDefinitions: [...get().builtInDefinitions, ...next.map(toNodeDef)],
    });
  },

  importCustomNodes: (defs) => {
    const existing = get().customNodeDefs;
    const byId = new Map(existing.map((d) => [d.id, d]));
    let added = 0;
    for (const def of defs) {
      if (!def || typeof def.id !== 'string') continue;
      if (!byId.has(def.id)) added += 1;
      byId.set(def.id, def); // imported wins on conflict
    }
    const next = Array.from(byId.values());
    saveCustomNodes(next);
    set({
      customNodeDefs: next,
      nodeDefinitions: [...get().builtInDefinitions, ...next.map(toNodeDef)],
    });
    return added;
  },

  selectedCount: () => get().nodes.filter((n) => n.selected).length,

  groupSelectedIntoNode: async (name) => {
    const state = get();
    const selected = state.nodes.filter((n) => n.selected);
    if (selected.length < 2) {
      return { ok: false, error: 'Select at least 2 nodes to group.' };
    }
    const selectedIds = new Set(selected.map((n) => n.id));

    // Internal vs boundary edges.
    const internalEdges = state.edges.filter(
      (e) => selectedIds.has(e.source) && selectedIds.has(e.target),
    );
    const inboundEdges = state.edges.filter(
      (e) => !selectedIds.has(e.source) && selectedIds.has(e.target),
    );
    const outboundEdges = state.edges.filter(
      (e) => selectedIds.has(e.source) && !selectedIds.has(e.target),
    );

    // v1 constraint: at most one external input and one external output so the
    // composite has a clean single-in / single-out boundary.
    if (inboundEdges.length > 1) {
      return { ok: false, error: 'Grouped nodes may have at most one incoming connection from outside.' };
    }
    if (outboundEdges.length > 1) {
      return { ok: false, error: 'Grouped nodes may have at most one outgoing connection to outside.' };
    }

    // Build the sub-workflow payload (include inlineIR for custom inner nodes).
    const subNodes = selected.map((n) => {
      const base = {
        id: n.id,
        type: n.data.nodeType,
        settings: n.data.settings,
        position: n.position,
        label: n.data.label,
      };
      if (isCustomType(n.data.nodeType)) {
        const def = state.customNodeDefs.find((d) => d.id === n.data.nodeType);
        if (def) return { ...base, inlineIR: compileInlineIR(def, n.data.settings) };
      }
      return base;
    });
    const subConnections = internalEdges.map((e) => ({
      id: e.id,
      sourceNodeId: e.source,
      sourcePortId: e.sourceHandle || 'out',
      targetNodeId: e.target,
      targetPortId: e.targetHandle || 'in',
    }));

    let steps;
    try {
      const res = await api.compileSubgraph({ nodes: subNodes, connections: subConnections });
      steps = res.steps;
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    if (!steps || steps.length === 0) {
      return { ok: false, error: 'Could not compile the selected nodes.' };
    }

    // Persist the composite definition.
    const def: CustomNodeDef = {
      id: `${CUSTOM_NODE_PREFIX}${nanoid(8)}`,
      name: name.trim() || 'Grouped Node',
      description: `Composite of ${selected.length} nodes`,
      icon: 'box',
      kind: 'composite',
      steps: steps.map((s) => ({
        operation: s.operation,
        stepType: s.stepType,
        params: s.params,
        imports: s.imports,
        label: s.label,
      })),
      createdAt: new Date().toISOString(),
    };
    get().upsertCustomNode(def);

    // Replace the selected nodes with a single composite instance.
    state.pushHistory();
    const avgX = selected.reduce((sum, n) => sum + n.position.x, 0) / selected.length;
    const avgY = selected.reduce((sum, n) => sum + n.position.y, 0) / selected.length;
    const compositeId = `node_${nanoid(8)}`;
    const compositeNode: Node<NodeData> = {
      id: compositeId,
      type: 'custom',
      position: { x: avgX, y: avgY },
      data: {
        label: def.name,
        nodeType: def.id,
        category: 'custom',
        icon: def.icon,
        settings: {},
      },
    };

    // Rewire boundary edges to the new node; drop internal + old nodes.
    const remainingNodes = state.nodes.filter((n) => !selectedIds.has(n.id));
    const rewiredEdges: Edge[] = [];
    for (const e of state.edges) {
      if (internalEdges.includes(e)) continue;
      if (selectedIds.has(e.source) && selectedIds.has(e.target)) continue;
      if (selectedIds.has(e.target)) {
        rewiredEdges.push({ ...e, target: compositeId, targetHandle: 'in' });
      } else if (selectedIds.has(e.source)) {
        rewiredEdges.push({ ...e, source: compositeId, sourceHandle: 'out' });
      } else {
        rewiredEdges.push(e);
      }
    }

    set({
      nodes: [...remainingNodes, compositeNode],
      edges: rewiredEdges,
      selectedNodeId: compositeId,
      isDirty: true,
    });

    return { ok: true };
  },

  // ─── Undo/Redo ─────────────────────────────────────────────────

  pushHistory: () => {
    const state = get();
    const entry: HistoryEntry = {
      nodes: JSON.parse(JSON.stringify(state.nodes)),
      edges: JSON.parse(JSON.stringify(state.edges)),
    };
    const newHistory = state.history.slice(0, state.historyIndex + 1);
    newHistory.push(entry);
    if (newHistory.length > MAX_HISTORY) newHistory.shift();
    set({ history: newHistory, historyIndex: newHistory.length - 1 });
  },

  undo: () => {
    const state = get();
    if (state.historyIndex < 0) return;
    const entry = state.history[state.historyIndex];
    set({
      nodes: entry.nodes,
      edges: entry.edges,
      historyIndex: state.historyIndex - 1,
    });
  },

  redo: () => {
    const state = get();
    if (state.historyIndex >= state.history.length - 1) return;
    const nextEntry = state.history[state.historyIndex + 1];
    set({
      nodes: nextEntry.nodes,
      edges: nextEntry.edges,
      historyIndex: state.historyIndex + 1,
    });
  },

  canUndo: () => get().historyIndex >= 0,
  canRedo: () => get().historyIndex < get().history.length - 1,

  // ─── Serialization ─────────────────────────────────────────────

  toWorkflow: (): SerializedWorkflowDTO => {
    const state = get();
    const now = new Date().toISOString();
    return {
      schemaVersion: '1.0.0',
      metadata: {
        id: state.pipelineId || `pipeline_${nanoid(8)}`,
        name: state.pipelineName,
        createdAt: now,
        updatedAt: now,
      },
      nodes: state.nodes.map((n) => {
        const base = {
          id: n.id,
          type: n.data.nodeType,
          settings: n.data.settings,
          position: n.position,
          label: n.data.label,
        };
        // Custom nodes embed their compiled IR so the server can generate code
        // without knowing the (browser-only) definition.
        if (isCustomType(n.data.nodeType)) {
          const def = state.customNodeDefs.find((d) => d.id === n.data.nodeType);
          if (def) {
            return { ...base, inlineIR: compileInlineIR(def, n.data.settings) };
          }
        }
        return base;
      }),
      connections: state.edges.map((e) => ({
        id: e.id,
        sourceNodeId: e.source,
        sourcePortId: e.sourceHandle || 'out',
        targetNodeId: e.target,
        targetPortId: e.targetHandle || 'in',
      })),
    };
  },

  loadWorkflow: (workflow) => {
    const state = get();
    const nodes: Node<NodeData>[] = workflow.nodes.map((n) => {
      const def = state.nodeDefinitions.find((d) => d.type === n.type);
      return {
        id: n.id,
        type: def?.category || 'transform',
        position: n.position,
        data: {
          label: n.label || def?.name || n.type,
          nodeType: n.type,
          category: def?.category || 'transform',
          icon: def?.icon || 'box',
          settings: n.settings,
        },
      };
    });

    const edges: Edge[] = workflow.connections.map((c) => ({
      id: c.id,
      source: c.sourceNodeId,
      sourceHandle: c.sourcePortId,
      target: c.targetNodeId,
      targetHandle: c.targetPortId,
    }));

    set({
      pipelineId: workflow.metadata.id,
      pipelineName: workflow.metadata.name,
      nodes,
      edges,
      selectedNodeId: null,
      history: [],
      historyIndex: -1,
      isDirty: false,
    });
  },

  clearWorkflow: () => {
    set({
      nodes: [],
      edges: [],
      selectedNodeId: null,
      history: [],
      historyIndex: -1,
      generatedCode: null,
      generatedArtifact: null,
      executionLogs: [],
      executionStatus: 'idle',
      isDirty: false,
    });
  },
}));
