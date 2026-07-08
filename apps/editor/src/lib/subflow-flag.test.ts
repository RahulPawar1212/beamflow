/**
 * Tests for subflow IDENTITY (isSubflow).
 *
 * Model: isSubflow is EXPLICIT identity — decided once at creation and then
 * preserved. It is NOT derived from the graph (so deleting a boundary node does
 * not reclassify a subflow) and NOT re-read from sticky state on every path (so
 * it can't drift onto parents/duplicates). `state.isSubflow` is the authoritative
 * in-memory copy, set from metadata on load.
 *
 * History: an earlier attempt derived it from the graph, which flipped a subflow
 * to a parent when its boundary node was deleted — these tests guard against
 * reintroducing either failure mode.
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

function load(nodes: any[], meta: Partial<SerializedWorkflowDTO['metadata']> = {}) {
  useWorkflowStore.getState().loadWorkflow({
    schemaVersion: '1.0.0',
    metadata: { id: 'p', name: 'wf', createdAt: '', updatedAt: '', ...meta },
    nodes,
    connections: [],
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
});

describe('isSubflow is explicit identity, preserved from metadata', () => {
  it('a workflow loaded as isSubflow=false stays false when serialized', () => {
    load([{ id: 'flt', type: 'beamflow:filter', settings: {} }], { isSubflow: false });
    expect(useWorkflowStore.getState().toWorkflow().metadata.isSubflow).toBe(false);
  });

  it('a workflow loaded as isSubflow=true stays true when serialized', () => {
    load(
      [
        { id: 'in', type: 'system:subflow-input', settings: { inputName: 'Input 1' } },
        { id: 'out', type: 'system:subflow-output', settings: { outputName: 'Output 1' } },
      ],
      { isSubflow: true },
    );
    expect(useWorkflowStore.getState().toWorkflow().metadata.isSubflow).toBe(true);
  });

  it('a PARENT (has a system:subflow proxy) loaded as false stays false', () => {
    load(
      [
        { id: 'sf', type: 'system:subflow', settings: { subflowId: 'x' } },
        { id: 'flt', type: 'beamflow:filter', settings: {} },
      ],
      { isSubflow: false },
    );
    expect(useWorkflowStore.getState().toWorkflow().metadata.isSubflow).toBe(false);
  });

  // The exact flaw the graph-derivation had: a subflow whose boundary node is
  // deleted must REMAIN a subflow (identity is not structural).
  it('deleting the only boundary node does NOT reclassify a subflow to a parent', () => {
    load(
      [
        { id: 'flt', type: 'beamflow:filter', settings: {} },
        { id: 'out', type: 'system:subflow-output', settings: { outputName: 'Output 1' } },
      ],
      { isSubflow: true },
    );
    // User deletes the subflow-output node while editing.
    useWorkflowStore.getState().removeNode('out');
    expect(useWorkflowStore.getState().nodes.some((n) => n.data.nodeType === 'system:subflow-output')).toBe(false);
    // Identity is preserved — still a subflow.
    expect(useWorkflowStore.getState().toWorkflow().metadata.isSubflow).toBe(true);
  });

  it('New Workflow (clearWorkflow) resets identity to false', () => {
    load([{ id: 'out', type: 'system:subflow-output', settings: {} }], { isSubflow: true });
    useWorkflowStore.getState().clearWorkflow();
    expect(useWorkflowStore.getState().toWorkflow().metadata.isSubflow).toBe(false);
  });
});

describe('save & duplicate preserve identity', () => {
  it('saving a parent (new) persists isSubflow=false', async () => {
    useWorkflowStore.getState().clearWorkflow();
    useWorkflowStore.setState({
      nodes: [
        { id: 'sf', type: 'system:subflow', position: { x: 0, y: 0 }, data: { nodeType: 'system:subflow', label: 'sf', category: 'custom', icon: 'boxes', settings: { subflowId: 'x' } } } as any,
      ],
    });
    await useWorkflowStore.getState().saveWorkflow();
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ isSubflow: false }));
  });

  it('duplicating a subflow keeps the copy a subflow', async () => {
    load(
      [{ id: 'out', type: 'system:subflow-output', settings: { outputName: 'Output 1' } }],
      { isSubflow: true },
    );
    await useWorkflowStore.getState().duplicateWorkflow();
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ isSubflow: true }));
  });

  it('duplicating a parent keeps the copy a parent', async () => {
    load(
      [{ id: 'sf', type: 'system:subflow', settings: { subflowId: 'x' } }],
      { isSubflow: false },
    );
    await useWorkflowStore.getState().duplicateWorkflow();
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ isSubflow: false }));
  });
});
