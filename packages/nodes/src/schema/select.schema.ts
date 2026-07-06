/**
 * Select schema node (`beamflow:select`).
 *
 * A Select node keeps only the specified columns, discarding the rest.
 *
 * Design-time behaviour:
 * - Output schema = subset of input schema matching selectedColumns
 * - Column order in output matches the order of selectedColumns
 * - Preserves stable column IDs and lineage from input
 * - Reports errors for any selected column that doesn't exist
 *
 * Settings shape expected:
 * {
 *   selectedColumns: string[]   // column names to keep
 * }
 *
 * No Apache Beam calls are made.
 */

import type { ISchemaNode, PipelineSchema, ColumnSchema, SchemaValidationIssue } from '@beamflow/schema';
import { emptySchema, schemaValidator } from '@beamflow/schema';

export class SelectSchemaNode implements ISchemaNode {
  readonly nodeId: string;
  private readonly selectedColumns: string[];

  constructor(nodeId: string, settings: Record<string, unknown>) {
    this.nodeId = nodeId;
    this.selectedColumns = (settings.selectedColumns as string[] | undefined) ?? [];
  }

  getOutputSchema(inputSchemas: PipelineSchema[]): PipelineSchema {
    const input = inputSchemas[0];
    if (!input || input.columns.length === 0) return emptySchema();

    if (this.selectedColumns.length === 0) {
      // No selection configured — output nothing
      return { version: input.version + 1, columns: [] };
    }

    const columnsByName = new Map(
      input.columns.map((c) => [c.name.toLowerCase(), c]),
    );

    const outputColumns: ColumnSchema[] = [];
    for (const colName of this.selectedColumns) {
      const col = columnsByName.get(colName.toLowerCase());
      if (col) {
        outputColumns.push(col);
      }
      // Missing columns are silently omitted here; validateSchema() reports them
    }

    return { version: input.version + 1, columns: outputColumns };
  }

  validateSchema(inputSchemas: PipelineSchema[]): SchemaValidationIssue[] {
    const input = inputSchemas[0];
    if (!input) return [];
    return schemaValidator.validateSelect(input, this.selectedColumns, this.nodeId);
  }
}
