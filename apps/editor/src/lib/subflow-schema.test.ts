/**
 * Integration tests for schema propagation across the subflow boundary.
 *
 * Reproduces the reported bug: a node downstream of a `system:subflow` node
 * (e.g. a Filter) must receive the columns the subflow outputs, so the Property
 * Panel can render a column dropdown. These tests drive the REAL workflow-store
 * and schema-store together (only `api.getPipeline` is mocked) and assert the
 * exact value PropertyPanel reads: `useSchemaStore.schemas.get(subflowNodeId)`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SerializedWorkflowDTO } from '../api/client';

// ─── Mock the API client (only getPipeline matters for subflow expansion) ────
const child: SerializedWorkflowDTO = {
  schemaVersion: '1.0.0',
  metadata: { id: 'child_1', name: 'sub node', isSubflow: true, createdAt: '', updatedAt: '' },
  nodes: [
    {
      id: 'node_csv',
      type: 'beamflow:csv-source',
      settings: {
        schemaColumns: [
          { name: 'TargetGroupId', type: 'double', nullable: true },
          { name: 'GroupId', type: 'double', nullable: true },
          { name: 'VariableId', type: 'boolean', nullable: true },
        ],
      },
    } as any,
    { id: 'node_out', type: 'system:subflow-output', settings: { outputName: 'Output 1' } } as any,
  ],
  connections: [
    { id: 'ce1', sourceNodeId: 'node_csv', sourcePortId: 'out', targetNodeId: 'node_out', targetPortId: 'in' } as any,
  ],
};

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      getPipeline: vi.fn(async (id: string) => {
        if (id === 'child_1') return child;
        throw new Error(`unexpected getPipeline(${id})`);
      }),
    },
  };
});

// Import AFTER the mock is registered.
const { useWorkflowStore } = await import('../store/workflow-store');
const { useSchemaStore } = await import('./schema-store');
const { api } = await import('../api/client');
const getPipelineMock = api.getPipeline as unknown as ReturnType<typeof vi.fn>;

const EXPECTED = ['TargetGroupId', 'GroupId', 'VariableId'];

/** Read the columns exactly as PropertyPanel does for the Filter's dropdown. */
function filterInputColumns(): string[] {
  const { edges } = useWorkflowStore.getState();
  const schemas = useSchemaStore.getState().schemas;
  const incoming = edges.filter((e) => e.target === 'flt');
  return incoming.flatMap((e) => schemas.get(e.source)?.outputSchema.columns.map((c) => c.name) ?? []);
}

/** Let queued microtasks (async refreshSubflowCache → getPipeline → sync) settle. */
async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

const parentWorkflow: SerializedWorkflowDTO = {
  schemaVersion: '1.0.0',
  metadata: { id: 'parent_1', name: 'parent', createdAt: '', updatedAt: '' },
  nodes: [
    { id: 'sf', type: 'system:subflow', settings: { subflowId: 'child_1' } } as any,
    { id: 'flt', type: 'beamflow:filter', settings: {} } as any,
  ],
  connections: [
    { id: 'pe1', sourceNodeId: 'sf', sourcePortId: 'Output 1', targetNodeId: 'flt', targetPortId: 'in' } as any,
  ],
};

beforeEach(() => {
  useWorkflowStore.getState().clearWorkflow();
  useSchemaStore.getState().clearSchemas();
  // Node definitions drive loadWorkflow's category mapping; minimal set is fine.
  useWorkflowStore.getState().setNodeDefinitions([
    { type: 'system:subflow', name: 'Subflow', category: 'custom', icon: 'boxes', ports: [], settings: [] } as any,
    { type: 'beamflow:filter', name: 'Filter', category: 'transform', icon: 'filter', ports: [], settings: [] } as any,
  ]);
});

describe('subflow schema propagation', () => {
  it('loadWorkflow: Filter downstream of subflow receives the subflow output columns', async () => {
    useWorkflowStore.getState().loadWorkflow(parentWorkflow);
    await flush();
    expect(filterInputColumns()).toEqual(EXPECTED);
  });

  it('subflowCache is populated after load', async () => {
    useWorkflowStore.getState().loadWorkflow(parentWorkflow);
    await flush();
    expect(useWorkflowStore.getState().subflowCache['child_1']).toBeTruthy();
  });

  it('the subflow proxy node itself exposes the columns', async () => {
    useWorkflowStore.getState().loadWorkflow(parentWorkflow);
    await flush();
    const sfSchema = useSchemaStore.getState().schemas.get('sf');
    expect(sfSchema?.outputSchema.columns.map((c) => c.name)).toEqual(EXPECTED);
  });
});

/**
 * Interactive path — this mirrors what the user actually does in the UI:
 * add nodes from the palette, set the subflowId, and draw the edge. These use
 * addNode/updateNodeSettings/onConnect (generated ids), not loadWorkflow.
 */
describe('subflow schema propagation — interactive build', () => {
  function idOf(nodeType: string): string {
    return useWorkflowStore.getState().nodes.find((n) => n.data.nodeType === nodeType)!.id;
  }
  function columnsInto(targetId: string): string[] {
    const { edges } = useWorkflowStore.getState();
    const schemas = useSchemaStore.getState().schemas;
    return edges
      .filter((e) => e.target === targetId)
      .flatMap((e) => schemas.get(e.source)?.outputSchema.columns.map((c) => c.name) ?? []);
  }

  it('add subflow node, set subflowId, add filter, connect → filter gets columns', async () => {
    const store = useWorkflowStore.getState();
    // 1. Add a subflow node (palette drop) — starts with no subflowId.
    store.addNode('system:subflow', { x: 0, y: 0 });
    await flush();
    const sfId = idOf('system:subflow');
    // 2. Point it at the child pipeline (as the user picks/creates the subflow).
    store.updateNodeSettings(sfId, { subflowId: 'child_1' });
    await flush();
    // 3. Add the Filter and connect subflow → filter.
    store.addNode('beamflow:filter', { x: 300, y: 0 });
    await flush();
    const fltId = idOf('beamflow:filter');
    store.onConnect({ source: sfId, target: fltId, sourceHandle: 'Output 1', targetHandle: 'in' } as any);
    await flush();

    expect(columnsInto(fltId)).toEqual(EXPECTED);
  });

  it('connect first, then set subflowId → filter still gets columns', async () => {
    const store = useWorkflowStore.getState();
    store.addNode('system:subflow', { x: 0, y: 0 });
    store.addNode('beamflow:filter', { x: 300, y: 0 });
    await flush();
    const sfId = idOf('system:subflow');
    const fltId = idOf('beamflow:filter');
    store.onConnect({ source: sfId, target: fltId, sourceHandle: 'out', targetHandle: 'in' } as any);
    await flush();
    // subflowId set AFTER the edge already exists (order the user might do it in).
    store.updateNodeSettings(sfId, { subflowId: 'child_1' });
    await flush();

    expect(columnsInto(fltId)).toEqual(EXPECTED);
  });
});

/**
 * Regression guards for the specific defects that caused the empty dropdown.
 * Each test targets one root cause so a future refactor can't silently
 * reintroduce it.
 */
describe('subflow schema propagation — regression guards', () => {
  function columnsInto(targetId: string): string[] {
    const { edges } = useWorkflowStore.getState();
    const schemas = useSchemaStore.getState().schemas;
    return edges
      .filter((e) => e.target === targetId)
      .flatMap((e) => schemas.get(e.source)?.outputSchema.columns.map((c) => c.name) ?? []);
  }

  // BUG 1: refreshSubflowCache used to re-sync the schema engine ONLY when it
  // fetched a new subflow (hasNew). On a reload where the cache is already warm,
  // no fetch happens, so the full re-expansion never ran and downstream columns
  // stayed empty. This asserts a warm-cache refresh still propagates.
  it('warm cache (no new fetch) still propagates columns to downstream', async () => {
    // First load warms the cache.
    useWorkflowStore.getState().loadWorkflow(parentWorkflow);
    await flush();
    expect(useWorkflowStore.getState().subflowCache['child_1']).toBeTruthy();

    // Clear only the engine's schema state, keep the warm subflowCache.
    useSchemaStore.getState().clearSchemas();
    getPipelineMock.mockClear();

    // A refresh with the cache already populated must NOT fetch again, but MUST
    // still re-run syncFromWorkflow so columns reappear.
    await useWorkflowStore.getState().refreshSubflowCache();
    await flush();

    expect(getPipelineMock).not.toHaveBeenCalled(); // proves cache was warm
    expect(filterInputColumns()).toEqual(EXPECTED);  // proves it re-synced anyway
  });

  // BUG 2: connecting an edge FROM a subflow node went through the incremental
  // onEdgeAdded path, which does not re-inline the subflow internals, leaving the
  // downstream node with an empty input schema. Connecting must yield columns.
  it('connecting an edge from a subflow node propagates columns (not incremental-only)', async () => {
    const store = useWorkflowStore.getState();
    store.addNode('system:subflow', { x: 0, y: 0 });
    await flush();
    const sfId = useWorkflowStore.getState().nodes.find((n) => n.data.nodeType === 'system:subflow')!.id;
    store.updateNodeSettings(sfId, { subflowId: 'child_1' });
    store.addNode('beamflow:filter', { x: 300, y: 0 });
    await flush();
    const fltId = useWorkflowStore.getState().nodes.find((n) => n.data.nodeType === 'beamflow:filter')!.id;

    store.onConnect({ source: sfId, target: fltId, sourceHandle: 'out', targetHandle: 'in' } as any);
    await flush();

    expect(columnsInto(fltId)).toEqual(EXPECTED);
  });

  // Guard: a plain (non-subflow) source still works via the incremental path —
  // the subflow special-case in onConnect must not break ordinary edges.
  it('non-subflow source (csv-source) still propagates on connect', async () => {
    const store = useWorkflowStore.getState();
    store.setNodeDefinitions([
      ...useWorkflowStore.getState().nodeDefinitions,
      { type: 'beamflow:csv-source', name: 'CSV Source', category: 'source', icon: 'file', ports: [], settings: [] } as any,
    ]);
    store.addNode('beamflow:csv-source', { x: 0, y: 0 });
    await flush();
    const srcId = useWorkflowStore.getState().nodes.find((n) => n.data.nodeType === 'beamflow:csv-source')!.id;
    store.updateNodeSettings(srcId, {
      schemaColumns: [
        { name: 'colA', type: 'string', nullable: true },
        { name: 'colB', type: 'integer', nullable: true },
      ],
    });
    store.addNode('beamflow:filter', { x: 300, y: 0 });
    await flush();
    const fltId = useWorkflowStore.getState().nodes.find((n) => n.data.nodeType === 'beamflow:filter')!.id;

    store.onConnect({ source: srcId, target: fltId, sourceHandle: 'out', targetHandle: 'in' } as any);
    await flush();

    expect(columnsInto(fltId)).toEqual(['colA', 'colB']);
  });

  // Guard: an empty column dropdown is exactly what the user reported. Assert the
  // PropertyPanel gate condition (inputColumns.length > 0) holds for the subflow case.
  it('PropertyPanel dropdown gate: subflow downstream has a non-empty column list', async () => {
    useWorkflowStore.getState().loadWorkflow(parentWorkflow);
    await flush();
    const cols = filterInputColumns();
    expect(cols.length).toBeGreaterThan(0);
  });
});
