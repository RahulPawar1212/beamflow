/**
 * SQL Connection Source schema node (`beamflow:sql-source`).
 *
 * Produces a PipelineSchema based on database columns
 * configured in the node's settings panel.
 *
 * Design-time behaviour:
 * - Reads `settings.schemaColumns` — an array of { name, type } objects
 *   retrieved during design-time from database metadata or query preview.
 * - Creates a stable ColumnSchema (with stable lineage ID) for each column.
 * - Does NOT execute the actual SQL query (that is a runtime concern).
 */

import type { ISchemaNode, PipelineSchema, SchemaValidationIssue } from '@beamflow/schema';
import {
  ColumnDataType,
  emptySchema,
  schemaValidator,
} from '@beamflow/schema';

export interface SqlColumnDef {
  name: string;
  type: string; // ColumnDataType value string, e.g. 'string', 'integer'
  nullable?: boolean;
}

export class SqlSourceSchemaNode implements ISchemaNode {
  readonly nodeId: string;
  private readonly columns: SqlColumnDef[];

  constructor(nodeId: string, settings: Record<string, unknown>) {
    this.nodeId = nodeId;
    this.columns = (settings.schemaColumns as SqlColumnDef[] | undefined) ?? [];
  }

  getOutputSchema(_inputSchemas: PipelineSchema[]): PipelineSchema {
    if (this.columns.length === 0) {
      return emptySchema();
    }

    const columns = this.columns.map((col) => ({
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
    // Reuses the columns metadata validation logic (duplicates, empty names, valid datatypes)
    return schemaValidator.validateCsvSourceSchema(this.columns, this.nodeId);
  }
}
