/**
 * Schema propagation with an AUTO-DERIVED subflow output (no explicit
 * system:subflow-output node). Proves the design-time expander routes the single
 * terminal to the proxy so downstream columns still populate — and that a
 * multi-terminal (ambiguous) subflow degrades gracefully rather than blanking.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SerializedWorkflowDTO } from '../api/client';

// child_derived: csv-source ONLY (no output node) → single terminal.
const childDerived: SerializedWorkflowDTO = {
  schemaVersion: '1.0.0',
  metadata: { id: 'child_derived', name: 'derived', isSubflow: true, createdAt: '', updatedAt: '' },
  nodes: [
    { id: 'csv', type: 'beamflow:csv-source', settings: { schemaColumns: [
      { name: 'colA', type: 'string', nullable: true },
      { name: 'colB', type: 'integer', nullable: true },
    ] } } as any,
  ],
  connections: [],
};

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>();
  return { ...actual, api: { ...actual.api, getPipeline: vi.fn(async (id: string) => {
    if (id === 'child_derived') return childDerived;
    throw new Error(`unexpected getPipeline(${id})`);
  }) } };
});

const { useWorkflowStore } = await import('../store/workflow-store');
const { useSchemaStore } = await import('./schema-store');

async function flush() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  for (let i = 0; i < 12; i++) await Promise.resolve();
}
function columnsInto(target: string): string[] {
  const { edges } = useWorkflowStore.getState();
  const schemas = useSchemaStore.getState().schemas;
  return edges.filter((e) => e.target === target)
    .flatMap((e) => schemas.get(e.source)?.outputSchema.columns.map((c) => c.name) ?? []);
}

beforeEach(() => {
  useWorkflowStore.getState().clearWorkflow();
  useSchemaStore.getState().clearSchemas();
  useWorkflowStore.getState().setNodeDefinitions([
    { type: 'system:subflow', name: 'Subflow', category: 'custom', icon: 'boxes', ports: [], settings: [] } as any,
    { type: 'beamflow:filter', name: 'Filter', category: 'transform', icon: 'filter', ports: [], settings: [] } as any,
  ]);
});

describe('subflow with derived output (no explicit output node)', () => {
  it('propagates the single terminal’s columns to a downstream Filter', async () => {
    useWorkflowStore.getState().loadWorkflow({
      schemaVersion: '1.0.0',
      metadata: { id: 'parent', name: 'parent', createdAt: '', updatedAt: '' },
      nodes: [
        { id: 'sf', type: 'system:subflow', settings: { subflowId: 'child_derived' } } as any,
        { id: 'flt', type: 'beamflow:filter', settings: {} } as any,
      ],
      connections: [
        { id: 'e', sourceNodeId: 'sf', sourcePortId: 'out', targetNodeId: 'flt', targetPortId: 'in' } as any,
      ],
    } as SerializedWorkflowDTO);
    await flush();
    // The subflow has NO output node, but its single terminal (csv) is derived
    // as the output → the Filter sees the columns.
    expect(columnsInto('flt')).toEqual(['colA', 'colB']);
  });
});
