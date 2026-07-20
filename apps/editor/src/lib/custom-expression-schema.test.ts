/**
 * Regression test for schema propagation on expression-kind custom nodes
 * (Map/Filter/FlatMap over `element`, created via CustomNodeModal).
 *
 * Before this fix, createSchemaNodeForType only built a CustomCalcSchemaNode
 * for kind: 'calculation' — expression-kind nodes always fell back to blind
 * input passthrough, so a Map node that added a new column (e.g. `total`)
 * never surfaced that column to downstream Property Panel pickers. Declaring
 * `outputColumns` on an expression-kind def should now propagate exactly
 * like it already does for calculation-kind nodes.
 *
 * Drives the REAL workflow-store and schema-store together, same pattern as
 * subflow-schema.test.ts.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useWorkflowStore } from '../store/workflow-store';
import { useSchemaStore } from './schema-store';
import type { CustomNodeDef } from '../customNodes';

const CSV_COLUMNS = [
  { name: 'qty', type: 'integer', nullable: true },
  { name: 'price', type: 'double', nullable: true },
];

function columnsInto(targetId: string): string[] {
  const { edges } = useWorkflowStore.getState();
  const schemas = useSchemaStore.getState().schemas;
  return edges
    .filter((e) => e.target === targetId)
    .flatMap((e) => schemas.get(e.source)?.outputSchema.columns.map((c) => c.name) ?? []);
}

async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

beforeEach(() => {
  useWorkflowStore.getState().clearWorkflow();
  useSchemaStore.getState().clearSchemas();
  useWorkflowStore.getState().setNodeDefinitions([
    { type: 'beamflow:csv-source', name: 'CSV Source', category: 'source', icon: 'file', ports: [], settings: [] } as any,
    { type: 'beamflow:filter', name: 'Filter', category: 'transform', icon: 'filter', ports: [], settings: [] } as any,
  ]);
});

describe('expression-kind custom node schema propagation', () => {
  it('an expression node with declared outputColumns propagates its new column downstream', async () => {
    const store = useWorkflowStore.getState();

    const addTotalNode: CustomNodeDef = {
      id: 'custom:add-total',
      name: 'Add Total',
      description: 'Adds a total column',
      icon: 'sparkles',
      kind: 'expression',
      operation: 'MapExpr',
      expression: "{**element, 'total': element['qty'] * element['price']}",
      settings: [],
      outputColumns: [
        { mode: 'passthrough-all' },
        { mode: 'new', name: 'total', type: 'double', nullable: true } as any,
      ],
      createdAt: new Date().toISOString(),
    };
    store.upsertCustomNode(addTotalNode);

    store.addNode('beamflow:csv-source', { x: 0, y: 0 });
    await flush();
    const srcId = useWorkflowStore.getState().nodes.find((n) => n.data.nodeType === 'beamflow:csv-source')!.id;
    store.updateNodeSettings(srcId, { schemaColumns: CSV_COLUMNS });

    store.addNode('custom:add-total', { x: 300, y: 0 });
    await flush();
    const mapId = useWorkflowStore.getState().nodes.find((n) => n.data.nodeType === 'custom:add-total')!.id;

    store.addNode('beamflow:filter', { x: 600, y: 0 });
    await flush();
    const fltId = useWorkflowStore.getState().nodes.find((n) => n.data.nodeType === 'beamflow:filter')!.id;

    store.onConnect({ source: srcId, target: mapId, sourceHandle: 'out', targetHandle: 'in' } as any);
    store.onConnect({ source: mapId, target: fltId, sourceHandle: 'out', targetHandle: 'in' } as any);
    await flush();

    // The custom node's own output includes the declared new column...
    expect(columnsInto(fltId)).toEqual(['qty', 'price', 'total']);
  });

  it('an expression node with NO declared outputColumns still falls back to input passthrough', async () => {
    const store = useWorkflowStore.getState();

    const undeclaredNode: CustomNodeDef = {
      id: 'custom:undeclared',
      name: 'Undeclared Map',
      description: '',
      icon: 'sparkles',
      kind: 'expression',
      operation: 'MapExpr',
      expression: "{**element, 'total': element['qty'] * element['price']}",
      settings: [],
      createdAt: new Date().toISOString(),
    };
    store.upsertCustomNode(undeclaredNode);

    store.addNode('beamflow:csv-source', { x: 0, y: 0 });
    await flush();
    const srcId = useWorkflowStore.getState().nodes.find((n) => n.data.nodeType === 'beamflow:csv-source')!.id;
    store.updateNodeSettings(srcId, { schemaColumns: CSV_COLUMNS });

    store.addNode('custom:undeclared', { x: 300, y: 0 });
    await flush();
    const mapId = useWorkflowStore.getState().nodes.find((n) => n.data.nodeType === 'custom:undeclared')!.id;

    store.onConnect({ source: srcId, target: mapId, sourceHandle: 'out', targetHandle: 'in' } as any);
    await flush();

    // No declared schema → passthrough of whatever came in, unchanged (pre-existing behavior).
    expect(useSchemaStore.getState().schemas.get(mapId)?.outputSchema.columns.map((c) => c.name)).toEqual([
      'qty',
      'price',
    ]);
  });
});
