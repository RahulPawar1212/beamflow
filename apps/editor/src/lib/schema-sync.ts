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
 * To avoid a circular import (schema-store imports workflow-store), this module
 * imports NEITHER store type directly for the sync call — schema-store registers
 * its `syncFromWorkflow` via `registerSchemaSync`, and we read the workflow store
 * lazily. schema-store calls `installSchemaSync()` at load, so importing the
 * schema store activates the subscriber (prod and tests alike).
 */
import { useWorkflowStore } from '../store/workflow-store';
import { trace } from './trace';

type WorkflowNodeLite = { id: string; nodeType: string; settings: Record<string, unknown> };
type WorkflowEdgeLite = { id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null };
type SyncFn = (nodes: WorkflowNodeLite[], edges: WorkflowEdgeLite[]) => void;

let syncFn: SyncFn | null = null;
let lastFingerprint: string | null = null;
let scheduled = false;
let installed = false;
let unsubscribe: (() => void) | null = null;

/** schema-store registers its full-rebuild function here (breaks the import cycle). */
export function registerSchemaSync(fn: SyncFn): void {
  syncFn = fn;
}

/** Stable string of everything the schema engine depends on (schema-relevant only). */
function schemaFingerprint(state: ReturnType<typeof useWorkflowStore.getState>): string {
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
  if (!syncFn) return;
  const state = useWorkflowStore.getState();
  trace.group('schemaSync (central)', { nodes: state.nodes.length, edges: state.edges.length });
  syncFn(
    state.nodes.map((n) => ({ id: n.id, nodeType: n.data.nodeType, settings: n.data.settings })),
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
 * Wire the central subscriber. Idempotent. Called by schema-store at load.
 *
 * Note: schema-store calls this during module evaluation while it sits in an
 * import cycle with workflow-store. `useWorkflowStore` may not be defined yet at
 * that instant, so we only *subscribe* once the store exists, retrying on a
 * microtask if needed. We seed `lastFingerprint = null` so the first real
 * change always syncs.
 */
export function installSchemaSync(): void {
  if (installed) return;
  const store = useWorkflowStore as unknown as { subscribe?: (fn: (s: any) => void) => () => void } | undefined;
  if (!store || typeof store.subscribe !== 'function') {
    // Store not initialized yet (import cycle) — retry after modules settle.
    queueMicrotask(installSchemaSync);
    return;
  }
  installed = true;
  lastFingerprint = null; // first change always syncs
  unsubscribe = useWorkflowStore.subscribe((state) => {
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
  lastFingerprint = null;
  scheduled = false;
  installed = false;
}
