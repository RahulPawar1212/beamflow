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
const getMock = api.getPipeline as unknown as ReturnType<typeof vi.fn>;

/** Make GET /pipelines/:id answer with a saved record (the identity authority). */
function serveSavedRecord(record: { id?: string; isSubflow: boolean; nodes?: any[] }) {
  getMock.mockImplementation(async (id: string) => ({
    schemaVersion: '1.0.0',
    metadata: { id: record.id ?? id, name: 'saved', isSubflow: record.isSubflow, createdAt: '', updatedAt: '' },
    nodes: record.nodes ?? [],
    connections: [],
  }));
}

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
  getMock.mockReset();
  getMock.mockImplementation(async () => { throw new Error('no subflow'); });
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
    serveSavedRecord({ isSubflow: true });
    load(
      [{ id: 'out', type: 'system:subflow-output', settings: { outputName: 'Output 1' } }],
      { isSubflow: true },
    );
    await useWorkflowStore.getState().duplicateWorkflow();
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ isSubflow: true }));
  });

  it('duplicating a parent keeps the copy a parent', async () => {
    serveSavedRecord({ isSubflow: false });
    load(
      [{ id: 'sf', type: 'system:subflow', settings: { subflowId: 'x' } }],
      { isSubflow: false },
    );
    await useWorkflowStore.getState().duplicateWorkflow();
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ isSubflow: false }));
  });

  // The field incident: in-memory isSubflow drifted to true (stale bundle /
  // navigation bug) while an ordinary WORKFLOW was open, and Duplicate minted a
  // permanent workflow-shaped "subflow". The copy's identity must come from the
  // SAVED record, not from whatever the session state currently claims.
  it('duplicate takes identity from the saved record, not drifted in-memory state', async () => {
    serveSavedRecord({ isSubflow: false });
    load(
      [{ id: 'flt', type: 'beamflow:filter', settings: {} }],
      { id: 'parent_1', isSubflow: false },
    );
    // Simulate the drift: something wrongly flipped the session flag.
    useWorkflowStore.setState({ isSubflow: true });

    await useWorkflowStore.getState().duplicateWorkflow();

    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ isSubflow: false }));
    // And the drifted session flag is re-aligned with reality afterwards.
    expect(useWorkflowStore.getState().isSubflow).toBe(false);
  });

  it('duplicate aborts (creates nothing) when the saved record cannot be fetched', async () => {
    getMock.mockImplementation(async () => { throw new Error('offline'); });
    load([{ id: 'flt', type: 'beamflow:filter', settings: {} }], { id: 'parent_1', isSubflow: false });

    const result = await useWorkflowStore.getState().duplicateWorkflow();

    expect(result).toBeNull();
    expect(createMock).not.toHaveBeenCalled();
  });
});

describe("entering/exiting a subflow preserves the parent's identity", () => {
  it('double-clicking into a subflow and exiting leaves the parent isSubflow=false', () => {
    load(
      [{ id: 'sf', type: 'system:subflow', settings: { subflowId: 'child_1' } }],
      { id: 'parent_1', isSubflow: false },
    );
    useWorkflowStore.getState().enterSubflow({
      schemaVersion: '1.0.0',
      metadata: { id: 'child_1', name: 'child', isSubflow: true, createdAt: '', updatedAt: '' },
      nodes: [{ id: 'out', type: 'system:subflow-output', settings: { outputName: 'Output 1' }, position: { x: 0, y: 0 } }],
      connections: [],
    } as SerializedWorkflowDTO);
    expect(useWorkflowStore.getState().isSubflow).toBe(true);

    useWorkflowStore.getState().exitSubflow();
    expect(useWorkflowStore.getState().pipelineId).toBe('parent_1');
    expect(useWorkflowStore.getState().isSubflow).toBe(false);
    expect(useWorkflowStore.getState().toWorkflow().metadata.isSubflow).toBe(false);
  });

  it('saving after exiting a subflow persists the parent as isSubflow=false', async () => {
    load(
      [{ id: 'sf', type: 'system:subflow', settings: { subflowId: 'child_1' } }],
      { id: 'parent_1', isSubflow: false },
    );
    useWorkflowStore.getState().enterSubflow({
      schemaVersion: '1.0.0',
      metadata: { id: 'child_1', name: 'child', isSubflow: true, createdAt: '', updatedAt: '' },
      nodes: [{ id: 'out', type: 'system:subflow-output', settings: { outputName: 'Output 1' }, position: { x: 0, y: 0 } }],
      connections: [],
    } as SerializedWorkflowDTO);
    useWorkflowStore.getState().exitSubflow();

    await useWorkflowStore.getState().saveWorkflow();
    expect(api.updatePipeline).toHaveBeenCalledWith(
      'parent_1',
      expect.objectContaining({ metadata: expect.objectContaining({ isSubflow: false }) }),
    );
  });
});
