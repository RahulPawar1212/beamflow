/**
 * @module custom-calc-schema
 *
 * Design-time ISchemaNode for calculation-kind custom nodes (see
 * `../customNodes.ts`, `kind: 'calculation'`). Mirrors the built-in schema
 * nodes in `packages/nodes/src/schema/*.schema.ts` (Formula/Aggregate), but
 * is built from the author's declared `OutputColumnDecl[]` instead of a
 * fixed settings shape, since a calculation node's output columns are
 * author-defined rather than a known built-in operation.
 *
 * Lives in the editor (not @beamflow/nodes) because `OutputColumnDecl` and
 * `resolveExpression` ({{param}} substitution) are editor/custom-node
 * concepts — the definition itself only exists in the browser (localStorage).
 *
 * No Apache Beam calls are made.
 */

import type { ISchemaNode, PipelineSchema, ColumnSchema, SchemaValidationIssue } from '@beamflow/schema';
import { emptySchema, createColumn, forwardColumn, ColumnDataType } from '@beamflow/schema';
import { SchemaValidationSeverity } from '@beamflow/schema';
import type { OutputColumnDecl, KeyBySpec } from '../customNodes';
import { resolveExpression } from '../customNodes';

export class CustomCalcSchemaNode implements ISchemaNode {
  readonly nodeId: string;
  private readonly outputColumns: OutputColumnDecl[];
  private readonly settings: Record<string, unknown>;
  private readonly keyBy: KeyBySpec;

  constructor(
    nodeId: string,
    outputColumns: OutputColumnDecl[],
    settings: Record<string, unknown>,
    keyBy: KeyBySpec = { columns: [], mode: 'all' },
  ) {
    this.nodeId = nodeId;
    this.outputColumns = outputColumns;
    this.settings = settings;
    this.keyBy = keyBy;
  }

  private resolvedName(decl: OutputColumnDecl): string {
    return resolveExpression(decl.name || '', this.settings);
  }

  getOutputSchema(inputSchemas: PipelineSchema[]): PipelineSchema {
    const input = inputSchemas[0];
    if (!input) return emptySchema();

    const columnsByName = new Map(input.columns.map((c) => [c.name.toLowerCase(), c]));
    const outputColumns: ColumnSchema[] = [];

    for (const decl of this.outputColumns) {
      if (decl.mode === 'passthrough-all') {
        for (const col of input.columns) {
          outputColumns.push(forwardColumn(col, this.nodeId));
        }
        continue;
      }

      const name = this.resolvedName(decl);
      if (!name) continue;

      if (decl.mode === 'passthrough') {
        const source = columnsByName.get(name.toLowerCase());
        if (source) outputColumns.push(forwardColumn(source, this.nodeId));
        continue;
      }

      // mode === 'new'
      outputColumns.push(
        createColumn({
          name,
          type: decl.type ?? ColumnDataType.STRING,
          nullable: decl.nullable ?? true,
          sourceNodeId: this.nodeId,
        }),
      );
    }

    return { version: input.version + 1, columns: outputColumns };
  }

  validateSchema(inputSchemas: PipelineSchema[]): SchemaValidationIssue[] {
    const input = inputSchemas[0];
    if (!input) return [];

    const columnsByName = new Map(input.columns.map((c) => [c.name.toLowerCase(), c]));
    const issues: SchemaValidationIssue[] = [];

    // ── Group-by key validation ────────────────────────────────────────
    // Resolved at design time from the propagated input schema, so a bad
    // key surfaces as a node badge in the editor instead of a runtime crash.
    if (this.keyBy.columns.length > 0 && input.columns.length > 0) {
      const present = this.keyBy.columns.filter((c) => columnsByName.has(c.toLowerCase()));
      if (this.keyBy.mode === 'first-present') {
        // Priority list: at least ONE candidate must exist in the input.
        if (present.length === 0) {
          issues.push({
            severity: SchemaValidationSeverity.Error,
            message: `None of the group-by candidate columns (${this.keyBy.columns.join(', ')}) exist in the input — this node cannot key its records.`,
            nodeId: this.nodeId,
          });
        }
      } else {
        // 'all': every listed column must exist.
        for (const col of this.keyBy.columns) {
          if (!columnsByName.has(col.toLowerCase())) {
            issues.push({
              severity: SchemaValidationSeverity.Error,
              message: `Group-by column "${col}" was not found in the input.`,
              nodeId: this.nodeId,
              columnName: col,
            });
          }
        }
      }
    }

    for (const decl of this.outputColumns) {
      if (decl.mode !== 'passthrough') continue;
      const name = this.resolvedName(decl);
      if (name && !columnsByName.has(name.toLowerCase())) {
        issues.push({
          severity: SchemaValidationSeverity.Warning,
          message: `Declared passthrough column "${name}" was not found in the input.`,
          nodeId: this.nodeId,
          columnName: name,
        });
      }
    }

    return issues;
  }
}
