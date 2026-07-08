/**
 * @module schema-sync
 *
 * The single, central trigger for design-time schema propagation.
 *
 * Design-time schema (what columns each node outputs → the Property Panel's
 * column dropdowns) is a PURE FUNCTION of the graph: `{nodes, edges,
 * subflowCache}`. Rather than have every store action remember to re-sync (the
 * old model, which repeatedly caused "empty dropdown" bugs when a path forgot),
 * this module subscribes to the workflow store ONCE and re-syncs the schema
 * engine whenever — and only when — a schema-relevant part of the graph changes.
 *
 * Two things make this correct and cheap:
 *  1. A schema fingerprint derived ONLY from schema-affecting data (node
 *     id/type/settings, edge id/endpoints/handles, a subflowCache version).
 *     Position, dimensions, selection and labels are excluded, so dragging or
 *     selecting a node does NOT recompute.
 *  2. A microtask-debounced sync, so a burst of `set` calls collapses into one
 *     rebuild.
 *
 * IMPORTANT: this module imports NO store. The workflow store and the schema
 * sync function are handed in via `installSchemaSync(...)` from a leaf module
 * (App.tsx). This keeps schema-sync outside the workflow-store ↔ schema-store
 * import cycle — importing a store here caused a TDZ crash in the browser
 * ("Cannot access 'useWorkflowStore' before initialization").
 */
import { trace } from './trace';

// Minimal structural shapes — no store type imports (avoids the import cycle).
interface GraphState {
  nodes: Array<{ id: string; data: { nodeType: string; settings?: Record<string, unknown> } }>;
  edges: Array<{ id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }>;
  subflowCacheVersion: number;
}
interface WorkflowStoreLike {
  getState: () => GraphState;
  subscribe: (listener: (state: GraphState) => void) => () => void;
}
type WorkflowNodeLite = { id: string; nodeType: string; settings: Record<string, unknown> };
type WorkflowEdgeLite = { id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null };
type SyncFn = (nodes: WorkflowNodeLite[], edges: WorkflowEdgeLite[]) => void;

let store: WorkflowStoreLike | null = null;
let syncFn: SyncFn | null = null;
let lastFingerprint: string | null = null;
let scheduled = false;
let unsubscribe: (() => void) | null = null;

/** Stable string of everything the schema engine depends on (schema-relevant only). */
function schemaFingerprint(state: GraphState): string {
  const nodes = state.nodes
    .map((n) => `${n.id}|${n.data.nodeType}|${JSON.stringify(n.data.settings ?? {})}`)
    .join(';');
  const edges = state.edges
    .map((e) => `${e.id}|${e.source}|${e.target}|${e.sourceHandle ?? ''}|${e.targetHandle ?? ''}`)
    .join(';');
  return `${nodes}#${edges}#${state.subflowCacheVersion}`;
}

function runSync(): void {
  scheduled = false;
  if (!syncFn || !store) return;
  const state = store.getState();
  trace.group('schemaSync (central)', { nodes: state.nodes.length, edges: state.edges.length });
  syncFn(
    state.nodes.map((n) => ({ id: n.id, nodeType: n.data.nodeType, settings: n.data.settings ?? {} })),
    state.edges.map((e) => ({
      id: e.id, source: e.source, target: e.target,
      sourceHandle: e.sourceHandle, targetHandle: e.targetHandle,
    })),
  );
  trace.groupEnd();
}

function scheduleSync(): void {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(runSync);
}

/**
 * Wire the central subscriber. Idempotent. Call once from a leaf module
 * (App.tsx) with the workflow store and the schema store's full-rebuild fn —
 * NOT from inside the store modules, to stay outside their import cycle.
 */
export function installSchemaSync(workflowStore: WorkflowStoreLike, sync: SyncFn): void {
  syncFn = sync;
  if (unsubscribe) return; // already subscribed
  store = workflowStore;
  lastFingerprint = null; // first change always syncs
  unsubscribe = workflowStore.subscribe((state) => {
    const fp = schemaFingerprint(state);
    if (fp === lastFingerprint) return; // no schema-relevant change (drag/select) → skip
    lastFingerprint = fp;
    scheduleSync();
  });
}

/** Test helper: reset memo + subscription so each test file starts clean. */
export function __resetSchemaSyncForTests(): void {
  if (unsubscribe) unsubscribe();
  unsubscribe = null;
  store = null;
  syncFn = null;
  lastFingerprint = null;
  scheduled = false;
}
