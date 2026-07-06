/**
 * Join schema node (`beamflow:join`).
 *
 * A Join node merges two input schemas side-by-side.
 *
 * Design-time behaviour:
 * - Output schema = left columns + right columns
 * - Duplicate column names are resolved with configurable prefixes
 * - Lineage is preserved from both left and right inputs
 * - Validates join key existence and type compatibility
 *
 * Settings shape expected:
 * {
 *   leftKey: string;        // join key column from left input
 *   rightKey: string;       // join key column from right input
 *   joinType: 'inner' | 'left' | 'right' | 'full';
 *   leftPrefix?: string;    // prefix for left columns on name collision (default: 'left_')
 *   rightPrefix?: string;   // prefix for right columns on name collision (default: 'right_')
 * }
 *
 * Input ordering:
 *   inputSchemas[0] = left schema
 *   inputSchemas[1] = right schema
 *
 * No Apache Beam calls are made.
 */

import type { ISchemaNode, PipelineSchema, ColumnSchema, SchemaValidationIssue } from '@beamflow/schema';
import { emptySchema, schemaValidator, SchemaValidationSeverity } from '@beamflow/schema';

export class JoinSchemaNode implements ISchemaNode {
  readonly nodeId: string;
  private readonly leftKey: string;
  private readonly rightKey: string;
  private readonly joinType: string;
  private readonly leftPrefix: string;
  private readonly rightPrefix: string;

  constructor(nodeId: string, settings: Record<string, unknown>) {
    this.nodeId = nodeId;
    this.leftKey   = (settings.leftKey as string)    ?? '';
    this.rightKey  = (settings.rightKey as string)   ?? '';
    this.joinType  = (settings.joinType as string)   ?? 'inner';
    this.leftPrefix  = (settings.leftPrefix as string)  ?? 'left_';
    this.rightPrefix = (settings.rightPrefix as string) ?? 'right_';
  }

  getOutputSchema(inputSchemas: PipelineSchema[]): PipelineSchema {
    const left  = inputSchemas[0];
    const right = inputSchemas[1];

    if (!left && !right) return emptySchema();
    if (!left) return right ?? emptySchema();
    if (!right) return left;

    // Collect all right column names for duplicate detection
    const rightNames = new Set(right.columns.map((c) => c.name.toLowerCase()));
    const leftNames  = new Set(left.columns.map((c) => c.name.toLowerCase()));

    // Output columns: left side first
    const outputColumns: ColumnSchema[] = [];

    for (const col of left.columns) {
      const hasDuplicate = rightNames.has(col.name.toLowerCase());
      outputColumns.push({
        ...col,
        name: hasDuplicate ? `${this.leftPrefix}${col.name}` : col.name,
        id: hasDuplicate ? `${this.nodeId}:left:${col.name}` : col.id,
      });
    }

    // Right side columns — skip the join key if it's identical to left key
    for (const col of right.columns) {
      const isRightKey =
        col.name.toLowerCase() === this.rightKey.toLowerCase() &&
        this.leftKey.toLowerCase() === this.rightKey.toLowerCase();

      if (isRightKey) continue; // Don't duplicate join key when names match

      const hasDuplicate = leftNames.has(col.name.toLowerCase());
      outputColumns.push({
        ...col,
        name: hasDuplicate ? `${this.rightPrefix}${col.name}` : col.name,
        id: hasDuplicate ? `${this.nodeId}:right:${col.name}` : col.id,
        sourceNodeId: col.sourceNodeId,
      });
    }

    const maxVersion = Math.max(left.version, right.version);
    return { version: maxVersion + 1, columns: outputColumns };
  }

  validateSchema(inputSchemas: PipelineSchema[]): SchemaValidationIssue[] {
    const left  = inputSchemas[0];
    const right = inputSchemas[1];
    const issues: SchemaValidationIssue[] = [];

    if (!left) {
      issues.push({
        severity: SchemaValidationSeverity.Error,
        message: 'Join is missing its left (primary) input.',
        nodeId: this.nodeId,
      });
    }
    if (!right) {
      issues.push({
        severity: SchemaValidationSeverity.Error,
        message: 'Join is missing its right (secondary) input.',
        nodeId: this.nodeId,
      });
    }

    if (left && right && this.leftKey && this.rightKey) {
      issues.push(
        ...schemaValidator.validateJoin(left, right, this.leftKey, this.rightKey, this.nodeId),
      );
    }

    return issues;
  }
}
