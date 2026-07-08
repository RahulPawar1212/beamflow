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
import { useSchemaStore } from '../lib/schema-store';
import { trace } from '../lib/trace';

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

export interface NavigationStackEntry {
  pipelineId: string | null;
  pipelineName: string;
  nodes: Node<NodeData>[];
  edges: Edge[];
  history: HistoryEntry[];
  historyIndex: number;
}

interface WorkflowState {
  // Pipeline metadata
  pipelineId: string | null;
  pipelineName: string;
  isSubflow: boolean;
  pipelineParameters: Array<{ id: string; name: string; type: string; targetNodeId: string; targetSettingKey: string; }>;

  // Active project — new pipelines/subflows are created inside it, and the
  // Workflows list is scoped to it.
  currentProjectId: string | null;
  currentProjectName: string;

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

  // Subflow Navigation Stack
  navigationStack: NavigationStackEntry[];

  // UI state
  isGenerating: boolean;
  isExecuting: boolean;
  isSaving: boolean;
  generatedCode: string | null;
  generatedArtifact: GeneratedArtifact | null;
  executionLogs: string[];
  executionStatus: 'idle' | 'running' | 'success' | 'error';
  cancelExecution: (() => void) | null;
  lastSavedAt: string | null;
  isDirty: boolean;
  toasts: Toast[];
  theme: 'dark' | 'light' | 'mid';

  // Preview Panel State
  isPreviewPanelOpen: boolean;
  previewNodeId: string | null;
  previewRefreshKey: number;

  // Actions
  toggleTheme: () => void;
  initTheme: () => void;
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
  setCancelExecution: (fn: (() => void) | null) => void;
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
  /** Create a new Subflow from the currently selected nodes. */
  createSubflowFromSelection: (name: string) => Promise<{ ok: boolean; error?: string }>;
  /** How many nodes are currently selected (for enabling the group action). */
  selectedCount: () => number;

  // Preview Panel Actions
  openPreviewPanel: (nodeId: string) => void;
  closePreviewPanel: () => void;

  // AI Panel State
  isAIPanelOpen: boolean;
  openAIPanel: () => void;
  closeAIPanel: () => void;

  // Settings Modal State
  isSettingsModalOpen: boolean;
  setSettingsModalOpen: (isOpen: boolean) => void;

  // Undo/redo
  undo: () => void;
  redo: () => void;
  pushHistory: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  // Serialization
  toWorkflow: () => SerializedWorkflowDTO;
  saveWorkflow: () => Promise<boolean>;
  duplicateWorkflow: () => Promise<string | null>;
  loadWorkflow: (workflow: SerializedWorkflowDTO, clearStack?: boolean) => void;
  clearWorkflow: () => void;

  // Projects
  setCurrentProject: (id: string | null, name: string) => void;

  // Subflow Navigation
  enterSubflow: (subflow: SerializedWorkflowDTO) => void;
  exitSubflow: () => void;

  // Subflow Schema Cache
  subflowCache: Record<string, SerializedWorkflowDTO>;
  // Bumped whenever subflowCache is (re)populated. Part of the schema
  // fingerprint (see lib/schema-sync.ts) so a cache refresh re-syncs schema
  // even when nodes/edges are unchanged.
  subflowCacheVersion: number;
  refreshSubflowCache: (force?: boolean) => Promise<void>;

  // Pipeline Parameters
  togglePipelineParameter: (targetNodeId: string, targetSettingKey: string, settingDef: any) => void;
}

const MAX_HISTORY = 50;

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  // Initial state
  pipelineId: null,
  pipelineName: 'Untitled Pipeline',
  isSubflow: false,
  pipelineParameters: [],
  currentProjectId: null,
  currentProjectName: '',
  nodes: [],
  edges: [],
  selectedNodeId: null,
  nodeDefinitions: [],
  builtInDefinitions: [],
  customNodeDefs: [],
  history: [],
  historyIndex: -1,
  navigationStack: [],
  subflowCache: {},
  subflowCacheVersion: 0,
  isGenerating: false,
  isExecuting: false,
  isSaving: false,
  generatedCode: null,
  generatedArtifact: null,
  executionLogs: [],
  executionStatus: 'idle',
  cancelExecution: null,
  lastSavedAt: null,
  isDirty: false,
  toasts: [],
  theme: 'mid',

  isPreviewPanelOpen: false,
  previewNodeId: null,
  previewRefreshKey: 0,
  
  isAIPanelOpen: false,
  isSettingsModalOpen: false,
  setSettingsModalOpen: (isOpen) => set({ isSettingsModalOpen: isOpen }),

  // ─── Theme Actions ──────────────────────────────────────────────

  initTheme: () => {
    const saved = localStorage.getItem('beamflow.theme') as 'dark' | 'light' | 'mid';
    const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = saved || (systemPrefersDark ? 'dark' : 'light');
    set({ theme });
    
    document.documentElement.classList.remove('light', 'mid');
    if (theme !== 'dark') {
      document.documentElement.classList.add(theme);
    }
  },

  toggleTheme: () => {
    const current = get().theme;
    let nextTheme: 'dark' | 'light' | 'mid' = 'dark';
    if (current === 'dark') nextTheme = 'light';
    else if (current === 'light') nextTheme = 'mid';
    else nextTheme = 'dark';

    localStorage.setItem('beamflow.theme', nextTheme);
    set({ theme: nextTheme });
    
    document.documentElement.classList.remove('light', 'mid');
    if (nextTheme !== 'dark') {
      document.documentElement.classList.add(nextTheme);
    }
  },

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
    trace.action('onConnect', { source: connection.source, target: connection.target });
    get().pushHistory();
    const newEdgeId = `edge_${nanoid(8)}`;
    set({
      edges: addEdge({ ...connection, id: newEdgeId }, get().edges),
      isDirty: true,
    });
    // Schema resync is handled centrally (lib/schema-sync.ts) — the new edge
    // changes the schema fingerprint, which triggers one rebuild. If the source
    // is a subflow whose definition isn't cached yet, fetch it; the cache-version
    // bump then drives the resync.
    if (connection.source) {
      const srcNode = get().nodes.find((n) => n.id === connection.source);
      if (srcNode?.data?.nodeType === 'system:subflow') get().refreshSubflowCache();
    }
  },

  // ─── Node actions ───────────────────────────────────────────────

  openPreviewPanel: (nodeId) => set((state) => ({ 
    isPreviewPanelOpen: true, 
    previewNodeId: nodeId,
    previewRefreshKey: state.previewRefreshKey + 1 
  })),
  closePreviewPanel: () => set({ isPreviewPanelOpen: false }),

  openAIPanel: () => set({ isAIPanelOpen: true }),
  closeAIPanel: () => set({ isAIPanelOpen: false }),

  setSelectedNode: (id) => set({ selectedNodeId: id }),

  addNode: (type, position) => {
    trace.action('addNode', { type });
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

    // Schema resync is central (lib/schema-sync.ts). If a subflow was added,
    // fetch its definition so it can be inlined; the cache bump drives the sync.
    if (newNode.data.nodeType === 'system:subflow') {
      get().refreshSubflowCache();
    }
  },

  updateNodeSettings: (nodeId, settings) => {
    trace.action('updateNodeSettings', { nodeId, keys: Object.keys(settings) });
    const state = get();
    state.pushHistory();
    const updatedNodes = state.nodes.map((n) =>
      n.id === nodeId
        ? { ...n, data: { ...n.data, settings: { ...n.data.settings, ...settings } } }
        : n,
    );
    set({ nodes: updatedNodes, isDirty: true });

    // Schema resync is central: the settings change alters the schema fingerprint
    // and triggers one rebuild. If a subflow node was re-pointed at a different
    // child, fetch that child's definition (force, so a re-point to an already-
    // cached id still bumps the cache version and re-inlines).
    const updatedNode = updatedNodes.find((n) => n.id === nodeId);
    if (updatedNode?.data.nodeType === 'system:subflow' && 'subflowId' in settings) {
      get().refreshSubflowCache(true);
    }
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
    trace.action('removeNode', { nodeId });
    const state = get();
    state.pushHistory();
    set({
      nodes: state.nodes.filter((n) => n.id !== nodeId),
      edges: state.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
      selectedNodeId: state.selectedNodeId === nodeId ? null : state.selectedNodeId,
      isDirty: true,
    });
    // Schema resync is central (lib/schema-sync.ts) — removing the node/edges
    // changes the fingerprint and triggers one rebuild.
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
  setCancelExecution: (fn) => set({ cancelExecution: fn }),
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

  createSubflowFromSelection: async (name) => {
    const state = get();
    trace.action('createSubflowFromSelection', { name, selected: state.nodes.filter((n) => n.selected).length });
    const selected = state.nodes.filter((n) => n.selected);
    if (selected.length < 1) {
      return { ok: false, error: 'Select at least 1 node to group.' };
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

    // Build the sub-workflow payload
    const subNodes: any[] = selected.map((n) => {
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

    const subConnections: any[] = internalEdges.map((e) => ({
      id: e.id,
      sourceNodeId: e.source,
      sourcePortId: e.sourceHandle || 'out',
      targetNodeId: e.target,
      targetPortId: e.targetHandle || 'in',
    }));

    // Calculate layout for subflow inputs/outputs
    const minX = Math.min(...selected.map((n) => n.position.x));
    const maxX = Math.max(...selected.map((n) => n.position.x));
    const avgY = selected.reduce((sum, n) => sum + n.position.y, 0) / selected.length;

    // For inbound edges, create Subflow Input nodes. Record the port name so the
    // rewired parent edge can carry it as its targetHandle (multi-input support).
    const inboundMapping = new Map<string, string>(); // Original edge ID -> inputName (port id)
    inboundEdges.forEach((e, i) => {
      const inputId = `node_${nanoid(8)}`;
      const inputName = `Input ${i + 1}`;
      inboundMapping.set(e.id, inputName);
      subNodes.push({
        id: inputId,
        type: 'system:subflow-input',
        settings: { inputName },
        position: { x: minX - 300, y: avgY + (i * 100) },
        label: inputName,
      });
      subConnections.push({
        id: `edge_${nanoid(8)}`,
        sourceNodeId: inputId,
        sourcePortId: 'out',
        targetNodeId: e.target,
        targetPortId: e.targetHandle || 'in',
      });
    });

    // For outbound edges, create Subflow Output nodes. Record the port name so the
    // rewired parent edge can carry it as its sourceHandle (multi-output support).
    const outboundMapping = new Map<string, string>(); // Original edge ID -> outputName (port id)
    outboundEdges.forEach((e, i) => {
      const outputId = `node_${nanoid(8)}`;
      const outputName = `Output ${i + 1}`;
      outboundMapping.set(e.id, outputName);
      subNodes.push({
        id: outputId,
        type: 'system:subflow-output',
        settings: { outputName },
        position: { x: maxX + 300, y: avgY + (i * 100) },
        label: outputName,
      });
      subConnections.push({
        id: `edge_${nanoid(8)}`,
        sourceNodeId: e.source,
        sourcePortId: e.sourceHandle || 'out',
        targetNodeId: outputId,
        targetPortId: 'in',
      });
    });

    // Save the subflow to the DB
    let createdSubflow;
    try {
      createdSubflow = await api.createPipeline({
        name: name.trim() || 'Subflow',
        isSubflow: true,
        // Subflows are a user-global shared library — not tied to a project.
        // The server ignores projectId for subflows; omit it here too.
        nodes: subNodes,
        connections: subConnections,
      });
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }

    // Replace the selected nodes with a single subflow node in the parent
    state.pushHistory();
    const avgX = selected.reduce((sum, n) => sum + n.position.x, 0) / selected.length;
    
    const subflowNodeId = `node_${nanoid(8)}`;
    const subflowNode: Node<NodeData> = {
      id: subflowNodeId,
      type: 'custom', // Render as custom node for generic styling
      position: { x: avgX, y: avgY },
      data: {
        label: createdSubflow.metadata.name,
        nodeType: 'system:subflow',
        category: 'custom',
        icon: 'boxes',
        settings: { subflowId: createdSubflow.metadata.id },
      },
    };

    // Rewire boundary edges to the new subflow node
    const remainingNodes = state.nodes.filter((n) => !selectedIds.has(n.id));
    const rewiredEdges: Edge[] = [];
    
    for (const e of state.edges) {
      if (internalEdges.includes(e)) continue;
      if (selectedIds.has(e.source) && selectedIds.has(e.target)) continue;
      
      if (selectedIds.has(e.target)) {
        // Inbound edge → connects to the proxy on the port named after the matching
        // subflow-input (falls back to 'in' for single-input compatibility).
        rewiredEdges.push({ ...e, target: subflowNodeId, targetHandle: inboundMapping.get(e.id) || 'in' });
      } else if (selectedIds.has(e.source)) {
        // Outbound edge → leaves the proxy on the port named after the matching
        // subflow-output (falls back to 'out').
        rewiredEdges.push({ ...e, source: subflowNodeId, sourceHandle: outboundMapping.get(e.id) || 'out' });
      } else {
        rewiredEdges.push(e);
      }
    }

    set({
      nodes: [...remainingNodes, subflowNode],
      edges: rewiredEdges,
      selectedNodeId: subflowNodeId,
      isDirty: true,
    });

    // Fetch the new subflow's definition so it can be inlined; the cache bump
    // drives the central schema resync (lib/schema-sync.ts).
    get().refreshSubflowCache();

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

  // === Serialization =========================================================

  saveWorkflow: async (): Promise<boolean> => {
    const state = get();
    trace.action('saveWorkflow', { pipelineId: state.pipelineId, isSubflow: state.isSubflow, project: state.currentProjectId });
    state.setSaving(true);
    try {
      const workflow = state.toWorkflow();
      if (state.pipelineId) {
        await api.updatePipeline(state.pipelineId, workflow);
      } else {
        const created = await api.createPipeline({
          name: state.pipelineName,
          isSubflow: workflow.metadata.isSubflow,
          parameters: workflow.metadata.parameters,
          projectId: state.currentProjectId ?? undefined,
          nodes: workflow.nodes,
          connections: workflow.connections,
        });
        set({ pipelineId: created.metadata.id });
      }
      state.markSaved();
      return true;
    } catch (err) {
      console.error('Failed to save workflow:', err);
      state.addToast('error', `Failed to save: ${err instanceof Error ? err.message : String(err)}`);
      state.setSaving(false);
      return false;
    } finally {
      get().setSaving(false);
    }
  },

  duplicateWorkflow: async (): Promise<string | null> => {
    const state = get();
    state.setSaving(true);
    try {
      const workflow = state.toWorkflow();
      const newName = state.pipelineName.includes('Copy') ? state.pipelineName : `${state.pipelineName} (Copy)`;
      const created = await api.createPipeline({
        name: newName,
        isSubflow: workflow.metadata.isSubflow,
        parameters: workflow.metadata.parameters,
        projectId: state.currentProjectId ?? undefined,
        nodes: workflow.nodes,
        connections: workflow.connections
      });
      // Switch context to the newly created pipeline
      set({ 
        pipelineId: created.metadata.id, 
        pipelineName: newName 
      });
      state.markSaved();
      state.addToast('success', 'Workflow duplicated successfully');
      return created.metadata.id;
    } catch (err) {
      console.error('Failed to duplicate workflow:', err);
      state.addToast('error', `Failed to duplicate: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    } finally {
      get().setSaving(false);
    }
  },

  toWorkflow: (): SerializedWorkflowDTO => {
    const state = get();
    const now = new Date().toISOString();
    // isSubflow is EXPLICIT IDENTITY, decided once at creation and preserved
    // thereafter — NOT derived from the graph and NOT re-read from sticky state
    // elsewhere. `state.isSubflow` is the authoritative in-memory copy of the
    // open workflow's identity: set from metadata in loadWorkflow, set to true
    // only by createSubflowFromSelection (the child), and false by New/clear.
    // This is stable across edits: deleting a boundary node does not reclassify
    // a subflow, and a proxy node never turns a parent into a subflow.
    return {
      schemaVersion: '1.0.0',
      metadata: {
        id: state.pipelineId || `pipeline_${nanoid(8)}`,
        name: state.pipelineName,
        createdAt: now,
        updatedAt: now,
        isSubflow: state.isSubflow,
        parameters: state.pipelineParameters,
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

  loadWorkflow: (workflow, clearStack = true) => {
    trace.action('loadWorkflow', { id: workflow.metadata.id, name: workflow.metadata.name, nodes: workflow.nodes.length });
    const state = get();
    // Determine the active nodes and edges.
    // If navigationStack has items, we're inside a subflow, so don't overwrite
    // the UI with the root workflow, just update the store's "pipelineId".
    // Wait, loadWorkflow is typically called when opening from the Toolbar,
    // which should clear the navigationStack.
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

    set((state) => ({
      pipelineId: workflow.metadata.id,
      pipelineName: workflow.metadata.name,
      isSubflow: workflow.metadata.isSubflow || false,
      pipelineParameters: workflow.metadata.parameters || [],
      nodes,
      edges,
      selectedNodeId: null,
      history: [],
      historyIndex: -1,
      navigationStack: clearStack ? [] : state.navigationStack,
      isDirty: false,
      lastSavedAt: workflow.metadata.updatedAt,
    }));

    // Loading a new graph changes the schema fingerprint → the central subscriber
    // (lib/schema-sync.ts) rebuilds the engine. Then fetch any referenced subflow
    // definitions; the cache bump drives a second resync once they're inlined.
    get().refreshSubflowCache();
  },

  refreshSubflowCache: async (force = false) => {
    const { nodes } = get();
    const subflowNodes = nodes.filter(n => n.data?.nodeType === 'system:subflow');
    trace.action('refreshSubflowCache', { force, subflowNodes: subflowNodes.length });
    if (subflowNodes.length === 0) return;

    // Fetch all needed subflows
    const cache = { ...get().subflowCache };
    let hasNew = false;
    
    for (const node of subflowNodes) {
      const subflowId = node.data?.settings?.subflowId as string;
      if (subflowId && (force || !cache[subflowId])) {
        try {
          const subflow = await api.getPipeline(subflowId);
          if (subflow) {
            cache[subflowId] = subflow;
            hasNew = true;
          }
        } catch (e) {
          console.error(`Failed to fetch subflow ${subflowId}`, e);
        }
      }
    }

    // Bump the cache version whenever definitions changed. The central schema
    // subscriber (lib/schema-sync.ts) sees the version change and re-syncs — we
    // no longer call syncFromWorkflow here. This keeps schema a pure function of
    // {nodes, edges, subflowCache} driven from ONE place.
    if (hasNew) set((s) => ({ subflowCache: cache, subflowCacheVersion: s.subflowCacheVersion + 1 }));
  },

  clearWorkflow: () => {
    set({
      // Reset pipeline identity — a "New Workflow" must not inherit the previous
      // pipeline's id (else the next Save overwrites it), its name, or — critically
      // — its isSubflow flag. Leaving isSubflow=true here caused every subsequent
      // "new" workflow to be persisted as a subflow, which the Workflows list hides.
      pipelineId: null,
      pipelineName: 'Untitled Pipeline',
      isSubflow: false,
      pipelineParameters: [],
      navigationStack: [],
      nodes: [],
      edges: [],
      selectedNodeId: null,
      history: [],
      historyIndex: -1,
      generatedCode: null,
      generatedArtifact: null,
      executionLogs: [],
      executionStatus: 'idle',
      cancelExecution: null,
      isDirty: false,
    });
    // Schema propagation: clear all schema state
    useSchemaStore.getState().clearSchemas();
  },

  setCurrentProject: (id, name) => set({ currentProjectId: id, currentProjectName: name }),

  // === Subflow Navigation ====================================================

  enterSubflow: (subflow) => {
    trace.action('enterSubflow', { id: subflow.metadata.id, name: subflow.metadata.name });
    const state = get();
    // 1. Save current state to navigation stack
    const currentEntry: NavigationStackEntry = {
      pipelineId: state.pipelineId,
      pipelineName: state.pipelineName,
      nodes: state.nodes,
      edges: state.edges,
      history: state.history,
      historyIndex: state.historyIndex,
    };

    set({
      navigationStack: [...state.navigationStack, currentEntry],
    });

    // 2. Load the subflow
    get().loadWorkflow(subflow, false);
  },

  exitSubflow: () => {
    trace.action('exitSubflow', { depth: get().navigationStack.length });
    const state = get();
    if (state.navigationStack.length === 0) return;

    // 1. Pop the last entry
    const stack = [...state.navigationStack];
    const parentEntry = stack.pop()!;

    // 2. Restore state
    set({
      navigationStack: stack,
      pipelineId: parentEntry.pipelineId,
      pipelineName: parentEntry.pipelineName,
      nodes: parentEntry.nodes,
      edges: parentEntry.edges,
      history: parentEntry.history,
      historyIndex: parentEntry.historyIndex,
      selectedNodeId: null,
      isDirty: false, // Could compute this if we wanted to retain parent dirty state
    });

    // Restoring the parent graph changes the fingerprint → central resync.
    // Force-refresh the subflow cache so the parent picks up edits made inside
    // the child; the cache bump drives a second resync.
    get().refreshSubflowCache(true);
  },

  togglePipelineParameter: (targetNodeId, targetSettingKey, settingDef) => {
    const state = get();
    const existing = state.pipelineParameters.findIndex(
      p => p.targetNodeId === targetNodeId && p.targetSettingKey === targetSettingKey
    );

    let newParams;
    if (existing >= 0) {
      newParams = state.pipelineParameters.filter((_, i) => i !== existing);
    } else {
      // Map SettingType to ISubflowParameter type
      let type: 'string' | 'number' | 'boolean' | 'enum' = 'string';
      if (settingDef.type === 'number') type = 'number';
      if (settingDef.type === 'boolean') type = 'boolean';
      if (settingDef.type === 'select' || settingDef.type === 'multi-select') type = 'enum';

      const newParam = {
        id: `param_${nanoid(6)}`,
        name: settingDef.label,
        type,
        targetNodeId,
        targetSettingKey,
      };
      newParams = [...state.pipelineParameters, newParam];
    }
    set({ pipelineParameters: newParams });
  }
}));
