/**
 * Tests for the CENTRALIZED schema-sync contract (lib/schema-sync.ts).
 *
 * The refactor's whole point: schema is a pure function of the graph, resynced
 * from ONE subscriber — so every graph mutation updates downstream schema, and
 * cosmetic churn (drag/selection) does NOT recompute. These tests pin both, and
 * cover the previously-LATENT bugs (delete via change handlers, undo/redo,
 * removeSelectedNodes) that no action synced before centralization.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SerializedWorkflowDTO, NodeDef } from '../api/client';

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>();
  return { ...actual, api: { ...actual.api, getPipeline: vi.fn(async () => { throw new Error('no subflow'); }) } };
});

const { useWorkflowStore } = await import('../store/workflow-store');
const { useSchemaStore } = await import('./schema-store');

const COLS = [
  { name: 'colA', type: 'string', nullable: true },
  { name: 'colB', type: 'integer', nullable: true },
];

const CSV_DEF: NodeDef = { type: 'beamflow:csv-source', name: 'CSV', category: 'source', icon: 'file', ports: [], settings: [] } as any;
const FILTER_DEF: NodeDef = { type: 'beamflow:filter', name: 'Filter', category: 'transform', icon: 'filter', ports: [], settings: [] } as any;

async function flush() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  for (let i = 0; i < 12; i++) await Promise.resolve();
}
function columnsInto(target: string): string[] {
  const { edges } = useWorkflowStore.getState();
  const schemas = useSchemaStore.getState().schemas;
  return edges.filter((e) => e.target === target)
    .flatMap((e) => schemas.get(e.source)?.outputSchema.columns.map((c) => c.name) ?? []);
}
/** Load a csv→filter graph with columns on the source. */
function loadCsvFilter() {
  useWorkflowStore.getState().loadWorkflow({
    schemaVersion: '1.0.0',
    metadata: { id: 'p', name: 'p', createdAt: '', updatedAt: '' },
    nodes: [
      { id: 'csv', type: 'beamflow:csv-source', settings: { schemaColumns: COLS } } as any,
      { id: 'flt', type: 'beamflow:filter', settings: {} } as any,
    ],
    connections: [{ id: 'e', sourceNodeId: 'csv', sourcePortId: 'out', targetNodeId: 'flt', targetPortId: 'in' } as any],
  } as SerializedWorkflowDTO);
}

beforeEach(() => {
  useWorkflowStore.getState().clearWorkflow();
  useSchemaStore.getState().clearSchemas();
  useWorkflowStore.getState().setNodeDefinitions([CSV_DEF, FILTER_DEF]);
});

describe('central schema-sync — mutations always resync', () => {
  it('deleting the source edge (onEdgesChange) clears the Filter columns', async () => {
    loadCsvFilter();
    await flush();
    expect(columnsInto('flt')).toEqual(['colA', 'colB']);

    const edgeId = useWorkflowStore.getState().edges[0].id;
    useWorkflowStore.getState().onEdgesChange([{ type: 'remove', id: edgeId } as any]);
    await flush();
    // Latent bug before centralization: onEdgesChange never resynced.
    expect(columnsInto('flt')).toEqual([]);
  });

  it('deleting the source node (onNodesChange remove) clears the Filter columns', async () => {
    loadCsvFilter();
    await flush();
    expect(columnsInto('flt')).toEqual(['colA', 'colB']);

    useWorkflowStore.getState().onNodesChange([{ type: 'remove', id: 'csv' } as any]);
    await flush();
    expect(columnsInto('flt')).toEqual([]);
  });

  it('undo restores the schema to the pre-change graph', async () => {
    loadCsvFilter();
    await flush();
    // Change the source columns, then undo.
    useWorkflowStore.getState().updateNodeSettings('csv', { schemaColumns: [{ name: 'X', type: 'string', nullable: true }] });
    await flush();
    expect(columnsInto('flt')).toEqual(['X']);

    useWorkflowStore.getState().undo();
    await flush();
    // Latent bug before centralization: undo left schema at the post-change state.
    expect(columnsInto('flt')).toEqual(['colA', 'colB']);
  });

  it('removeSelectedNodes resyncs schema', async () => {
    loadCsvFilter();
    await flush();
    // Select the source and delete via the canvas multi-delete action.
    useWorkflowStore.setState({
      nodes: useWorkflowStore.getState().nodes.map((n) => (n.id === 'csv' ? { ...n, selected: true } : n)),
    });
    useWorkflowStore.getState().removeSelectedNodes();
    await flush();
    expect(columnsInto('flt')).toEqual([]);
  });
});

describe('central schema-sync — cosmetic churn does NOT recompute', () => {
  it('dragging a node (position change) does not trigger a schema rebuild', async () => {
    loadCsvFilter();
    await flush();
    // Spy on the engine rebuild to count recomputes.
    const spy = vi.spyOn(useSchemaStore.getState(), 'syncFromWorkflow');

    // Simulate a drag: a stream of position-only changes.
    for (let i = 0; i < 5; i++) {
      useWorkflowStore.getState().onNodesChange([
        { type: 'position', id: 'csv', position: { x: i * 10, y: 0 } } as any,
      ]);
    }
    // Also a pure selection change.
    useWorkflowStore.getState().onNodesChange([{ type: 'select', id: 'flt', selected: true } as any]);
    await flush();

    expect(spy).not.toHaveBeenCalled(); // fingerprint unchanged → no rebuild
    spy.mockRestore();
  });
});
