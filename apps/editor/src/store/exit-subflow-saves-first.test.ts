/**
 * Regression: exitSubflow() must persist the subflow's pending edits BEFORE
 * restoring the parent and refreshing its subflow cache.
 *
 * Bug this guards against: a user fills a required inner setting (satisfying
 * an auto-derived subflow parameter), then immediately navigates back to the
 * parent. Auto-save is debounced (2s) and fire-and-forget — if exitSubflow
 * only fired a fire-and-forget refreshSubflowCache(true) without first
 * awaiting a save, the parent's re-fetch could race the save and see the
 * OLD (still-empty) server copy, leaving the now-satisfied parameter stuck
 * showing on the subflow node forever (until some unrelated future refresh).
 *
 * exitSubflow is now async and, when the subflow being left isDirty, awaits
 * saveWorkflow() before popping the navigation stack and force-refreshing the
 * cache — so by the time exitSubflow's promise resolves, the parent's cache
 * is guaranteed to reflect the just-filled value.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SerializedWorkflowDTO } from '../api/client';

// The "server" for subflow child_1 — starts with an empty required setting;
// updatePipeline mutates it in place so a subsequent getPipeline reflects the
// save, mirroring the real API's persist-then-refetch semantics.
let serverChild: SerializedWorkflowDTO = {
  schemaVersion: '1.0.0',
  metadata: { id: 'child_1', name: 'child', isSubflow: true, createdAt: '', updatedAt: '' },
  nodes: [{ id: 'inner_filter', type: 'beamflow:filter', settings: { field: '' } } as any],
  connections: [],
};

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      getPipeline: vi.fn(async (id: string) => {
        if (id === 'child_1') return serverChild;
        throw new Error(`unexpected getPipeline(${id})`);
      }),
      updatePipeline: vi.fn(async (id: string, data: SerializedWorkflowDTO) => {
        if (id === 'child_1') serverChild = data;
        return data;
      }),
    },
  };
});

const { useWorkflowStore } = await import('./workflow-store');
const { useSchemaStore } = await import('../lib/schema-store');
const { api } = await import('../api/client');

beforeEach(() => {
  serverChild = {
    schemaVersion: '1.0.0',
    metadata: { id: 'child_1', name: 'child', isSubflow: true, createdAt: '', updatedAt: '' },
    nodes: [{ id: 'inner_filter', type: 'beamflow:filter', settings: { field: '' } } as any],
    connections: [],
  };
  useWorkflowStore.getState().clearWorkflow();
  useSchemaStore.getState().clearSchemas();
  useWorkflowStore.getState().setNodeDefinitions([
    { type: 'system:subflow', name: 'Subflow', category: 'custom', icon: 'boxes', ports: [], settings: [] } as any,
    {
      type: 'beamflow:filter', name: 'Filter', category: 'transform', icon: 'filter', ports: [],
      settings: [{ key: 'field', label: 'Field', type: 'text', validation: [{ type: 'required', message: 'Field is required.' }] }],
    } as any,
  ]);
  (api.updatePipeline as any).mockClear();
});

async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe('exitSubflow persists pending inner edits before the parent re-reads the cache', () => {
  it('a value filled inside the subflow is saved and reflected on the parent immediately after exitSubflow resolves', async () => {
    const store = useWorkflowStore.getState();
    store.addNode('system:subflow', { x: 0, y: 0 });
    await flush();
    const sfId = useWorkflowStore.getState().nodes.find((n) => n.data.nodeType === 'system:subflow')!.id;
    store.updateNodeSettings(sfId, { subflowId: 'child_1' });
    await flush();

    // Confirm the required-param error shows before we fill it.
    const requiredIssue = (i: { severity: string; message: string }) =>
      i.severity === 'error' && /required but has no value/.test(i.message);
    expect(useSchemaStore.getState().getIssues(sfId).some(requiredIssue)).toBe(true);

    // Enter the subflow, fill the previously-empty required setting.
    useWorkflowStore.getState().enterSubflow(serverChild);
    useWorkflowStore.getState().updateNodeSettings('inner_filter', { field: 'age' });
    expect(useWorkflowStore.getState().isDirty).toBe(true);

    // Exit IMMEDIATELY — this is the race: auto-save's 2s debounce has not
    // fired. exitSubflow itself must save before restoring the parent.
    await useWorkflowStore.getState().exitSubflow();

    // The save must have actually happened (not deferred to auto-save).
    expect(api.updatePipeline).toHaveBeenCalled();
    expect(serverChild.nodes[0].settings.field).toBe('age');

    // Back on the parent: the cache must already reflect the filled value —
    // no more required-param error, without waiting for any further tick.
    expect(useSchemaStore.getState().getIssues(sfId).some(requiredIssue)).toBe(false);
  });

  it('does not call save when the subflow was left with no unsaved edits', async () => {
    const store = useWorkflowStore.getState();
    store.addNode('system:subflow', { x: 0, y: 0 });
    await flush();
    const sfId = useWorkflowStore.getState().nodes.find((n) => n.data.nodeType === 'system:subflow')!.id;
    store.updateNodeSettings(sfId, { subflowId: 'child_1' });
    await flush();

    useWorkflowStore.getState().enterSubflow(serverChild);
    expect(useWorkflowStore.getState().isDirty).toBe(false);

    await useWorkflowStore.getState().exitSubflow();
    expect(api.updatePipeline).not.toHaveBeenCalled();
  });
});
