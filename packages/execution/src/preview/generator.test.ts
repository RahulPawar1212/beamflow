import { describe, it, expect } from 'vitest';
import { DAG } from '@beamflow/graph';
import { createRegistry } from '@beamflow/core';
import { NodeCategory, PortDirection, DataType, IRStepType } from '@beamflow/shared';
import { generatePreviewPipeline } from './generator.js';

const sqlSourceDef = {
  type: 'beamflow:sql-source',
  name: 'SQL Source',
  description: '',
  category: NodeCategory.Source,
  icon: '',
  version: '1.0.0',
  ports: [{ id: 'out', name: 'out', direction: PortDirection.Output, dataType: DataType.Record, required: false }],
  settings: [],
  toIR: (settings: any) => ({
    operation: 'ReadFromSQL',
    stepType: IRStepType.Read,
    params: { connectionString: settings.connectionString, sqlQuery: settings.sqlQuery },
    imports: [],
  }),
  validate: () => [],
};

const filterDef = {
  type: 'beamflow:filter',
  name: 'Filter',
  description: '',
  category: NodeCategory.Transform,
  icon: '',
  version: '1.0.0',
  ports: [
    { id: 'in', name: 'in', direction: PortDirection.Input, dataType: DataType.Record, required: true },
    { id: 'out', name: 'out', direction: PortDirection.Output, dataType: DataType.Record, required: false },
  ],
  settings: [],
  toIR: (settings: any) => ({
    operation: 'Filter',
    stepType: IRStepType.Transform,
    params: { field: settings.field, operator: settings.operator, value: settings.value },
    imports: [],
  }),
  validate: () => [],
};

const csvOutputDef = {
  type: 'beamflow:csv-output',
  name: 'CSV Output',
  description: '',
  category: NodeCategory.Output,
  icon: '',
  version: '1.0.0',
  ports: [{ id: 'in', name: 'in', direction: PortDirection.Input, dataType: DataType.Record, required: true }],
  settings: [],
  toIR: (settings: any) => ({
    operation: 'WriteToCSV',
    stepType: IRStepType.Write,
    params: { filePath: settings.filePath },
    imports: [],
  }),
  validate: () => [],
};

function makeRegistry() {
  const registry = createRegistry();
  registry.register(sqlSourceDef as any);
  registry.register(filterDef as any);
  registry.register(csvOutputDef as any);
  return registry;
}

function makeSourceFilterOutputDag() {
  const dag = new DAG();
  dag.addNode({ id: 'sql_src', type: 'beamflow:sql-source', settings: { connectionString: 'sqlite:///x.db', sqlQuery: 'SELECT * FROM t' }, position: { x: 0, y: 0 } });
  dag.addNode({ id: 'filt', type: 'beamflow:filter', settings: { field: 'x', operator: '>', value: '0' }, position: { x: 100, y: 0 } });
  dag.addNode({ id: 'out', type: 'beamflow:csv-output', settings: { filePath: 'out.csv' }, position: { x: 200, y: 0 } });
  dag.addEdge({ id: 'e1', sourceNodeId: 'sql_src', sourcePortId: 'out', targetNodeId: 'filt', targetPortId: 'in' });
  dag.addEdge({ id: 'e2', sourceNodeId: 'filt', sourcePortId: 'out', targetNodeId: 'out', targetPortId: 'in' });
  return dag;
}

describe('generatePreviewPipeline', () => {
  it('attaches the preview sink to a Write/sink node\'s UPSTREAM input, not its own (non-data) output', () => {
    // A Write step's PTransform (e.g. WriteToCSVTransform) returns a write
    // result, not a PCollection of records. Feeding that into the preview
    // sink produced garbage data or crashed deep in the runner. Previewing a
    // sink node means "show me the data about to be written," so the sink
    // must read from the sink's upstream input instead.
    const dag = makeSourceFilterOutputDag();
    const generated = generatePreviewPipeline(dag, 'out', makeRegistry() as any, 'preview.feather', 1000);

    expect(generated.code).toMatch(/step_filt\s*\|\s*'Preview Sink'\s*>>\s*PreviewFeatherSinkTransform/);
    expect(generated.code).not.toMatch(/step_out\s*\|\s*'Preview Sink'/);
  });

  it('still attaches the preview sink to the target\'s own output for a non-Write (Transform) node', () => {
    const dag = makeSourceFilterOutputDag();
    const generated = generatePreviewPipeline(dag, 'filt', makeRegistry() as any, 'preview.feather', 1000);

    expect(generated.code).toMatch(/step_filt\s*\|\s*'Preview Sink'\s*>>\s*PreviewFeatherSinkTransform/);
  });
});
