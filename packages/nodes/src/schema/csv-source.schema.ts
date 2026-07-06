/**
 * CSV Source schema node (`beamflow:csv-source`).
 *
 * Produces a PipelineSchema based on user-defined column definitions
 * configured in the node's settings panel.
 *
 * Design-time behaviour:
 * - Reads `settings.schemaColumns` — an array of { name, type } objects
 *   set by the user in the CSV Source node's property panel
 * - Creates a stable ColumnSchema (with nanoid) for each column
 * - Does NOT read the actual CSV file (that is a runtime concern)
 * - Allows per-column nullable overrides via `settings.nullableColumns`
 *
 * No Apache Beam calls are made.
 */

import { nanoid } from 'nanoid';
import type { ISchemaNode, PipelineSchema, SchemaValidationIssue } from '@beamflow/schema';
import {
  ColumnDataType,
  emptySchema,
  schemaValidator,
  SchemaValidationSeverity,
} from '@beamflow/schema';

/** Shape of the schemaColumns setting value. */
export interface CsvColumnDef {
  name: string;
  type: string;   // ColumnDataType value string, e.g. 'string', 'integer'
  nullable?: boolean;
}

export class CsvSourceSchemaNode implements ISchemaNode {
  readonly nodeId: string;
  private readonly columns: CsvColumnDef[];

  constructor(nodeId: string, settings: Record<string, unknown>) {
    this.nodeId = nodeId;
    // schemaColumns is an array of { name, type } set in the property panel
    this.columns = (settings.schemaColumns as CsvColumnDef[] | undefined) ?? [];
  }

  getOutputSchema(_inputSchemas: PipelineSchema[]): PipelineSchema {
    if (this.columns.length === 0) {
      // No schema defined — return empty schema so downstream nodes can still exist
      return emptySchema();
    }

    const columns = this.columns.map((col) => ({
      // Use a deterministic-ish ID based on node+name so that the same column
      // gets a stable ID across recomputations (important for lineage)
      id: `${this.nodeId}:${col.name}`,
      name: col.name,
      type: (col.type as ColumnDataType) ?? ColumnDataType.STRING,
      nullable: col.nullable ?? true,
      sourceNodeId: this.nodeId,
      sourceColumn: col.name,
    }));

    return { version: 1, columns };
  }

  validateSchema(_inputSchemas: PipelineSchema[]): SchemaValidationIssue[] {
    return schemaValidator.validateCsvSourceSchema(this.columns, this.nodeId);
  }
}

/**
 * Attempt to infer a ColumnDataType from a string sample value.
 * Used by the editor when auto-detecting schema from CSV preview rows.
 */
export function inferColumnType(value: string): ColumnDataType {
  if (value === '' || value === null || value === undefined) return ColumnDataType.STRING;

  // Boolean
  if (/^(true|false|yes|no|1|0)$/i.test(value.trim())) return ColumnDataType.BOOLEAN;

  // Integer
  if (/^-?\d+$/.test(value.trim())) return ColumnDataType.INTEGER;

  // Double
  if (/^-?\d+\.\d+$/.test(value.trim())) return ColumnDataType.DOUBLE;

  // Date: YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return ColumnDataType.DATE;

  // DateTime: YYYY-MM-DD HH:MM or YYYY-MM-DDTHH:MM
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(value.trim())) return ColumnDataType.DATETIME;

  // Time: HH:MM or HH:MM:SS
  if (/^\d{2}:\d{2}(:\d{2})?$/.test(value.trim())) return ColumnDataType.TIME;

  return ColumnDataType.STRING;
}

/**
 * Auto-detect schema from a set of sample rows.
 *
 * @param headers - Column names from the CSV header row
 * @param sampleRows - A few sample data rows (2D array, values as strings)
 * @param nodeId - The source node ID (used to generate stable column IDs)
 * @returns A PipelineSchema inferred from the sample data
 */
export function detectSchemaFromSample(
  headers: string[],
  sampleRows: string[][],
  nodeId: string,
): PipelineSchema {
  const columns = headers.map((header, colIndex) => {
    // Infer type from first non-empty value in this column
    let inferredType = ColumnDataType.STRING;
    for (const row of sampleRows) {
      const val = row[colIndex]?.trim() ?? '';
      if (val !== '') {
        inferredType = inferColumnType(val);
        break;
      }
    }

    return {
      id: `${nodeId}:${header}`,
      name: header,
      type: inferredType,
      nullable: true,
      sourceNodeId: nodeId,
      sourceColumn: header,
    };
  });

  return { version: 1, columns };
}
