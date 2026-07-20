/**
 * Required-subflow-parameter validation: a `system:subflow` proxy whose
 * referenced subflow declares a REQUIRED parameter (auto-derived or manually
 * flagged) must show an ERROR issue on the proxy while the parameter has no
 * value, and the issue must clear once a value is set — the same live
 * badge pipeline the boundary checks use (subflowIssues → NodeIssueBadge).
 *
 * Drives the REAL workflow-store and schema-store together (only
 * `api.getPipeline` is mocked), asserting what the canvas badge reads:
 * `useSchemaStore.getState().getIssues(proxyId)`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SerializedWorkflowDTO } from '../api/client';

// A subflow whose inner Filter has an unfilled required `field`, exposed as an
// auto-derived required parameter.
const childWithRequiredParam: SerializedWorkflowDTO = {
  schemaVersion: '1.0.0',
  metadata: {
    id: 'child_req',
    name: 'needs field',
    isSubflow: true,
    createdAt: '',
    updatedAt: '',
    parameters: [
      {
        id: 'auto_inner_filter_field',
        name: 'Field',
        type: 'string',
        targetNodeId: 'inner_filter',
        targetSettingKey: 'field',
        required: true,
      },
      {
        // Optional param — must never produce an issue.
        id: 'param_opt',
        name: 'Comment',
        type: 'string',
        targetNodeId: 'inner_filter',
        targetSettingKey: 'comment',
      },
    ],
  } as any,
  nodes: [
    { id: 'sub_in', type: 'system:subflow-input', settings: { inputName: 'Input 1' } } as any,
    { id: 'inner_filter', type: 'beamflow:filter', settings: { field: '' } } as any,
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
        if (id === 'child_req') return childWithRequiredParam;
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

const requiredIssue = (i: { severity: string; message: string }) =>
  i.severity === 'error' && /required but has no value/.test(i.message);

beforeEach(() => {
  useWorkflowStore.getState().clearWorkflow();
  useSchemaStore.getState().clearSchemas();
  useWorkflowStore.getState().setNodeDefinitions([
    { type: 'system:subflow', name: 'Subflow', category: 'custom', icon: 'boxes', ports: [], settings: [] } as any,
    {
      type: 'beamflow:filter', name: 'Filter', category: 'transform', icon: 'filter', ports: [],
      // `field` mirrors the real beamflow:filter def (required) — this is what
      // deriveAutoParameters' LIVE re-derivation reads to recompute the stored
      // `auto_inner_filter_field` param each sync (see subflow-params.ts).
      settings: [
        { key: 'field', label: 'Field', type: 'text', validation: [{ type: 'required', message: 'Field is required.' }] },
        { key: 'comment', label: 'Comment', type: 'text' },
      ],
    } as any,
  ]);
});

describe('required subflow parameter validation on the proxy node', () => {
  it('errors on the proxy while the required param has no value, clears once set', async () => {
    const store = useWorkflowStore.getState();
    store.addNode('system:subflow', { x: 0, y: 0 });
    await flush();
    const sfId = useWorkflowStore.getState().nodes.find((n) => n.data.nodeType === 'system:subflow')!.id;
    store.updateNodeSettings(sfId, { subflowId: 'child_req' });
    await flush();

    let issues = useSchemaStore.getState().getIssues(sfId);
    expect(issues.some(requiredIssue)).toBe(true);
    expect(issues.filter(requiredIssue)).toHaveLength(1); // only the required param, not the optional one
    expect(issues.find(requiredIssue)!.message).toContain('"Field"');

    // Fill the parameter on the proxy → the error clears on the next sync.
    store.updateNodeSettings(sfId, { auto_inner_filter_field: 'age' });
    await flush();
    issues = useSchemaStore.getState().getIssues(sfId);
    expect(issues.some(requiredIssue)).toBe(false);
  });

  it('a whitespace-only value still counts as unfilled', async () => {
    const store = useWorkflowStore.getState();
    store.addNode('system:subflow', { x: 0, y: 0 });
    await flush();
    const sfId = useWorkflowStore.getState().nodes.find((n) => n.data.nodeType === 'system:subflow')!.id;
    store.updateNodeSettings(sfId, { subflowId: 'child_req', auto_inner_filter_field: '   ' });
    await flush();

    expect(useSchemaStore.getState().getIssues(sfId).some(requiredIssue)).toBe(true);
  });
});
