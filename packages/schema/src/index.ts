/**
 * @module @beamflow/schema
 *
 * Public API for the BeamFlow design-time schema propagation system.
 *
 * This package provides:
 * - ColumnDataType: ETL-level column types (STRING, INTEGER, DOUBLE, etc.)
 * - ColumnSchema / PipelineSchema: the schema model
 * - ISchemaNode: interface every node must implement for schema computation
 * - SchemaNodeRegistry: register schema node factories by node type
 * - SchemaPropagationEngine: orchestrates design-time schema propagation
 * - SchemaValidator: validates schemas before execution
 * - LineageTracker: tracks column-level data lineage
 * - typeCheckFormula: type-checks formula expressions at design-time
 *
 * Core principle:
 *   Schema nodes are pure metadata transformers.
 *   They never read data or call Apache Beam APIs.
 *   All computation is design-time only.
 */

// ─── Types ────────────────────────────────────────────────────────────────────
export {
  ColumnDataType,
  SchemaValidationSeverity,
  isNumericType,
  isStringType,
  isTemporalType,
  arithmeticResultType,
  columnDataTypeLabel,
} from './types.js';

export type {
  ColumnSchema,
  PipelineSchema,
  SchemaChangeEvent,
  SchemaChangeListener,
  SchemaValidationIssue,
  FormulaTypeCheckResult,
} from './types.js';

// ─── Schema Node Interface ────────────────────────────────────────────────────
export type { ISchemaNode, SchemaNodeFactory } from './schema-node.js';
export { SchemaNodeRegistry, schemaNodeRegistry } from './schema-node.js';

// ─── Propagation Engine ───────────────────────────────────────────────────────
export {
  SchemaPropagationEngine,
  schemaPropagationEngine,
  emptySchema,
  bumpVersion,
  createColumn,
  forwardColumn,
} from './propagation-engine.js';

// ─── Validation ───────────────────────────────────────────────────────────────
export { SchemaValidator, schemaValidator } from './validation.js';

// ─── Formula Parser ───────────────────────────────────────────────────────────
export {
  typeCheckFormula,
  getBuiltinFunctionNames,
  getFunctionDef,
} from './formula-parser.js';

// ─── Lineage ──────────────────────────────────────────────────────────────────
export { LineageTracker, lineageTracker } from './lineage.js';
export type { ColumnLineageNode, ColumnLineage } from './lineage.js';
