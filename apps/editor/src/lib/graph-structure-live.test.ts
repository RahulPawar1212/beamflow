/**
 * Integration tests for LIVE structural graph validation on the canvas —
 * orphan nodes and unconnected required input ports. This is the same check
 * the server enforces at Generate/Execute (`DAG.validate()`,
 * `packages/graph/src/dag.ts`, via the shared `validateGraphStructure`
 * classifier), now also surfaced live via the generic node-issue-badge
 * mechanism, so a disconnected node is visible the moment it happens.
 *
 * Reproduces the reported scenario: a "subnode" custom node sitting on the
 * canvas with NO edges at all (neither in nor out), next to an otherwise
 * fully-wired Filter -> CSV Output chain.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useWorkflowStore } from '../store/workflow-store';
import { useSchemaStore } from './schema-store';

async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

beforeEach(() => {
  useWorkflowStore.getState().clearWorkflow();
  useSchemaStore.getState().clearSchemas();
  useWorkflowStore.getState().setNodeDefinitions([
    {
      type: 'beamflow:csv-source', name: 'CSV Source', category: 'source', icon: 'file', settings: [],
      ports: [{ id: 'out', name: 'Records', direction: 'output', dataType: 'record', required: false }],
    } as any,
    {
      type: 'beamflow:filter', name: 'Filter', category: 'transform', icon: 'filter', settings: [],
      ports: [
        { id: 'in', name: 'Input', direction: 'input', dataType: 'record', required: true },
        { id: 'out', name: 'Records', direction: 'output', dataType: 'record', required: false },
      ],
    } as any,
    {
      type: 'beamflow:csv-output', name: 'CSV Output', category: 'output', icon: 'file-output', settings: [],
      ports: [{ id: 'in', name: 'Input', direction: 'input', dataType: 'record', required: true }],
    } as any,
    // Mirrors a user-authored composite/expression custom node (e.g. "subnode"
    // from the reported scenario) — generic non-required in/out ports.
    {
      type: 'custom:subnode-type', name: 'subnode', category: 'custom', icon: 'box', settings: [],
      ports: [
        { id: 'in', name: 'Input', direction: 'input', dataType: 'record', required: false },
        { id: 'out', name: 'Output', direction: 'output', dataType: 'record', required: false },
      ],
    } as any,
  ]);
});

describe('live structural graph validation', () => {
  it('flags a node with no connections at all as an orphan (the reported "subnode" scenario)', async () => {
    const store = useWorkflowStore.getState();
    // subnode: an isolated custom node, no edges either direction.
    store.addNode('custom:subnode-type', { x: 0, y: 0 });
    // Filter -> CSV Output: a genuinely connected, complete chain.
    store.addNode('beamflow:filter', { x: 200, y: 0 });
    store.addNode('beamflow:csv-output', { x: 400, y: 0 });
    await flush();

    const nodes = useWorkflowStore.getState().nodes;
    const subId = nodes.find((n) => n.data.nodeType === 'custom:subnode-type')!.id;
    const fltId = nodes.find((n) => n.data.nodeType === 'beamflow:filter')!.id;
    const outId = nodes.find((n) => n.data.nodeType === 'beamflow:csv-output')!.id;

    store.onConnect({ source: fltId, target: outId, sourceHandle: 'out', targetHandle: 'in' } as any);
    await flush();

    const subIssues = useSchemaStore.getState().getIssues(subId);
    expect(subIssues.some((i) => i.severity === 'warning' && /not connected to any other node/.test(i.message))).toBe(true);

    // The connected Filter/CSV Output must NOT be flagged as orphans.
    expect(useSchemaStore.getState().getIssues(fltId).some((i) => /not connected to any other node/.test(i.message))).toBe(false);
    expect(useSchemaStore.getState().getIssues(outId).some((i) => /not connected to any other node/.test(i.message))).toBe(false);
  });

  it('orphan warning disappears once the node is connected', async () => {
    const store = useWorkflowStore.getState();
    store.addNode('beamflow:csv-source', { x: 0, y: 0 });
    store.addNode('beamflow:filter', { x: 200, y: 0 });
    await flush();
    const srcId = useWorkflowStore.getState().nodes.find((n) => n.data.nodeType === 'beamflow:csv-source')!.id;
    const fltId = useWorkflowStore.getState().nodes.find((n) => n.data.nodeType === 'beamflow:filter')!.id;

    expect(useSchemaStore.getState().getIssues(fltId).some((i) => /not connected to any other node/.test(i.message))).toBe(true);

    store.onConnect({ source: srcId, target: fltId, sourceHandle: 'out', targetHandle: 'in' } as any);
    await flush();

    expect(useSchemaStore.getState().getIssues(fltId).some((i) => /not connected to any other node/.test(i.message))).toBe(false);
  });

  it('flags a required input port that has an unrelated edge into the node but not that port', async () => {
    // Filter has an outgoing edge (not an orphan) but nothing feeds its
    // required "in" port — must be flagged as an error, not a warning.
    const store = useWorkflowStore.getState();
    store.addNode('beamflow:filter', { x: 0, y: 0 });
    store.addNode('beamflow:csv-output', { x: 200, y: 0 });
    await flush();
    const fltId = useWorkflowStore.getState().nodes.find((n) => n.data.nodeType === 'beamflow:filter')!.id;
    const outId = useWorkflowStore.getState().nodes.find((n) => n.data.nodeType === 'beamflow:csv-output')!.id;

    store.onConnect({ source: fltId, target: outId, sourceHandle: 'out', targetHandle: 'in' } as any);
    await flush();

    const issues = useSchemaStore.getState().getIssues(fltId);
    expect(issues.some((i) => i.severity === 'error' && /Required input port "Input" is not connected/.test(i.message))).toBe(true);
  });
});
