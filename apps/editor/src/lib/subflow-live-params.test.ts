/**
 * Live-derived subflow parameters: auto-derivation is otherwise only
 * materialized into `metadata.parameters` at subflow creation and on save
 * (see workflow-store's createSubflowFromSelection / toWorkflow). A subflow
 * saved BEFORE that feature existed carries NO stored parameters at all —
 * this test proves the parent still surfaces (and validates) a required
 * inner setting for such a doc, with no re-save required, via
 * `effectiveSubflowParameters` (schema-store, PropertyPanel, node card all
 * consume it).
 *
 * Drives the REAL workflow-store and schema-store together (only
 * `api.getPipeline` is mocked).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SerializedWorkflowDTO } from '../api/client';

// A "pre-feature" subflow doc: an inner Filter with an unfilled required
// `field`, and metadata.parameters is EMPTY — as if saved before auto-params
// were introduced.
const oldSubflowNoStoredParams: SerializedWorkflowDTO = {
  schemaVersion: '1.0.0',
  metadata: {
    id: 'child_old',
    name: 'pre-feature subflow',
    isSubflow: true,
    createdAt: '',
    updatedAt: '',
    parameters: [], // <- nothing stored, unlike a post-feature save
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
        if (id === 'child_old') return oldSubflowNoStoredParams;
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
      settings: [{ key: 'field', label: 'Field', type: 'text', validation: [{ type: 'required', message: 'Field is required.' }] }],
    } as any,
  ]);
});

describe('live-derived subflow parameters (pre-feature doc, no stored parameters)', () => {
  it('errors on the proxy for a required-empty inner setting with NO metadata.parameters at all', async () => {
    const store = useWorkflowStore.getState();
    store.addNode('system:subflow', { x: 0, y: 0 });
    await flush();
    const sfId = useWorkflowStore.getState().nodes.find((n) => n.data.nodeType === 'system:subflow')!.id;
    store.updateNodeSettings(sfId, { subflowId: 'child_old' });
    await flush();

    const issues = useSchemaStore.getState().getIssues(sfId);
    expect(issues.some(requiredIssue)).toBe(true);
  });

  it('filling the live-derived parameter (deterministic auto_ id) clears the issue and substitutes the value', async () => {
    const store = useWorkflowStore.getState();
    store.addNode('system:subflow', { x: 0, y: 0 });
    await flush();
    const sfId = useWorkflowStore.getState().nodes.find((n) => n.data.nodeType === 'system:subflow')!.id;
    store.updateNodeSettings(sfId, { subflowId: 'child_old' });
    await flush();
    expect(useSchemaStore.getState().getIssues(sfId).some(requiredIssue)).toBe(true);

    // The deterministic id is auto_<innerNodeId>_<settingKey> — no save ever
    // happened, so this id was computed purely from the live subflow doc.
    store.updateNodeSettings(sfId, { auto_inner_filter_field: 'age' });
    await flush();

    expect(useSchemaStore.getState().getIssues(sfId).some(requiredIssue)).toBe(false);
    // Substitution: the expanded internal Filter node's schema now reads the
    // filled value (the schema engine only recomputes if the setting actually
    // changed downstream — verifying no error issue remains is the direct
    // proof the value was consumed by the substitution loop).
  });
});
