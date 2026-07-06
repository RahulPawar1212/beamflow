/**
 * Rename schema node (`beamflow:rename`).
 *
 * A Rename node changes column names while preserving everything else:
 * type, nullable, stable ID, and lineage chain.
 *
 * Design-time behaviour:
 * - Same columns as input, with selected names changed
 * - Column IDs are PRESERVED (stable ID survives rename)
 * - sourceColumn tracks the original name for full lineage
 * - Reports errors for any rename source column that doesn't exist
 * - Reports errors for duplicate target names
 *
 * Settings shape expected:
 * {
 *   renames: Array<{ from: string; to: string }>
 * }
 *
 * Example:
 *   Input:  [{ id: 'abc', name: 'Price', type: DOUBLE }]
 *   Rename: { from: 'Price', to: 'SellingPrice' }
 *   Output: [{ id: 'abc', name: 'SellingPrice', type: DOUBLE, sourceColumn: 'Price' }]
 *
 * No Apache Beam calls are made.
 */

import type { ISchemaNode, PipelineSchema, ColumnSchema, SchemaValidationIssue } from '@beamflow/schema';
import { emptySchema, schemaValidator } from '@beamflow/schema';

export interface RenameDef {
  from: string;
  to: string;
}

export class RenameSchemaNode implements ISchemaNode {
  readonly nodeId: string;
  private readonly renames: RenameDef[];

  constructor(nodeId: string, settings: Record<string, unknown>) {
    this.nodeId = nodeId;
    this.renames = (settings.renames as RenameDef[] | undefined) ?? [];
  }

  getOutputSchema(inputSchemas: PipelineSchema[]): PipelineSchema {
    const input = inputSchemas[0];
    if (!input || input.columns.length === 0) return emptySchema();

    // Build a lookup: original name → new name
    const renameMap = new Map(
      this.renames.map((r) => [r.from.toLowerCase(), r.to]),
    );

    const outputColumns: ColumnSchema[] = input.columns.map((col) => {
      const newName = renameMap.get(col.name.toLowerCase());
      if (!newName) return col; // Not renamed — pass through unchanged

      return {
        ...col,
        // Name changes, but ID is PRESERVED — this is the key invariant
        name: newName,
        // Track the original column name for lineage
        sourceColumn: col.sourceColumn ?? col.name,
        // Mark as derived from the original column ID
        derivedFrom: [col.id],
      };
    });

    return { version: input.version + 1, columns: outputColumns };
  }

  validateSchema(inputSchemas: PipelineSchema[]): SchemaValidationIssue[] {
    const input = inputSchemas[0];
    if (!input) return [];
    return schemaValidator.validateRename(input, this.renames, this.nodeId);
  }
}
