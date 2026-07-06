/**
 * @module @beamflow/schema/types
 *
 * Core type definitions for the BeamFlow design-time schema system.
 *
 * Architecture note:
 * - These types are ONLY for design-time metadata (column names, types, lineage).
 * - They are NEVER included in generated Apache Beam code.
 * - The existing `DataType` enum in @beamflow/shared handles port-level wire
 *   types (Record, Stream, etc.) — this is a separate concern.
 */

// ─── Column Data Types ───────────────────────────────────────────────────────

/**
 * Data types that can be assigned to individual columns in a schema.
 * These model the ETL-level types, distinct from port-level wire types.
 */
export enum ColumnDataType {
  STRING = 'string',
  INTEGER = 'integer',
  DOUBLE = 'double',
  BOOLEAN = 'boolean',
  DATE = 'date',
  DATETIME = 'datetime',
  TIME = 'time',
  DECIMAL = 'decimal',
  BYTES = 'bytes',
}

// ─── Column Schema ────────────────────────────────────────────────────────────

/**
 * Describes a single column in a pipeline schema.
 *
 * The `id` is a stable nanoid that never changes, even across renames.
 * Downstream nodes track columns by ID, so renaming is safe and lineage
 * is preserved.
 */
export interface ColumnSchema {
  /** Stable unique identifier — survives rename, reorder, etc. */
  readonly id: string;
  /** Human-readable column name (can change on Rename). */
  readonly name: string;
  /** Data type of the column. */
  readonly type: ColumnDataType;
  /** Whether this column can contain null/empty values. */
  readonly nullable: boolean;
  /** ID of the node that originally created this column. */
  readonly sourceNodeId: string;
  /**
   * If this column was forwarded from an upstream schema, the original
   * column name on the source node (before any renames).
   */
  readonly sourceColumn?: string;
  /**
   * IDs of ColumnSchema entries this column was derived from.
   * Used for formula columns: e.g., Total is derived from [Price.id, Qty.id].
   */
  readonly derivedFrom?: readonly string[];
  /** Optional description for documentation. */
  readonly description?: string;
  /** Arbitrary key-value metadata for extensibility. */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

// ─── Pipeline Schema ──────────────────────────────────────────────────────────

/**
 * The complete schema output of a single workflow node.
 *
 * `version` is a monotonically increasing integer. It is bumped every time
 * a schema is recomputed. Downstream nodes use version comparisons to
 * detect staleness without deep equality checks.
 */
export interface PipelineSchema {
  /** Schema version — bumped on every recomputation. */
  readonly version: number;
  /** Ordered list of columns in this schema. */
  readonly columns: readonly ColumnSchema[];
}

// ─── Schema Change Event ─────────────────────────────────────────────────────

/** Emitted by the propagation engine when a node's output schema changes. */
export interface SchemaChangeEvent {
  /** The node whose output schema was updated. */
  readonly nodeId: string;
  /** The new computed output schema. */
  readonly schema: PipelineSchema;
  /** The previous schema (undefined if this is the first computation). */
  readonly previousSchema: PipelineSchema | undefined;
}

/** Listener callback for schema change events. */
export type SchemaChangeListener = (event: SchemaChangeEvent) => void;

// ─── Schema Validation ────────────────────────────────────────────────────────

/** Severity level for schema validation issues. */
export enum SchemaValidationSeverity {
  Error = 'error',
  Warning = 'warning',
  Info = 'info',
}

/** A single schema validation issue. */
export interface SchemaValidationIssue {
  readonly severity: SchemaValidationSeverity;
  readonly message: string;
  /** The node this issue belongs to. */
  readonly nodeId?: string;
  /** The column name involved (if applicable). */
  readonly columnName?: string;
}

// ─── Formula Parser Result ────────────────────────────────────────────────────

/** Result of type-checking a formula expression. */
export interface FormulaTypeCheckResult {
  /** Inferred output type (undefined if expression is invalid). */
  readonly outputType: ColumnDataType | undefined;
  /** Type errors found during analysis. */
  readonly errors: readonly string[];
  /** Warnings (e.g., implicit numeric widening). */
  readonly warnings: readonly string[];
  /** Column IDs referenced by this expression (for derivedFrom tracking). */
  readonly referencedColumnIds: readonly string[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Returns true if the type is numeric (INTEGER, DOUBLE, or DECIMAL). */
export function isNumericType(type: ColumnDataType): boolean {
  return (
    type === ColumnDataType.INTEGER ||
    type === ColumnDataType.DOUBLE ||
    type === ColumnDataType.DECIMAL
  );
}

/** Returns true if the type is a string type. */
export function isStringType(type: ColumnDataType): boolean {
  return type === ColumnDataType.STRING || type === ColumnDataType.BYTES;
}

/** Returns true if the type is a date/time type. */
export function isTemporalType(type: ColumnDataType): boolean {
  return (
    type === ColumnDataType.DATE ||
    type === ColumnDataType.DATETIME ||
    type === ColumnDataType.TIME
  );
}

/**
 * Compute the result type of a binary arithmetic operation.
 * Returns undefined if the types are incompatible.
 *
 * Rules:
 * - integer + integer → integer
 * - integer + double  → double
 * - double  + double  → double
 * - decimal + *       → decimal
 * - anything else     → undefined (type error)
 */
export function arithmeticResultType(
  left: ColumnDataType,
  right: ColumnDataType,
): ColumnDataType | undefined {
  if (!isNumericType(left) || !isNumericType(right)) return undefined;
  if (left === ColumnDataType.DECIMAL || right === ColumnDataType.DECIMAL)
    return ColumnDataType.DECIMAL;
  if (left === ColumnDataType.DOUBLE || right === ColumnDataType.DOUBLE)
    return ColumnDataType.DOUBLE;
  return ColumnDataType.INTEGER;
}

/** Human-readable label for a ColumnDataType. */
export function columnDataTypeLabel(type: ColumnDataType): string {
  const labels: Record<ColumnDataType, string> = {
    [ColumnDataType.STRING]: 'String',
    [ColumnDataType.INTEGER]: 'Integer',
    [ColumnDataType.DOUBLE]: 'Double',
    [ColumnDataType.BOOLEAN]: 'Boolean',
    [ColumnDataType.DATE]: 'Date',
    [ColumnDataType.DATETIME]: 'DateTime',
    [ColumnDataType.TIME]: 'Time',
    [ColumnDataType.DECIMAL]: 'Decimal',
    [ColumnDataType.BYTES]: 'Bytes',
  };
  return labels[type];
}
