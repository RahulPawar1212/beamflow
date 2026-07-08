/**
 * @module @beamflow/nodes/schema
 *
 * Schema node implementations for all built-in BeamFlow node types.
 *
 * Each schema node is a pure design-time metadata transformer.
 * No Apache Beam APIs are called; no data is read.
 *
 * Usage:
 *   import { registerBuiltinSchemaNodes } from '@beamflow/nodes/schema';
 *   import { schemaNodeRegistry } from '@beamflow/schema';
 *   registerBuiltinSchemaNodes(schemaNodeRegistry);
 */

import type { SchemaNodeRegistry } from '@beamflow/schema';
import { CsvSourceSchemaNode } from './csv-source.schema.js';
import { SqlSourceSchemaNode } from './sql-source.schema.js';
import { FilterSchemaNode } from './filter.schema.js';
import { FormulaSchemaNode } from './formula.schema.js';
import { SelectSchemaNode } from './select.schema.js';
import { RenameSchemaNode } from './rename.schema.js';
import { AggregateSchemaNode } from './aggregate.schema.js';
import { JoinSchemaNode } from './join.schema.js';
import { UnionSchemaNode } from './union.schema.js';
import { SubflowInputSchemaNode } from './subflow-input.schema.js';
import { SubflowPassthroughSchemaNode } from './subflow-passthrough.schema.js';

/**
 * Register all built-in schema node factories with a SchemaNodeRegistry.
 *
 * This is the single call that wires up all built-in node types.
 * External plugins should call registry.register() for their own node types.
 *
 * @example
 * import { schemaNodeRegistry } from '@beamflow/schema';
 * import { registerBuiltinSchemaNodes } from '@beamflow/nodes/schema';
 * registerBuiltinSchemaNodes(schemaNodeRegistry);
 */
export function registerBuiltinSchemaNodes(registry: SchemaNodeRegistry): void {
  registry.register(
    'beamflow:csv-source',
    (nodeId, settings) => new CsvSourceSchemaNode(nodeId, settings),
  );
  registry.register(
    'beamflow:sql-source',
    (nodeId, settings) => new SqlSourceSchemaNode(nodeId, settings),
  );
  registry.register(
    'beamflow:filter',
    (nodeId, settings) => new FilterSchemaNode(nodeId, settings),
  );
  registry.register(
    'beamflow:formula',
    (nodeId, settings) => new FormulaSchemaNode(nodeId, settings),
  );
  registry.register(
    'beamflow:select',
    (nodeId, settings) => new SelectSchemaNode(nodeId, settings),
  );
  registry.register(
    'beamflow:rename',
    (nodeId, settings) => new RenameSchemaNode(nodeId, settings),
  );
  registry.register(
    'beamflow:aggregate',
    (nodeId, settings) => new AggregateSchemaNode(nodeId, settings),
  );
  // Note: beamflow:group-by (existing) maps to AggregateSchemaNode
  registry.register(
    'beamflow:group-by',
    (nodeId, settings) => new AggregateSchemaNode(nodeId, settings),
  );
  registry.register(
    'beamflow:join',
    (nodeId, settings) => new JoinSchemaNode(nodeId, settings),
  );
  registry.register(
    'beamflow:union',
    (nodeId, settings) => new UnionSchemaNode(nodeId, settings),
  );
  registry.register(
    'system:subflow-input',
    (nodeId, settings) => new SubflowInputSchemaNode(nodeId, settings),
  );
  // Subflow output and the subflow proxy itself simply forward upstream schema.
  registry.register(
    'system:subflow-output',
    (nodeId, settings) => new SubflowPassthroughSchemaNode(nodeId, settings),
  );
  registry.register(
    'system:subflow',
    (nodeId, settings) => new SubflowPassthroughSchemaNode(nodeId, settings),
  );
}

// Re-export all schema node classes for direct use
export { CsvSourceSchemaNode, detectSchemaFromSample, inferColumnType } from './csv-source.schema.js';
export type { CsvColumnDef } from './csv-source.schema.js';

export { SqlSourceSchemaNode } from './sql-source.schema.js';
export type { SqlColumnDef } from './sql-source.schema.js';

export { FilterSchemaNode } from './filter.schema.js';
export { FormulaSchemaNode } from './formula.schema.js';
export type { FormulaDef } from './formula.schema.js';

export { SelectSchemaNode } from './select.schema.js';
export { RenameSchemaNode } from './rename.schema.js';
export type { RenameDef } from './rename.schema.js';

export { AggregateSchemaNode } from './aggregate.schema.js';
export type { AggregationDef } from './aggregate.schema.js';

export { JoinSchemaNode } from './join.schema.js';
export { UnionSchemaNode } from './union.schema.js';
export { SubflowInputSchemaNode } from './subflow-input.schema.js';
export { SubflowPassthroughSchemaNode } from './subflow-passthrough.schema.js';
