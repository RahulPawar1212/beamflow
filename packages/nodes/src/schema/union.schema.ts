/**
 * Union schema node (`beamflow:union`).
 *
 * A Union node stacks multiple datasets with the same schema on top of each other.
 * All inputs must have compatible schemas.
 *
 * Design-time behaviour:
 * - Output schema = first input schema (structure must match all inputs)
 * - Generates errors if inputs have different column counts or missing columns
 * - Generates warnings if inputs have the same column names but different types
 * - Validates at least 2 inputs are connected
 *
 * Input ordering: all connected inputs are passed in inputSchemas[]
 *
 * No Apache Beam calls are made.
 */

import type { ISchemaNode, PipelineSchema, SchemaValidationIssue } from '@beamflow/schema';
import { emptySchema, bumpVersion, schemaValidator, SchemaValidationSeverity } from '@beamflow/schema';

export class UnionSchemaNode implements ISchemaNode {
  readonly nodeId: string;

  constructor(nodeId: string, _settings: Record<string, unknown>) {
    this.nodeId = nodeId;
  }

  getOutputSchema(inputSchemas: PipelineSchema[]): PipelineSchema {
    const validInputs = inputSchemas.filter((s) => s && s.columns.length > 0);
    if (validInputs.length === 0) return emptySchema();

    // Output schema = first input (all inputs should be identical in a valid Union)
    return bumpVersion(validInputs[0]);
  }

  validateSchema(inputSchemas: PipelineSchema[]): SchemaValidationIssue[] {
    const issues: SchemaValidationIssue[] = [];

    if (inputSchemas.length < 2) {
      issues.push({
        severity: SchemaValidationSeverity.Warning,
        message: 'Union requires at least 2 inputs. Connect more nodes.',
        nodeId: this.nodeId,
      });
      return issues;
    }

    const validInputs = inputSchemas.filter((s) => s && s.columns.length > 0);
    if (validInputs.length >= 2) {
      issues.push(...schemaValidator.validateUnion(validInputs, this.nodeId));
    }

    return issues;
  }
}
