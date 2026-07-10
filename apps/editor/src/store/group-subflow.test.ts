/**
 * createSubflowFromSelection boundary-node behavior.
 *
 * Input/output boundary nodes are created PER boundary edge:
 *  - one system:subflow-input  per inbound edge  (unselected → selected)
 *  - one system:subflow-output per outbound edge (selected → unselected)
 * So they mirror how data actually crossed the selection boundary. This test
 * pins each case (incl. the "[A→B]→C" head-group → 1 output).
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

const DEF = (type: string, category = 'transform'): NodeDef =>
  ({ type, name: type, category, icon: 'x', description: '', ports: [{ id: 'in', name: 'In', direction: 'input' }, { id: 'out', name: 'Out', direction: 'output' }], settings: [] }) as any;

/** Build a node in the RF store shape. `selected` marks it for grouping. */
function node(id: string, selected: boolean) {
  return { id, type: 'transform', position: { x: 0, y: 0 }, selected,
    data: { nodeType: `t:${id}`, label: id, category: 'transform', icon: 'x', settings: {} } } as any;
}
function edge(id: string, source: string, target: string) {
  return { id, source, target, sourceHandle: 'out', targetHandle: 'in' } as any;
}

function countTypes(nodes: any[]) {
  return {
    inputs: nodes.filter((n) => n.type === 'system:subflow-input').length,
    outputs: nodes.filter((n) => n.type === 'system:subflow-output').length,
  };
}

beforeEach(() => {
  created = null;
  useWorkflowStore.getState().clearWorkflow();
  useSchemaStore.getState().clearSchemas();
  useWorkflowStore.getState().setNodeDefinitions([DEF('t:A', 'source'), DEF('t:B'), DEF('t:C', 'output'), DEF('t:D', 'output')]);
});

describe('createSubflowFromSelection — boundary nodes', () => {
  it('[A→B]→C  (head group, B still feeds unselected C) → 0 inputs, 1 output', async () => {
    useWorkflowStore.setState({
      nodes: [node('A', true), node('B', true), node('C', false)],
      edges: [edge('e1', 'A', 'B'), edge('e2', 'B', 'C')],
    });
    await useWorkflowStore.getState().createSubflowFromSelection('Head');
    expect(created).toBeTruthy();
    expect(countTypes(created.nodes)).toEqual({ inputs: 0, outputs: 1 });
  });

  it('A→[B→C]→D  (middle group) → 1 input, 1 output', async () => {
    useWorkflowStore.setState({
      nodes: [node('A', false), node('B', true), node('C', true), node('D', false)],
      edges: [edge('e1', 'A', 'B'), edge('e2', 'B', 'C'), edge('e3', 'C', 'D')],
    });
    await useWorkflowStore.getState().createSubflowFromSelection('Mid');
    expect(countTypes(created.nodes)).toEqual({ inputs: 1, outputs: 1 });
  });

  it('A→[B→C]  (tail group, single terminal) → 1 input, 1 auto-added output', async () => {
    // Previously produced 0 outputs (dead-end subflow). Now auto-adds one output
    // wired to the single terminal C.
    useWorkflowStore.setState({
      nodes: [node('A', false), node('B', true), node('C', true)],
      edges: [edge('e1', 'A', 'B'), edge('e2', 'B', 'C')],
    });
    const res = await useWorkflowStore.getState().createSubflowFromSelection('Tail');
    expect(res.ok).toBe(true);
    expect(countTypes(created.nodes)).toEqual({ inputs: 1, outputs: 1 });
  });

  it('tail group with TWO terminals (B and C, both dead-ends) → ambiguity error, no subflow created', async () => {
    // A→B and A→C, group {B,C}: both are terminals, no outbound edge → ambiguous.
    useWorkflowStore.setState({
      nodes: [node('A', false), node('B', true), node('C', true)],
      edges: [edge('e1', 'A', 'B'), edge('e2', 'A', 'C')],
    });
    created = null;
    const res = await useWorkflowStore.getState().createSubflowFromSelection('Ambiguous');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/clear output|end at one node|connect an output/i);
    expect(created).toBeNull(); // never POSTed
  });
});
