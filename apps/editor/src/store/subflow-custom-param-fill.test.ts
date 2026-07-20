/**
 * Reproduction of the reported bug: a subflow whose INNER node is a CUSTOM
 * calculation node ("csi") with a required "Param 1" (key `param1`). The user
 * fills Param 1 = "sss" inside the subflow; on the parent the "csi subflow"
 * node must then show NO required parameter (satisfied inside) — but it was
 * reported as still showing "Missing" even after exiting.
 *
 * Unlike exit-subflow-saves-first.test.ts (built-in inner node), this exercises
 * the CUSTOM-node path: the inner node's settings serialize alongside inlineIR,
 * and the parent's live derivation must read the custom def's `param1` key.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SerializedWorkflowDTO } from '../api/client';
import type { CustomNodeDef } from '../customNodes';

// Mutable "server" copy of the subflow — updatePipeline persists, getPipeline reads it back.
let serverChild: SerializedWorkflowDTO;

function freshChild(fieldValue: string): SerializedWorkflowDTO {
  return {
    schemaVersion: '1.0.0',
    metadata: { id: 'csi_sub', name: 'csi subflow', isSubflow: true, createdAt: '', updatedAt: '' },
    nodes: [
      { id: 'csi_node', type: 'custom:csi123', settings: { param1: fieldValue } } as any,
      { id: 'sub_out', type: 'system:subflow-output', settings: { outputName: 'Output 1' } } as any,
    ],
    connections: [
      { id: 'ce', sourceNodeId: 'csi_node', sourcePortId: 'out', targetNodeId: 'sub_out', targetPortId: 'in' } as any,
    ],
  };
}

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      getPipeline: vi.fn(async (id: string) => {
        if (id === 'csi_sub') return serverChild;
        throw new Error(`unexpected getPipeline(${id})`);
      }),
      updatePipeline: vi.fn(async (id: string, data: SerializedWorkflowDTO) => {
        if (id === 'csi_sub') serverChild = data;
        return data;
      }),
    },
  };
});

const { useWorkflowStore } = await import('./workflow-store');
const { useSchemaStore } = await import('../lib/schema-store');
const { api } = await import('../api/client');

// The custom calculation node "csi" with a required, unrenamed "Param 1".
const CSI_CUSTOM: CustomNodeDef = {
  id: 'custom:csi123',
  name: 'csi',
  description: 'CSI calc',
  icon: 'sparkles',
  kind: 'calculation',
  params: [
    { key: 'param1', label: 'Param 1', type: 'text' as any, defaultValue: '', validation: [{ type: 'required', message: 'Param 1 is required.' }] } as any,
  ],
  transform: { processBody: 'yield element' },
  outputColumns: [{ mode: 'passthrough-all' }],
  createdAt: '',
};

async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

const requiredIssue = (i: { severity: string; message: string }) =>
  i.severity === 'error' && /required but has no value/.test(i.message);

beforeEach(() => {
  serverChild = freshChild(''); // starts EMPTY
  useWorkflowStore.getState().clearWorkflow();
  useSchemaStore.getState().clearSchemas();
  // Register the custom def so the parent's resolveSettings can find its settings.
  (useWorkflowStore as any).setState({ customNodeDefs: [CSI_CUSTOM] });
  useWorkflowStore.getState().setNodeDefinitions([
    { type: 'system:subflow', name: 'Subflow', category: 'custom', icon: 'boxes', ports: [], settings: [] } as any,
    // Mirror toNodeDef(CSI_CUSTOM): the custom node's def IS in nodeDefinitions in the editor.
    { type: 'custom:csi123', name: 'csi', category: 'custom', icon: 'sparkles', ports: [], settings: CSI_CUSTOM.params } as any,
  ]);
  (api.updatePipeline as any).mockClear();
});

describe('custom-node subflow parameter: filled inside must clear on the parent', () => {
  it('a FILLED inner value with the custom def MISSING and a stale stored auto_ param shows no error', async () => {
    // Guards the interaction: custom node defs live in localStorage, so a
    // parent/session may lack the def. Even if the subflow doc still carries a
    // stale stored auto_ param from when it was empty, mergeSubflowParameters
    // strips ALL auto_ ids from the stored list before re-deriving — so a
    // missing def (no re-derivation) leaves NO param, and a filled value never
    // keeps erroring. (Confirms this is NOT the source of the report.)
    serverChild = {
      ...freshChild('sss'), // inner value FILLED
      metadata: {
        ...freshChild('sss').metadata,
        // …but the doc still carries the stale auto_ param from when it was empty.
        parameters: [
          { id: 'auto_csi_node_param1', name: 'Param 1', type: 'string', targetNodeId: 'csi_node', targetSettingKey: 'param1', required: true } as any,
        ],
      },
    };
    useWorkflowStore.getState().setNodeDefinitions([
      { type: 'system:subflow', name: 'Subflow', category: 'custom', icon: 'boxes', ports: [], settings: [] } as any,
      // NOTE: no custom:csi123 def registered — mirrors a parent/session
      // without the localStorage custom def loaded.
    ]);
    const store = useWorkflowStore.getState();
    store.addNode('system:subflow', { x: 0, y: 0 });
    await flush();
    const sfId = useWorkflowStore.getState().nodes.find((n) => n.data.nodeType === 'system:subflow')!.id;
    store.updateNodeSettings(sfId, { subflowId: 'csi_sub' });
    await flush();

    // The value IS filled inside → the parent must not demand it. Today this
    // FAILS: the stale stored auto_ param survives because the missing def
    // prevents re-derivation from dropping it.
    expect(useSchemaStore.getState().getIssues(sfId).some(requiredIssue)).toBe(false);
  });

  it('empty inner custom param → parent shows required error', async () => {
    const store = useWorkflowStore.getState();
    store.addNode('system:subflow', { x: 0, y: 0 });
    await flush();
    const sfId = useWorkflowStore.getState().nodes.find((n) => n.data.nodeType === 'system:subflow')!.id;
    store.updateNodeSettings(sfId, { subflowId: 'csi_sub' });
    await flush();

    expect(useSchemaStore.getState().getIssues(sfId).some(requiredIssue)).toBe(true);
  });

  it('filling Param 1 inside the subflow and exiting clears the parent error', async () => {
    const store = useWorkflowStore.getState();
    store.addNode('system:subflow', { x: 0, y: 0 });
    await flush();
    const sfId = useWorkflowStore.getState().nodes.find((n) => n.data.nodeType === 'system:subflow')!.id;
    store.updateNodeSettings(sfId, { subflowId: 'csi_sub' });
    await flush();
    expect(useSchemaStore.getState().getIssues(sfId).some(requiredIssue)).toBe(true);

    // Enter the subflow, fill Param 1 = 'sss' on the inner custom node, exit.
    useWorkflowStore.getState().enterSubflow(serverChild);
    useWorkflowStore.getState().updateNodeSettings('csi_node', { param1: 'sss' });
    await useWorkflowStore.getState().exitSubflow();
    await flush();

    // The saved subflow doc must carry the filled value on the inner node...
    const savedInner = serverChild.nodes.find((n) => n.id === 'csi_node')!;
    expect(savedInner.settings.param1).toBe('sss');
    // ...the inner custom node also carries compiled inlineIR alongside settings.
    expect((savedInner as any).inlineIR).toBeTruthy();
    // ...and the parent must no longer show the required-param error.
    expect(useSchemaStore.getState().getIssues(sfId).some(requiredIssue)).toBe(false);
    // ...and the live-derived params for the proxy must be empty.
    const { effectiveSubflowParameters } = await import('@beamflow/shared');
    const params = effectiveSubflowParameters(
      useWorkflowStore.getState().subflowCache['csi_sub'] as any,
      (t) => useWorkflowStore.getState().nodeDefinitions.find((d) => d.type === t)?.settings as any,
    );
    expect(params).toEqual([]);
  });
});
