/**
 * @module @beamflow/schema/validation
 *
 * Design-time schema validation engine.
 *
 * Validates schema configurations BEFORE any Beam pipeline execution,
 * surfacing issues like:
 *   - Incompatible Join key types
 *   - Mismatched Union schemas
 *   - Missing column references
 *   - Formula type errors
 *
 * All validation is purely metadata-driven — no data is read or executed.
 */

import type { PipelineSchema, ColumnSchema, SchemaValidationIssue } from './types.js';
import {
  SchemaValidationSeverity,
  ColumnDataType,
  isNumericType,
  columnDataTypeLabel,
} from './types.js';
import { typeCheckFormula } from './formula-parser.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function error(message: string, nodeId?: string, columnName?: string): SchemaValidationIssue {
  return { severity: SchemaValidationSeverity.Error, message, nodeId, columnName };
}

function warning(message: string, nodeId?: string, columnName?: string): SchemaValidationIssue {
  return { severity: SchemaValidationSeverity.Warning, message, nodeId, columnName };
}

function info(message: string, nodeId?: string): SchemaValidationIssue {
  return { severity: SchemaValidationSeverity.Info, message, nodeId };
}

/** Look up a column by name (case-insensitive). */
function findColumn(
  schema: PipelineSchema,
  name: string,
): ColumnSchema | undefined {
  return schema.columns.find(
    (c) => c.name.toLowerCase() === name.toLowerCase(),
  );
}

// ─── Schema Validator ─────────────────────────────────────────────────────────

export class SchemaValidator {

  // ─── Column existence ──────────────────────────────────────────────

  /**
   * Validate that every requested column name exists in the schema.
   * Used by Select, Filter, Rename, etc.
   */
  validateColumnsExist(
    schema: PipelineSchema,
    columnNames: string[],
    nodeId?: string,
  ): SchemaValidationIssue[] {
    const issues: SchemaValidationIssue[] = [];
    for (const name of columnNames) {
      if (!findColumn(schema, name)) {
        issues.push(
          error(`Column "${name}" does not exist in the input schema.`, nodeId, name),
        );
      }
    }
    return issues;
  }

  /**
   * Validate that there are no duplicate column names in a schema.
   */
  validateNoDuplicates(
    schema: PipelineSchema,
    nodeId?: string,
  ): SchemaValidationIssue[] {
    const seen = new Set<string>();
    const issues: SchemaValidationIssue[] = [];
    for (const col of schema.columns) {
      const lower = col.name.toLowerCase();
      if (seen.has(lower)) {
        issues.push(
          error(`Duplicate column name "${col.name}" in output schema.`, nodeId, col.name),
        );
      }
      seen.add(lower);
    }
    return issues;
  }

  // ─── Join validation ───────────────────────────────────────────────

  /**
   * Validate a Join operation between two input schemas.
   *
   * Checks:
   * - Both join key columns exist in their respective schemas
   * - Join key types are compatible (both numeric, or both string, or exact match)
   */
  validateJoin(
    leftSchema: PipelineSchema,
    rightSchema: PipelineSchema,
    leftKey: string,
    rightKey: string,
    nodeId?: string,
  ): SchemaValidationIssue[] {
    const issues: SchemaValidationIssue[] = [];

    const leftCol = findColumn(leftSchema, leftKey);
    const rightCol = findColumn(rightSchema, rightKey);

    if (!leftCol) {
      issues.push(
        error(`Join key column "${leftKey}" not found in left input schema.`, nodeId, leftKey),
      );
    }
    if (!rightCol) {
      issues.push(
        error(`Join key column "${rightKey}" not found in right input schema.`, nodeId, rightKey),
      );
    }

    if (leftCol && rightCol) {
      // Type compatibility check
      const typesCompatible = this.joinTypesCompatible(leftCol.type, rightCol.type);
      if (!typesCompatible) {
        issues.push(
          error(
            `Join key type mismatch: "${leftKey}" is ${columnDataTypeLabel(leftCol.type)} but ` +
            `"${rightKey}" is ${columnDataTypeLabel(rightCol.type)}. ` +
            `Join keys must have compatible types.`,
            nodeId,
          ),
        );
      } else if (leftCol.type !== rightCol.type) {
        // Compatible but not identical — warn about implicit widening
        issues.push(
          warning(
            `Join key types differ (${columnDataTypeLabel(leftCol.type)} vs ` +
            `${columnDataTypeLabel(rightCol.type)}). ` +
            `Values will be implicitly cast.`,
            nodeId,
          ),
        );
      }
    }

    return issues;
  }

  private joinTypesCompatible(a: ColumnDataType, b: ColumnDataType): boolean {
    if (a === b) return true;
    // Both numeric
    if (isNumericType(a) && isNumericType(b)) return true;
    // Both string
    if (
      (a === ColumnDataType.STRING || a === ColumnDataType.BYTES) &&
      (b === ColumnDataType.STRING || b === ColumnDataType.BYTES)
    ) return true;
    return false;
  }

  // ─── Union validation ──────────────────────────────────────────────

  /**
   * Validate a Union operation across multiple input schemas.
   *
   * Checks:
   * - All schemas have the same number of columns (error if not)
   * - All schemas have the same column names (error if missing)
   * - All schemas have the same column types (warning if mismatched)
   */
  validateUnion(
    schemas: PipelineSchema[],
    nodeId?: string,
  ): SchemaValidationIssue[] {
    if (schemas.length < 2) {
      return [error('Union requires at least 2 input schemas.', nodeId)];
    }

    const issues: SchemaValidationIssue[] = [];
    const reference = schemas[0];

    for (let i = 1; i < schemas.length; i++) {
      const other = schemas[i];
      const inputLabel = `Input ${i + 1}`;

      if (other.columns.length !== reference.columns.length) {
        issues.push(
          error(
            `${inputLabel} has ${other.columns.length} columns but Input 1 has ` +
            `${reference.columns.length} columns. Union requires identical schema.`,
            nodeId,
          ),
        );
        continue; // Can't meaningfully check column names after count mismatch
      }

      for (let j = 0; j < reference.columns.length; j++) {
        const refCol = reference.columns[j];
        const otherCol = findColumn(other, refCol.name);

        if (!otherCol) {
          issues.push(
            error(
              `${inputLabel} is missing column "${refCol.name}" required for Union.`,
              nodeId,
              refCol.name,
            ),
          );
          continue;
        }

        if (otherCol.type !== refCol.type) {
          issues.push(
            warning(
              `Column "${refCol.name}" has type ${columnDataTypeLabel(refCol.type)} in Input 1 ` +
              `but ${columnDataTypeLabel(otherCol.type)} in ${inputLabel}. ` +
              `Data may be coerced at runtime.`,
              nodeId,
              refCol.name,
            ),
          );
        }
      }
    }

    return issues;
  }

  // ─── Formula validation ────────────────────────────────────────────

  /**
   * Validate a formula expression against an input schema.
   *
   * @param expression - The formula expression string
   * @param inputSchema - The schema available to the formula
   * @param outputColumnName - Name of the output column (for error attribution)
   * @param nodeId - Node ID for error attribution
   */
  validateFormula(
    expression: string,
    inputSchema: PipelineSchema,
    outputColumnName: string,
    nodeId?: string,
  ): SchemaValidationIssue[] {
    const result = typeCheckFormula(expression, inputSchema.columns);
    return result.errors.map((msg) =>
      error(`Formula "${outputColumnName}": ${msg}`, nodeId, outputColumnName),
    );
  }

  // ─── Aggregate validation ──────────────────────────────────────────

  /**
   * Validate an Aggregate node configuration.
   */
  validateAggregate(
    inputSchema: PipelineSchema,
    groupByColumns: string[],
    aggregations: Array<{ column: string; func: string; outputName: string }>,
    nodeId?: string,
  ): SchemaValidationIssue[] {
    const issues: SchemaValidationIssue[] = [];

    const validAggFunctions = new Set([
      'SUM', 'AVG', 'MIN', 'MAX', 'COUNT', 'COUNT_DISTINCT', 'FIRST', 'LAST',
    ]);

    // Validate group-by columns exist
    for (const colName of groupByColumns) {
      if (!findColumn(inputSchema, colName)) {
        issues.push(
          error(`Group-by column "${colName}" does not exist in the input schema.`, nodeId, colName),
        );
      }
    }

    // Validate aggregation columns
    for (const agg of aggregations) {
      const col = findColumn(inputSchema, agg.column);
      if (!col) {
        issues.push(
          error(
            `Aggregation column "${agg.column}" does not exist in the input schema.`,
            nodeId,
            agg.column,
          ),
        );
        continue;
      }

      if (!validAggFunctions.has(agg.func.toUpperCase())) {
        issues.push(
          error(
            `Unknown aggregation function "${agg.func}". ` +
            `Valid functions: ${Array.from(validAggFunctions).join(', ')}.`,
            nodeId,
          ),
        );
        continue;
      }

      // Numeric-only functions
      const numericOnly = new Set(['SUM', 'AVG']);
      if (numericOnly.has(agg.func.toUpperCase()) && !isNumericType(col.type)) {
        issues.push(
          error(
            `Aggregation function ${agg.func} requires a numeric column, ` +
            `but "${agg.column}" is ${columnDataTypeLabel(col.type)}.`,
            nodeId,
            agg.column,
          ),
        );
      }

      // Validate output name
      if (!agg.outputName || agg.outputName.trim() === '') {
        issues.push(
          error(`Aggregation output column name is required.`, nodeId),
        );
      }
    }

    // Warn if no aggregations defined
    if (aggregations.length === 0) {
      issues.push(
        warning('No aggregation functions defined. The Aggregate node produces only group-by columns.', nodeId),
      );
    }

    return issues;
  }

  // ─── Select validation ─────────────────────────────────────────────

  /**
   * Validate a Select node configuration.
   */
  validateSelect(
    inputSchema: PipelineSchema,
    selectedColumns: string[],
    nodeId?: string,
  ): SchemaValidationIssue[] {
    const issues: SchemaValidationIssue[] = [];

    if (selectedColumns.length === 0) {
      issues.push(warning('No columns selected — output schema will be empty.', nodeId));
    }

    issues.push(...this.validateColumnsExist(inputSchema, selectedColumns, nodeId));

    return issues;
  }

  // ─── Rename validation ─────────────────────────────────────────────

  /**
   * Validate a Rename node configuration.
   */
  validateRename(
    inputSchema: PipelineSchema,
    renames: Array<{ from: string; to: string }>,
    nodeId?: string,
  ): SchemaValidationIssue[] {
    const issues: SchemaValidationIssue[] = [];
    const toNames = new Set<string>();

    for (const rename of renames) {
      if (!findColumn(inputSchema, rename.from)) {
        issues.push(
          error(
            `Column "${rename.from}" to be renamed does not exist in the input schema.`,
            nodeId,
            rename.from,
          ),
        );
      }

      if (!rename.to || rename.to.trim() === '') {
        issues.push(
          error(`Rename target name cannot be empty (renaming from "${rename.from}").`, nodeId),
        );
      } else {
        const lower = rename.to.toLowerCase();
        if (toNames.has(lower)) {
          issues.push(
            error(`Duplicate rename target "${rename.to}".`, nodeId, rename.to),
          );
        }
        toNames.add(lower);
      }
    }

    return issues;
  }

  // ─── Source validation ─────────────────────────────────────────────

  /**
   * Validate a CSV Source schema configuration.
   */
  validateCsvSourceSchema(
    columns: Array<{ name: string; type: string }>,
    nodeId?: string,
  ): SchemaValidationIssue[] {
    const issues: SchemaValidationIssue[] = [];

    if (columns.length === 0) {
      issues.push(
        info('No schema columns defined. Configure schema columns to enable downstream type checking.', nodeId),
      );
      return issues;
    }

    const validTypes = new Set(Object.values(ColumnDataType));
    const names = new Set<string>();

    for (const col of columns) {
      if (!col.name || col.name.trim() === '') {
        issues.push(error('Column name cannot be empty.', nodeId));
      } else {
        const lower = col.name.toLowerCase();
        if (names.has(lower)) {
          issues.push(
            error(`Duplicate column name "${col.name}" in schema definition.`, nodeId, col.name),
          );
        }
        names.add(lower);
      }

      if (!validTypes.has(col.type as ColumnDataType)) {
        issues.push(
          error(
            `Invalid type "${col.type}" for column "${col.name}". ` +
            `Valid types: ${Array.from(validTypes).join(', ')}.`,
            nodeId,
            col.name,
          ),
        );
      }
    }

    return issues;
  }
}

/** Singleton validator instance for convenience. */
export const schemaValidator = new SchemaValidator();
