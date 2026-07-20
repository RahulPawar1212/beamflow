/**
 * Auto-derived subflow parameters — store integration.
 *
 * 1. `createSubflowFromSelection` POSTs `parameters` containing an auto param
 *    for every required-but-unfilled setting of the grouped nodes.
 * 2. `toWorkflow` on a subflow doc re-derives on every serialization: filling
 *    the setting drops its auto param, manual params pass through untouched,
 *    and stale auto params loaded from a previous save are stripped.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { NodeDef } from '../api/client';

// Capture what createSubflowFromSelection POSTs as the subflow document.
let created: any = null;
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      getPipeline: vi.fn(async () => { throw new Error('no subflow'); }),
      createPipeline: vi.fn(async (data: any) => {
        created = data;
        return { schemaVersion: '1.0.0', metadata: { id: 'sf_new', name: data.name, isSubflow: true, createdAt: '', updatedAt: '' }, nodes: data.nodes, connections: data.connections };
      }),
    },
  };
});

const { useWorkflowStore } = await import('./workflow-store');
const { useSchemaStore } = await import('../lib/schema-store');

/** A def whose `field` setting is required (like Filter's). */
const DEF = (type: string, category = 'transform'): NodeDef =>
  ({
    type, name: type, category, icon: 'x', description: '',
    ports: [
      { id: 'in', name: 'In', direction: 'input' },
      { id: 'out', name: 'Out', direction: 'output' },
    ],
    settings: [
      { key: 'field', label: 'Field', type: 'text', validation: [{ type: 'required', message: 'Field is required.' }] },
      { key: 'comment', label: 'Comment', type: 'text' },
    ],
  }) as any;

function node(id: string, selected: boolean, settings: Record<string, unknown> = {}) {
  return { id, type: 'transform', position: { x: 0, y: 0 }, selected,
    data: { nodeType: `t:${id}`, label: id, category: 'transform', icon: 'x', settings } } as any;
}
function edge(id: string, source: string, target: string) {
  return { id, source, target, sourceHandle: 'out', targetHandle: 'in' } as any;
}

beforeEach(() => {
  created = null;
  useWorkflowStore.getState().clearWorkflow();
  useSchemaStore.getState().clearSchemas();
  useWorkflowStore.getState().setNodeDefinitions([DEF('t:A', 'source'), DEF('t:B'), DEF('t:C', 'output')]);
});

describe('createSubflowFromSelection — auto parameters', () => {
  it('POSTs an auto param for each required-but-unfilled setting of grouped nodes', async () => {
    useWorkflowStore.setState({
      nodes: [node('A', true, { field: 'filled' }), node('B', true, { field: '' }), node('C', false)],
      edges: [edge('e1', 'A', 'B'), edge('e2', 'B', 'C')],
    });
    const res = await useWorkflowStore.getState().createSubflowFromSelection('Grouped');
    expect(res.ok).toBe(true);
    expect(created.parameters).toEqual([
      expect.objectContaining({
        id: 'auto_B_field',
        name: 'Field',
        type: 'string',
        targetNodeId: 'B',
        targetSettingKey: 'field',
        required: true,
      }),
    ]);
  });

  it('POSTs no params when every required setting is filled', async () => {
    useWorkflowStore.setState({
      nodes: [node('A', true, { field: 'x' }), node('B', true, { field: 'y' })],
      edges: [edge('e1', 'A', 'B')],
    });
    await useWorkflowStore.getState().createSubflowFromSelection('AllFilled');
    expect(created.parameters).toEqual([]);
  });
});

describe('toWorkflow — subflow saves self-heal the parameter list', () => {
  it('derives an auto param for a required-empty setting; drops it once filled', () => {
    useWorkflowStore.setState({
      isSubflow: true,
      pipelineParameters: [],
      nodes: [node('B', false, { field: '' })],
      edges: [],
    });
    let wf = useWorkflowStore.getState().toWorkflow();
    expect(wf.metadata.parameters).toEqual([
      expect.objectContaining({ id: 'auto_B_field', targetNodeId: 'B', targetSettingKey: 'field' }),
    ]);

    // Fill the setting inside the subflow → the auto param disappears.
    useWorkflowStore.setState({
      nodes: [node('B', false, { field: 'age' })],
    });
    wf = useWorkflowStore.getState().toWorkflow();
    expect(wf.metadata.parameters).toEqual([]);
  });

  it('preserves manual params, strips stale loaded auto params, never duplicates', () => {
    const manual = { id: 'param_abc', name: 'Field', type: 'string' as const, targetNodeId: 'B', targetSettingKey: 'field' };
    const staleAuto = { id: 'auto_GONE_field', name: 'Old', type: 'string' as const, targetNodeId: 'GONE', targetSettingKey: 'field', required: true };
    useWorkflowStore.setState({
      isSubflow: true,
      // As loaded from a previously saved doc: one manual + one stale auto.
      pipelineParameters: [manual, staleAuto] as any,
      nodes: [node('B', false, { field: '' })], // B.field required+empty, but manual covers it
      edges: [],
    });
    const wf = useWorkflowStore.getState().toWorkflow();
    // Manual wins over the fresh auto for B.field; the stale auto (node GONE) is stripped.
    expect(wf.metadata.parameters).toEqual([manual]);
  });

  it('does not derive params for a non-subflow workflow', () => {
    useWorkflowStore.setState({
      isSubflow: false,
      pipelineParameters: [],
      nodes: [node('B', false, { field: '' })],
      edges: [],
    });
    const wf = useWorkflowStore.getState().toWorkflow();
    expect(wf.metadata.parameters).toEqual([]);
  });
});
