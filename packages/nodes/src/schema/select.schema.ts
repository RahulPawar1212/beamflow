/**
 * Select / Projection schema node (`beamflow:select`, `beamflow:projection`).
 *
 * A Select/Projection node produces a fresh, ordered set of output columns.
 * It supports two settings shapes:
 *
 * 1. Legacy Select — keep a subset of columns by name:
 *      { selectedColumns: string[] }
 *
 * 2. Projection — rename, reorder, and add constant columns:
 *      { selections: Array<{ outputName, sourceColumn?, constant? }> }
 *    - `sourceColumn` set  → forward that input column, renamed to `outputName`
 *      (stable id preserved, so downstream lineage still resolves)
 *    - `constant` set (no source) → a brand-new STRING column
 *
 * Output column order follows the declared order. Anything not listed is dropped.
 * Design-time only — no Apache Beam calls are made.
 */

import type { ISchemaNode, PipelineSchema, ColumnSchema, SchemaValidationIssue } from '@beamflow/schema';
import { emptySchema, createColumn, schemaValidator, ColumnDataType } from '@beamflow/schema';

interface SelectionDef {
  outputName: string;
  sourceColumn?: string;
  constant?: string;
}

export class SelectSchemaNode implements ISchemaNode {
  readonly nodeId: string;
  private readonly selectedColumns: string[];
  private readonly selections: SelectionDef[];

  constructor(nodeId: string, settings: Record<string, unknown>) {
    this.nodeId = nodeId;
    this.selectedColumns = (settings.selectedColumns as string[] | undefined) ?? [];
    this.selections = (settings.selections as SelectionDef[] | undefined) ?? [];
  }

  getOutputSchema(inputSchemas: PipelineSchema[]): PipelineSchema {
    const input = inputSchemas[0];
    if (!input || input.columns.length === 0) return emptySchema();

    const columnsByName = new Map(
      input.columns.map((c) => [c.name.toLowerCase(), c]),
    );

    // Projection shape (rename + constant) takes precedence when present.
    if (this.selections.length > 0) {
      const outputColumns: ColumnSchema[] = [];
      for (const sel of this.selections) {
        if (!sel.outputName) continue;
        const source = sel.sourceColumn
          ? columnsByName.get(sel.sourceColumn.toLowerCase())
          : undefined;
        if (source) {
          // Forward the input column under the new name, preserving its stable id + lineage.
          outputColumns.push({
            ...source,
            name: sel.outputName,
            sourceNodeId: this.nodeId,
            sourceColumn: source.name,
            derivedFrom: [source.id],
          });
        } else {
          // Constant / unmatched column → a fresh STRING column.
          outputColumns.push(
            createColumn({
              name: sel.outputName,
              type: ColumnDataType.STRING,
              nullable: true,
              sourceNodeId: this.nodeId,
              description: sel.constant !== undefined ? `Constant: ${sel.constant}` : undefined,
            }),
          );
        }
      }
      return { version: input.version + 1, columns: outputColumns };
    }

    // Legacy subset-select shape.
    if (this.selectedColumns.length === 0) {
      return { version: input.version + 1, columns: [] };
    }
    const outputColumns: ColumnSchema[] = [];
    for (const colName of this.selectedColumns) {
      const col = columnsByName.get(colName.toLowerCase());
      if (col) outputColumns.push(col);
      // Missing columns are silently omitted here; validateSchema() reports them.
    }
    return { version: input.version + 1, columns: outputColumns };
  }

  validateSchema(inputSchemas: PipelineSchema[]): SchemaValidationIssue[] {
    const input = inputSchemas[0];
    if (!input) return [];

    if (this.selections.length > 0) {
      // Only source-backed selections must reference existing columns; constants are free.
      const referenced = this.selections
        .filter((s) => s.sourceColumn && s.sourceColumn.trim() !== '')
        .map((s) => s.sourceColumn as string);
      return schemaValidator.validateSelect(input, referenced, this.nodeId);
    }

    return schemaValidator.validateSelect(input, this.selectedColumns, this.nodeId);
  }
}
