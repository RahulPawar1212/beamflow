/**
 * Regression tests for the isSubflow flag.
 *
 * The bug: isSubflow was a sticky store flag (`state.isSubflow`) set on
 * load/enter-subflow and never reliably cleared. Saving or duplicating a normal
 * PARENT workflow while that flag was stale persisted it as isSubflow=1, which
 * the Workflows list hides — so the workflow "disappeared".
 *
 * The fix: toWorkflow() DERIVES isSubflow from the graph — true iff the graph
 * contains a boundary node (system:subflow-input/-output). A `system:subflow`
 * proxy node marks a PARENT, not a subflow.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SerializedWorkflowDTO } from '../api/client';

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      getPipeline: vi.fn(async () => { throw new Error('no subflow'); }),
      createPipeline: vi.fn(async (data: any) => ({
        schemaVersion: '1.0.0',
        metadata: { id: 'new_1', name: data.name, isSubflow: data.isSubflow, createdAt: '', updatedAt: '' },
        nodes: data.nodes ?? [],
        connections: data.connections ?? [],
      })),
      updatePipeline: vi.fn(async (_id: string, data: any) => data),
    },
  };
});

const { useWorkflowStore } = await import('../store/workflow-store');
const { useSchemaStore } = await import('../lib/schema-store');
const { api } = await import('../api/client');
const createMock = api.createPipeline as unknown as ReturnType<typeof vi.fn>;
const updateMock = api.updatePipeline as unknown as ReturnType<typeof vi.fn>;

function load(nodes: any[], connections: any[] = [], meta: Partial<SerializedWorkflowDTO['metadata']> = {}) {
  useWorkflowStore.getState().loadWorkflow({
    schemaVersion: '1.0.0',
    metadata: { id: 'p', name: 'wf', createdAt: '', updatedAt: '', ...meta },
    nodes,
    connections,
  } as SerializedWorkflowDTO);
}

beforeEach(() => {
  useWorkflowStore.getState().clearWorkflow();
  useSchemaStore.getState().clearSchemas();
  useWorkflowStore.getState().setNodeDefinitions([
    { type: 'beamflow:csv-source', name: 'CSV', category: 'source', icon: 'file', ports: [], settings: [] } as any,
    { type: 'beamflow:filter', name: 'Filter', category: 'transform', icon: 'filter', ports: [], settings: [] } as any,
    { type: 'system:subflow', name: 'Subflow', category: 'custom', icon: 'boxes', ports: [], settings: [] } as any,
    { type: 'system:subflow-input', name: 'Subflow Input', category: 'source', icon: 'in', ports: [], settings: [] } as any,
    { type: 'system:subflow-output', name: 'Subflow Output', category: 'output', icon: 'out', ports: [], settings: [] } as any,
  ]);
  createMock.mockClear();
  updateMock.mockClear();
});

describe('toWorkflow derives isSubflow from the graph', () => {
  it('parent with a system:subflow proxy is NOT a subflow', () => {
    load([
      { id: 'sf', type: 'system:subflow', settings: { subflowId: 'x' } },
      { id: 'flt', type: 'beamflow:filter', settings: {} },
    ]);
    expect(useWorkflowStore.getState().toWorkflow().metadata.isSubflow).toBe(false);
  });

  it('graph with a subflow-output boundary node IS a subflow', () => {
    load([
      { id: 'csv', type: 'beamflow:csv-source', settings: {} },
      { id: 'out', type: 'system:subflow-output', settings: { outputName: 'Output 1' } },
    ]);
    expect(useWorkflowStore.getState().toWorkflow().metadata.isSubflow).toBe(true);
  });

  it('plain csv->filter is NOT a subflow', () => {
    load([
      { id: 'csv', type: 'beamflow:csv-source', settings: {} },
      { id: 'flt', type: 'beamflow:filter', settings: {} },
    ]);
    expect(useWorkflowStore.getState().toWorkflow().metadata.isSubflow).toBe(false);
  });

  it('stale isSubflow=true metadata on load does NOT stick to a parent graph', () => {
    // Simulate the reported flow: a workflow was previously (wrongly) flagged, then
    // opened. The derived flag must reflect the graph, not the loaded metadata.
    load(
      [
        { id: 'sf', type: 'system:subflow', settings: { subflowId: 'x' } },
        { id: 'flt', type: 'beamflow:filter', settings: {} },
      ],
      [],
      { isSubflow: true },
    );
    expect(useWorkflowStore.getState().toWorkflow().metadata.isSubflow).toBe(false);
  });
});

describe('save & duplicate use the derived flag', () => {
  it('saveWorkflow (new) persists a parent as isSubflow=false', async () => {
    useWorkflowStore.getState().clearWorkflow(); // pipelineId=null → create path
    useWorkflowStore.setState({
      nodes: [
        { id: 'sf', type: 'system:subflow', position: { x: 0, y: 0 }, data: { nodeType: 'system:subflow', label: 'sf', category: 'custom', icon: 'boxes', settings: { subflowId: 'x' } } } as any,
        { id: 'flt', type: 'beamflow:filter', position: { x: 1, y: 0 }, data: { nodeType: 'beamflow:filter', label: 'flt', category: 'transform', icon: 'filter', settings: {} } } as any,
      ],
    });
    await useWorkflowStore.getState().saveWorkflow();
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ isSubflow: false }));
  });

  it('duplicateWorkflow of a parent creates an isSubflow=false copy', async () => {
    load([
      { id: 'sf', type: 'system:subflow', settings: { subflowId: 'x' } },
      { id: 'flt', type: 'beamflow:filter', settings: {} },
    ]);
    await useWorkflowStore.getState().duplicateWorkflow();
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ isSubflow: false }));
  });
});
