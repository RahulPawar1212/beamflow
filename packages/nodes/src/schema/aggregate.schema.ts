/**
 * Aggregate schema node (`beamflow:aggregate`).
 *
 * An Aggregate node groups rows and computes aggregation functions.
 * Its output schema has fewer columns than the input:
 *   - One column per group-by key
 *   - One column per aggregation result
 *
 * Design-time behaviour:
 * - Output schema = group-by columns + aggregated result columns
 * - Infers output type from the aggregation function (SUM → DOUBLE, COUNT → INTEGER, etc.)
 * - Validates that group-by and aggregation columns exist in input
 * - Validates that numeric aggregations are not applied to string columns
 *
 * Settings shape expected:
 * {
 *   groupByColumns: string[],
 *   aggregations: Array<{
 *     column: string;         // input column to aggregate
 *     func: string;           // SUM | AVG | MIN | MAX | COUNT | COUNT_DISTINCT | FIRST | LAST
 *     outputName: string;     // name of the output column
 *     nullable?: boolean;
 *   }>
 * }
 *
 * No Apache Beam calls are made.
 */

import type { ISchemaNode, PipelineSchema, ColumnSchema, SchemaValidationIssue } from '@beamflow/schema';
import { emptySchema, ColumnDataType, schemaValidator, isNumericType } from '@beamflow/schema';

export interface AggregationDef {
  column: string;
  func: string;
  outputName: string;
  nullable?: boolean;
}

/** Infer the output type for a given aggregation function + input column type. */
function inferAggregationOutputType(
  func: string,
  inputType: ColumnDataType,
): ColumnDataType {
  switch (func.toUpperCase()) {
    case 'COUNT':
    case 'COUNT_DISTINCT':
      return ColumnDataType.INTEGER;
    case 'SUM':
      return isNumericType(inputType) ? inputType : ColumnDataType.DOUBLE;
    case 'AVG':
      return ColumnDataType.DOUBLE;
    case 'MIN':
    case 'MAX':
    case 'FIRST':
    case 'LAST':
      return inputType; // preserves input column type
    default:
      return ColumnDataType.STRING;
  }
}

export class AggregateSchemaNode implements ISchemaNode {
  readonly nodeId: string;
  private readonly groupByColumns: string[];
  private readonly aggregations: AggregationDef[];

  constructor(nodeId: string, settings: Record<string, unknown>) {
    this.nodeId = nodeId;
    this.groupByColumns = (settings.groupByColumns as string[] | undefined) ?? [];
    this.aggregations = (settings.aggregations as AggregationDef[] | undefined) ?? [];
  }

  getOutputSchema(inputSchemas: PipelineSchema[]): PipelineSchema {
    const input = inputSchemas[0];
    if (!input || input.columns.length === 0) return emptySchema();

    const columnsByName = new Map(
      input.columns.map((c) => [c.name.toLowerCase(), c]),
    );

    const outputColumns: ColumnSchema[] = [];

    // 1. Group-by columns are passed through unchanged
    for (const colName of this.groupByColumns) {
      const col = columnsByName.get(colName.toLowerCase());
      if (col) {
        outputColumns.push(col);
      }
    }

    // 2. Aggregation result columns
    for (const agg of this.aggregations) {
      if (!agg.outputName) continue;

      const sourceCol = columnsByName.get(agg.column.toLowerCase());
      const sourceType = sourceCol?.type ?? ColumnDataType.STRING;
      const outputType = inferAggregationOutputType(agg.func, sourceType);

      const newCol: ColumnSchema = {
        id: `${this.nodeId}:${agg.outputName}`,
        name: agg.outputName,
        type: outputType,
        nullable: agg.nullable ?? false,
        sourceNodeId: this.nodeId,
        sourceColumn: agg.column,
        // Aggregation derives from the input column
        derivedFrom: sourceCol ? [sourceCol.id] : [],
        description: `${agg.func}(${agg.column})`,
      };
      outputColumns.push(newCol);
    }

    return { version: input.version + 1, columns: outputColumns };
  }

  validateSchema(inputSchemas: PipelineSchema[]): SchemaValidationIssue[] {
    const input = inputSchemas[0];
    if (!input) return [];
    return schemaValidator.validateAggregate(
      input,
      this.groupByColumns,
      this.aggregations.map((a) => ({ column: a.column, func: a.func, outputName: a.outputName })),
      this.nodeId,
    );
  }
}
