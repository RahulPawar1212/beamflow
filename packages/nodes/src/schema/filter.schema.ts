/**
 * Filter schema node (`beamflow:filter`).
 *
 * A Filter node only removes rows — it never adds, removes, or changes columns.
 * Therefore its output schema is identical to its input schema.
 *
 * Design-time behaviour:
 * - Output schema = Input schema (version bumped to signal propagation)
 * - Validates that the filter field column exists in the input schema
 *
 * No Apache Beam calls are made.
 */

import type { ISchemaNode, PipelineSchema, SchemaValidationIssue } from '@beamflow/schema';
import { emptySchema, bumpVersion, schemaValidator } from '@beamflow/schema';

export class FilterSchemaNode implements ISchemaNode {
  readonly nodeId: string;
  private readonly field: string;

  constructor(nodeId: string, settings: Record<string, unknown>) {
    this.nodeId = nodeId;
    this.field = (settings.field as string) ?? '';
  }

  getOutputSchema(inputSchemas: PipelineSchema[]): PipelineSchema {
    const input = inputSchemas[0];
    if (!input || input.columns.length === 0) return emptySchema();
    // Filter preserves schema exactly — only row count changes at runtime
    return bumpVersion(input);
  }

  validateSchema(inputSchemas: PipelineSchema[]): SchemaValidationIssue[] {
    const input = inputSchemas[0];
    if (!input) return [];
    if (!this.field) return [];
    return schemaValidator.validateColumnsExist(input, [this.field], this.nodeId);
  }
}
