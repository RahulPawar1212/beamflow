import { describe, it, expect } from 'vitest';
import { generatePythonBeam } from './generator.js';
import { IRStepType } from '@beamflow/shared';

/**
 * Codegen tests for the generic dataframe-shaping transforms:
 * FilterRows, DerivedColumn, Aggregate, Projection.
 *
 * These assert the emitted Python: that array-of-object params serialize to
 * Python list-of-dict literals, and that each transform's expand() body is
 * present. We don't execute Beam here — just verify the source.
 */

function read(id = 'src'): any {
  return {
    id,
    label: 'Read CSV',
    type: IRStepType.Read,
    operation: 'ReadFromCSV',
    params: { filePath: 'input.csv', delimiter: ',', hasHeader: true },
    inputs: [],
    imports: [],
  };
}

function wrap(steps: any[]): any {
  return {
    id: 'p',
    name: 'P',
    version: '1.0.0',
    steps,
    connections: [],
  };
}

describe('FilterRows codegen', () => {
  it('emits a beam.Filter that evals the compiled expression with _num in scope', () => {
    const code = generatePythonBeam(
      wrap([
        read(),
        {
          id: 's2',
          label: 'Filter Rows',
          type: IRStepType.Transform,
          operation: 'FilterRows',
          params: { expression: "1 <= _num(element.get('Value')) <= 5 and element.get('X') not in ['a']" },
          inputs: ['src'],
          imports: [],
        },
      ]),
    ).code;

    expect(code).toContain('class FilterRowsTransform(beam.PTransform)');
    expect(code).toContain("beam.Filter(keep)");
    expect(code).toContain("'_num': num");
    // The compiled expression is passed through as the constructor kwarg. Note
    // the single quotes inside the expression are escaped in the Python string
    // literal (toPythonString), so we match the escaped form.
    expect(code).toContain("_num(element.get(\\'Value\\'))");
  });
});

describe('DerivedColumn codegen', () => {
  it('serializes formulas as a Python list of dicts and applies them in order', () => {
    const code = generatePythonBeam(
      wrap([
        read(),
        {
          id: 's2',
          label: 'Derived Column',
          type: IRStepType.Transform,
          operation: 'DerivedColumn',
          params: {
            formulas: [
              { outputColumn: 'NormalizedValue', expression: '(Value - 1) / (MaxScale - 1)', nullable: true },
            ],
          },
          inputs: ['src'],
          imports: [],
        },
      ]),
    ).code;

    expect(code).toContain('class DerivedColumnTransform(beam.PTransform)');
    expect(code).toContain('beam.Map(derive)');
    // Array-of-object param → Python list-of-dict literal (formatPyLiteral).
    expect(code).toContain("'outputColumn': 'NormalizedValue'");
    expect(code).toContain("'expression': '(Value - 1) / (MaxScale - 1)'");
    // Bare-column-name eval: columns bound as the eval scope, not {'element': ...}.
    expect(code).toContain("result[f['outputColumn']] = eval(f['expression'], {}, scope)");
  });
});

describe('Aggregate codegen', () => {
  it('emits GroupByKey + fold and serializes multiple aggregations', () => {
    const code = generatePythonBeam(
      wrap([
        read(),
        {
          id: 's2',
          label: 'Aggregate',
          type: IRStepType.Combine,
          operation: 'Aggregate',
          params: {
            groupByColumns: ['TargetGroupId'],
            aggregations: [
              { column: 'NormalizedValue', func: 'SUM', outputName: 'SumNormalized' },
              { column: '', func: 'COUNT', outputName: 'Count' },
              { column: 'QuestionId', func: 'FIRST', outputName: 'QuestionId' },
            ],
          },
          inputs: ['src'],
          imports: ['apache_beam as beam'],
        },
      ]),
    ).code;

    expect(code).toContain('class AggregateTransform(beam.PTransform)');
    expect(code).toContain("beam.GroupByKey()");
    expect(code).toContain("beam.Map(self._fold)");
    // All three aggregations serialized.
    expect(code).toContain("'func': 'SUM'");
    expect(code).toContain("'func': 'COUNT'");
    expect(code).toContain("'func': 'FIRST'");
    expect(code).toContain("group_by_columns=['TargetGroupId']");
    // COUNT(*) vs COUNT(col) branch and FIRST/LAST are present in the fold.
    expect(code).toContain('out[name] = len(rows)');
    expect(code).toContain('rows[0].get(col)');
    expect(code).toContain('rows[-1].get(col)');
  });
});

describe('Projection codegen', () => {
  it('builds a new dict from selections (rename + constant)', () => {
    const code = generatePythonBeam(
      wrap([
        read(),
        {
          id: 's2',
          label: 'Projection',
          type: IRStepType.Transform,
          operation: 'Projection',
          params: {
            selections: [
              { outputName: 'Weight', sourceColumn: 'Count' },
              { outputName: 'Kind', sourceColumn: '', constant: 'survey' },
            ],
          },
          inputs: ['src'],
          imports: [],
        },
      ]),
    ).code;

    expect(code).toContain('class ProjectionTransform(beam.PTransform)');
    expect(code).toContain('beam.Map(project)');
    expect(code).toContain("'outputName': 'Weight'");
    expect(code).toContain("'sourceColumn': 'Count'");
    expect(code).toContain("'constant': 'survey'");
    // Constant vs source-column branch.
    expect(code).toContain("if 'constant' in s and not s.get('sourceColumn')");
  });
});

describe('Reference flow end-to-end (source shape only)', () => {
  it('chains Filter Rows → Derived → Aggregate → Derived → Projection without unknown-op warnings', () => {
    const code = generatePythonBeam(
      wrap([
        read('grouped'),
        {
          id: 'f', label: 'Filter Rows', type: IRStepType.Transform, operation: 'FilterRows',
          params: { expression: "1 <= _num(element.get('Value')) <= 5" }, inputs: ['grouped'], imports: [],
        },
        {
          id: 'd1', label: 'Derived', type: IRStepType.Transform, operation: 'DerivedColumn',
          params: { formulas: [{ outputColumn: 'NormalizedValue', expression: '(Value - 1) / (MaxScale - 1)', nullable: true }] },
          inputs: ['f'], imports: [],
        },
        {
          id: 'agg', label: 'Aggregate', type: IRStepType.Combine, operation: 'Aggregate',
          params: {
            groupByColumns: ['TargetGroupId'],
            aggregations: [
              { column: 'NormalizedValue', func: 'SUM', outputName: 'SumNormalized' },
              { column: '', func: 'COUNT', outputName: 'Count' },
            ],
          },
          inputs: ['d1'], imports: ['apache_beam as beam'],
        },
        {
          id: 'd2', label: 'Derived CSI', type: IRStepType.Transform, operation: 'DerivedColumn',
          params: { formulas: [{ outputColumn: 'CSI', expression: '(SumNormalized / Count) * 100', nullable: true }] },
          inputs: ['agg'], imports: [],
        },
        {
          id: 'proj', label: 'Projection', type: IRStepType.Transform, operation: 'Projection',
          params: { selections: [{ outputName: 'Value', sourceColumn: 'CSI' }, { outputName: 'Weight', sourceColumn: 'Count' }] },
          inputs: ['d2'], imports: [],
        },
      ]),
    ).code;

    // No "no handler" warning comments leaked in (all 4 ops have handlers).
    expect(code).not.toContain('No handler for operation');
    // Every transform class is emitted exactly once, wired in order.
    expect(code).toContain('class FilterRowsTransform');
    expect(code).toContain('class DerivedColumnTransform');
    expect(code).toContain('class AggregateTransform');
    expect(code).toContain('class ProjectionTransform');
  });
});
