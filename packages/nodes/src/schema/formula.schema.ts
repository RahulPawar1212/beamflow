/**
 * Formula schema node (`beamflow:formula`).
 *
 * A Formula node adds one or more computed columns to the input schema.
 *
 * Design-time behaviour:
 * - Passes all input columns through unchanged
 * - Appends new columns for each formula definition
 * - Uses the formula type-checker to infer output column types
 * - Tracks lineage: new columns carry derivedFrom IDs of referenced columns
 * - Reports type errors immediately (e.g., "Cannot apply '+' to Double and String")
 *
 * Settings shape expected:
 * {
 *   formulas: Array<{
 *     outputColumn: string;   // name of the new column
 *     expression: string;     // e.g. "Price * Quantity"
 *     nullable?: boolean;
 *   }>
 * }
 *
 * No Apache Beam calls are made.
 */

import { nanoid } from 'nanoid';
import type { ISchemaNode, PipelineSchema, ColumnSchema, SchemaValidationIssue } from '@beamflow/schema';
import {
  emptySchema,
  bumpVersion,
  typeCheckFormula,
  ColumnDataType,
  schemaValidator,
  SchemaValidationSeverity,
} from '@beamflow/schema';

export interface FormulaDef {
  outputColumn: string;
  expression: string;
  nullable?: boolean;
}

export class FormulaSchemaNode implements ISchemaNode {
  readonly nodeId: string;
  private readonly formulas: FormulaDef[];

  constructor(nodeId: string, settings: Record<string, unknown>) {
    this.nodeId = nodeId;
    this.formulas = (settings.formulas as FormulaDef[] | undefined) ?? [];
  }

  getOutputSchema(inputSchemas: PipelineSchema[]): PipelineSchema {
    const input = inputSchemas[0];
    if (!input) return emptySchema();

    // Start with all input columns passed through
    const outputColumns: ColumnSchema[] = [...input.columns];

    // Add one new column per formula
    for (const formula of this.formulas) {
      if (!formula.outputColumn || !formula.expression) continue;

      const typeResult = typeCheckFormula(formula.expression, input.columns);
      const inferredType = typeResult.outputType ?? ColumnDataType.STRING;

      const newCol: ColumnSchema = {
        id: `${this.nodeId}:${formula.outputColumn}`,
        name: formula.outputColumn,
        type: inferredType,
        nullable: formula.nullable ?? true,
        sourceNodeId: this.nodeId,
        sourceColumn: formula.outputColumn,
        derivedFrom: typeResult.referencedColumnIds,
        description: `Computed: ${formula.expression}`,
      };
      outputColumns.push(newCol);
    }

    return { version: (input.version ?? 0) + 1, columns: outputColumns };
  }

  validateSchema(inputSchemas: PipelineSchema[]): SchemaValidationIssue[] {
    const input = inputSchemas[0];
    if (!input) return [];

    const issues: SchemaValidationIssue[] = [];

    for (const formula of this.formulas) {
      if (!formula.outputColumn) {
        issues.push({
          severity: SchemaValidationSeverity.Error,
          message: 'Formula output column name is required.',
          nodeId: this.nodeId,
        });
        continue;
      }

      if (!formula.expression) {
        issues.push({
          severity: SchemaValidationSeverity.Error,
          message: `Formula "${formula.outputColumn}" has no expression.`,
          nodeId: this.nodeId,
          columnName: formula.outputColumn,
        });
        continue;
      }

      issues.push(
        ...schemaValidator.validateFormula(
          formula.expression,
          input,
          formula.outputColumn,
          this.nodeId,
        ),
      );
    }

    return issues;
  }
}
