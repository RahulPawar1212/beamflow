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
