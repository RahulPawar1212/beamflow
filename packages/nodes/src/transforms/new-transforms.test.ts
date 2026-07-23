import { describe, it, expect } from 'vitest';
import { IRStepType, NodeCategory } from '@beamflow/shared';
import { ColumnDataType, type PipelineSchema } from '@beamflow/schema';
import { filterRows } from './filter-rows.js';
import { derivedColumn } from './derived-column.js';
import { aggregate } from './aggregate.js';
import { projection } from './projection.js';
import { FormulaSchemaNode } from '../schema/formula.schema.js';
import { AggregateSchemaNode } from '../schema/aggregate.schema.js';
import { SelectSchemaNode } from '../schema/select.schema.js';
import { FilterSchemaNode } from '../schema/filter.schema.js';

const inputSchema: PipelineSchema = {
  version: 1,
  columns: [
    { id: 'c1', name: 'Value', type: ColumnDataType.DOUBLE, nullable: false, sourceNodeId: 'src' },
    { id: 'c2', name: 'MaxScale', type: ColumnDataType.INTEGER, nullable: false, sourceNodeId: 'src' },
    { id: 'c3', name: 'QuestionId', type: ColumnDataType.STRING, nullable: false, sourceNodeId: 'src' },
    { id: 'c4', name: 'TargetGroupId', type: ColumnDataType.STRING, nullable: false, sourceNodeId: 'src' },
  ],
};

describe('filter-rows node', () => {
  it('has the expected identity, subcategory and ports', () => {
    expect(filterRows.type).toBe('beamflow:filter-rows');
    expect(filterRows.category).toBe(NodeCategory.Transform);
    expect(filterRows.subcategory).toBe('Filtering');
    expect(filterRows.ports.map((p) => p.direction)).toEqual(['input', 'output']);
  });

  it('compiles a between + not-in condition set into one AND expression', () => {
    const ir = filterRows.toIR(
      {
        combine: 'AND',
        conditions: [
          { column: 'Value', operator: 'between', value: '1', value2: 'MaxScale' },
          { column: 'Value', operator: 'not_in', value: '2, 3' },
        ],
      },
      'n',
    );
    expect(ir.operation).toBe('FilterRows');
    expect(ir.stepType).toBe(IRStepType.Transform);
    const expr = ir.params.expression as string;
    // between → lower <= _num(col) <= upper, where a non-numeric bound
    // (MaxScale) resolves to a numeric-coerced COLUMN reference, not a string.
    expect(expr).toContain("1 <= _num(element.get('Value')) <= _num(element.get('MaxScale'))");
    // not_in → membership over a python list
    expect(expr).toContain("element.get('Value') not in [2, 3]");
    expect(expr).toContain(' and ');
  });

  it('joins with OR when combine=OR and defaults empty conditions to True', () => {
    const orIr = filterRows.toIR(
      { combine: 'OR', conditions: [{ column: 'a', operator: '==', value: '1' }, { column: 'b', operator: '==', value: '2' }] },
      'n',
    );
    expect(orIr.params.expression).toContain(' or ');
    const emptyIr = filterRows.toIR({ conditions: [] }, 'n');
    expect(emptyIr.params.expression).toBe('True');
  });

  it('is schema-preserving (FilterSchemaNode passes columns through)', () => {
    const node = new FilterSchemaNode('n', {});
    const out = node.getOutputSchema([inputSchema]);
    expect(out.columns.map((c) => c.name)).toEqual(['Value', 'MaxScale', 'QuestionId', 'TargetGroupId']);
  });
});

describe('derived-column node', () => {
  it('maps formulas straight into IR params, trimming and defaulting nullable', () => {
    const ir = derivedColumn.toIR(
      { formulas: [{ outputColumn: ' NormalizedValue ', expression: ' (Value - 1) / (MaxScale - 1) ' }] },
      'n',
    );
    expect(ir.operation).toBe('DerivedColumn');
    expect(ir.params.formulas).toEqual([
      { outputColumn: 'NormalizedValue', expression: '(Value - 1) / (MaxScale - 1)', nullable: true },
    ]);
  });

  it('validates that each formula has an output column and expression', () => {
    const issues = derivedColumn.validate({ formulas: [{ outputColumn: '', expression: 'x' }] });
    expect(issues.length).toBeGreaterThan(0);
  });

  it('adds new columns to the input schema (FormulaSchemaNode)', () => {
    const node = new FormulaSchemaNode('n', {
      formulas: [{ outputColumn: 'NormalizedValue', expression: '(Value - 1) / (MaxScale - 1)' }],
    });
    const out = node.getOutputSchema([inputSchema]);
    // keeps all input columns and appends the derived one
    expect(out.columns.map((c) => c.name)).toContain('Value');
    expect(out.columns.map((c) => c.name)).toContain('NormalizedValue');
    expect(out.columns.length).toBe(inputSchema.columns.length + 1);
  });
});

describe('aggregate node', () => {
  it('splits groupByColumns and normalizes aggregation funcs to upper-case', () => {
    const ir = aggregate.toIR(
      {
        groupByColumns: 'TargetGroupId, QuestionId',
        aggregations: [
          { column: 'NormalizedValue', func: 'sum', outputName: 'SumNormalized' },
          { column: '', func: 'count', outputName: 'Count' },
          { column: 'QuestionId', func: 'first', outputName: 'QuestionId' },
        ],
      },
      'n',
    );
    expect(ir.operation).toBe('Aggregate');
    expect(ir.stepType).toBe(IRStepType.Combine);
    expect(ir.params.groupByColumns).toEqual(['TargetGroupId', 'QuestionId']);
    expect(ir.params.aggregations).toEqual([
      { column: 'NormalizedValue', func: 'SUM', outputName: 'SumNormalized' },
      { column: '', func: 'COUNT', outputName: 'Count' },
      { column: 'QuestionId', func: 'FIRST', outputName: 'QuestionId' },
    ]);
    expect(ir.imports).toContain('apache_beam as beam');
  });

  it('allows COUNT with no column but requires a column for SUM', () => {
    const ok = aggregate.validate({ aggregations: [{ func: 'COUNT', outputName: 'n', column: '' }] });
    expect(ok).toEqual([]);
    const bad = aggregate.validate({ aggregations: [{ func: 'SUM', outputName: 's', column: '' }] });
    expect(bad.length).toBeGreaterThan(0);
  });

  it('produces group keys + one column per aggregation (AggregateSchemaNode)', () => {
    const node = new AggregateSchemaNode('n', {
      groupByColumns: ['TargetGroupId'],
      aggregations: [
        { column: 'Value', func: 'SUM', outputName: 'SumValue' },
        { column: '', func: 'COUNT', outputName: 'Count' },
        { column: 'QuestionId', func: 'FIRST', outputName: 'QuestionId' },
      ],
    });
    const out = node.getOutputSchema([inputSchema]);
    expect(out.columns.map((c) => c.name)).toEqual(['TargetGroupId', 'SumValue', 'Count', 'QuestionId']);
    // COUNT is integer, SUM preserves numeric, FIRST preserves source type
    const byName = new Map(out.columns.map((c) => [c.name, c]));
    expect(byName.get('Count')!.type).toBe(ColumnDataType.INTEGER);
    expect(byName.get('QuestionId')!.type).toBe(ColumnDataType.STRING);
  });
});

describe('projection node', () => {
  it('keeps source-backed selections and attaches constants only when no source', () => {
    const ir = projection.toIR(
      {
        selections: [
          { outputName: 'Weight', sourceColumn: 'Count' },
          { outputName: 'Kind', sourceColumn: '', constant: 'survey' },
          { outputName: 'Ignored' }, // no source, no constant → dropped
        ],
      },
      'n',
    );
    expect(ir.operation).toBe('Projection');
    expect(ir.params.selections).toEqual([
      { outputName: 'Weight', sourceColumn: 'Count' },
      { outputName: 'Kind', sourceColumn: '', constant: 'survey' },
      { outputName: 'Ignored', sourceColumn: '' },
    ]);
  });

  it('renames/forwards source columns and adds constant columns (SelectSchemaNode)', () => {
    const node = new SelectSchemaNode('n', {
      selections: [
        { outputName: 'Value', sourceColumn: 'QuestionId' },
        { outputName: 'Kind', constant: 'survey' },
      ],
    });
    const out = node.getOutputSchema([inputSchema]);
    expect(out.columns.map((c) => c.name)).toEqual(['Value', 'Kind']);
    // renamed source keeps its original type; constant is a fresh STRING column
    const byName = new Map(out.columns.map((c) => [c.name, c]));
    expect(byName.get('Value')!.type).toBe(ColumnDataType.STRING); // QuestionId was STRING
    expect(byName.get('Kind')!.type).toBe(ColumnDataType.STRING);
  });
});
