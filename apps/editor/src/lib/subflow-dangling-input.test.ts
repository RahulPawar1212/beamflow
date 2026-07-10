/**
 * Integration tests for the "dangling external input" warning: a
 * `system:subflow` proxy receives data from an external node, but the
 * referenced subflow has no `system:subflow-input` node to receive it (e.g.
 * it reads its own data internally instead). That data is silently ignored —
 * Beam raises no error for a PTransform that never touches its incoming
 * pcoll — so the editor must surface a live warning on the proxy node
 * instead, appearing and disappearing as the underlying condition changes.
 *
 * Drives the REAL workflow-store and schema-store together (only
 * `api.getPipeline` is mocked), asserting exactly what the canvas badge reads:
 * `useSchemaStore.getState().getIssues(proxyId)`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SerializedWorkflowDTO } from '../api/client';

// A self-contained subflow: has its OWN source inside, no system:subflow-input.
const selfContainedChild: SerializedWorkflowDTO = {
  schemaVersion: '1.0.0',
  metadata: { id: 'child_self', name: 'self-contained sub', isSubflow: true, createdAt: '', updatedAt: '' },
  nodes: [
    { id: 'inner_src', type: 'beamflow:csv-source', settings: {} } as any,
    { id: 'inner_filter', type: 'beamflow:filter', settings: {} } as any,
  ],
  connections: [
    { id: 'ce1', sourceNodeId: 'inner_src', sourcePortId: 'out', targetNodeId: 'inner_filter', targetPortId: 'in' } as any,
  ],
};

// A "properly wired" subflow: HAS a system:subflow-input to receive external data.
const wiredChild: SerializedWorkflowDTO = {
  schemaVersion: '1.0.0',
  metadata: { id: 'child_wired', name: 'wired sub', isSubflow: true, createdAt: '', updatedAt: '' },
  nodes: [
    { id: 'sub_in', type: 'system:subflow-input', settings: { inputName: 'Input 1' } } as any,
    { id: 'inner_filter', type: 'beamflow:filter', settings: {} } as any,
  ],
  connections: [
    { id: 'ce1', sourceNodeId: 'sub_in', sourcePortId: 'out', targetNodeId: 'inner_filter', targetPortId: 'in' } as any,
  ],
};

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      getPipeline: vi.fn(async (id: string) => {
        if (id === 'child_self') return selfContainedChild;
        if (id === 'child_wired') return wiredChild;
        throw new Error(`unexpected getPipeline(${id})`);
      }),
    },
  };
});

const { useWorkflowStore } = await import('../store/workflow-store');
const { useSchemaStore } = await import('./schema-store');

async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

beforeEach(() => {
  useWorkflowStore.getState().clearWorkflow();
  useSchemaStore.getState().clearSchemas();
  useWorkflowStore.getState().setNodeDefinitions([
    { type: 'system:subflow', name: 'Subflow', category: 'custom', icon: 'boxes', ports: [], settings: [] } as any,
    { type: 'beamflow:csv-source', name: 'CSV Source', category: 'source', icon: 'file', ports: [], settings: [] } as any,
    { type: 'beamflow:filter', name: 'Filter', category: 'transform', icon: 'filter', ports: [], settings: [] } as any,
  ]);
});

describe('subflow dangling-external-input warning', () => {
  it('warns on the proxy node when external data feeds a self-contained subflow', async () => {
    const store = useWorkflowStore.getState();
    store.addNode('beamflow:csv-source', { x: 0, y: 0 });
    store.addNode('system:subflow', { x: 200, y: 0 });
    await flush();
    const srcId = useWorkflowStore.getState().nodes.find((n) => n.data.nodeType === 'beamflow:csv-source')!.id;
    const sfId = useWorkflowStore.getState().nodes.find((n) => n.data.nodeType === 'system:subflow')!.id;
    store.updateNodeSettings(sfId, { subflowId: 'child_self' });
    await flush();
    store.onConnect({ source: srcId, target: sfId, sourceHandle: 'out', targetHandle: 'in' } as any);
    await flush();

    const issues = useSchemaStore.getState().getIssues(sfId);
    expect(issues.some((i) => i.severity === 'warning' && /Subflow Input/.test(i.message))).toBe(true);
  });

  it('does NOT warn when the subflow has a system:subflow-input to receive the external data', async () => {
    const store = useWorkflowStore.getState();
    store.addNode('beamflow:csv-source', { x: 0, y: 0 });
    store.addNode('system:subflow', { x: 200, y: 0 });
    await flush();
    const srcId = useWorkflowStore.getState().nodes.find((n) => n.data.nodeType === 'beamflow:csv-source')!.id;
    const sfId = useWorkflowStore.getState().nodes.find((n) => n.data.nodeType === 'system:subflow')!.id;
    store.updateNodeSettings(sfId, { subflowId: 'child_wired' });
    await flush();
    store.onConnect({ source: srcId, target: sfId, sourceHandle: 'out', targetHandle: 'in' } as any);
    await flush();

    const issues = useSchemaStore.getState().getIssues(sfId);
    expect(issues.some((i) => /Subflow Input/.test(i.message))).toBe(false);
  });

  it('does NOT warn when a self-contained subflow has no incoming edge at all', async () => {
    const store = useWorkflowStore.getState();
    store.addNode('system:subflow', { x: 0, y: 0 });
    await flush();
    const sfId = useWorkflowStore.getState().nodes.find((n) => n.data.nodeType === 'system:subflow')!.id;
    store.updateNodeSettings(sfId, { subflowId: 'child_self' });
    await flush();

    const issues = useSchemaStore.getState().getIssues(sfId);
    expect(issues.some((i) => /Subflow Input/.test(i.message))).toBe(false);
  });

  it('warning disappears once the dangling edge is removed', async () => {
    const store = useWorkflowStore.getState();
    store.addNode('beamflow:csv-source', { x: 0, y: 0 });
    store.addNode('system:subflow', { x: 200, y: 0 });
    await flush();
    const srcId = useWorkflowStore.getState().nodes.find((n) => n.data.nodeType === 'beamflow:csv-source')!.id;
    const sfId = useWorkflowStore.getState().nodes.find((n) => n.data.nodeType === 'system:subflow')!.id;
    store.updateNodeSettings(sfId, { subflowId: 'child_self' });
    await flush();
    store.onConnect({ source: srcId, target: sfId, sourceHandle: 'out', targetHandle: 'in' } as any);
    await flush();
    expect(useSchemaStore.getState().getIssues(sfId).some((i) => /Subflow Input/.test(i.message))).toBe(true);

    // Remove the dangling edge — the warning must clear on the next sync.
    const edgeId = useWorkflowStore.getState().edges.find((e) => e.source === srcId && e.target === sfId)!.id;
    store.onEdgesChange([{ id: edgeId, type: 'remove' } as any]);
    await flush();

    expect(useSchemaStore.getState().getIssues(sfId).some((i) => /Subflow Input/.test(i.message))).toBe(false);
  });
});
