/**
 * Derived Column transform node (`beamflow:derived-column`).
 *
 * Adds one or more computed columns to each record while keeping all input
 * columns. Each formula is an expression written with **bare column names**
 * (e.g. `(Value - 1) / (MaxScale - 1)`); columns are bound as locals when the
 * expression is evaluated. Formulas are applied in order, so a later formula
 * can reference a column derived by an earlier one.
 *
 * - Category: Transform (subcategory: Shaping)
 * - Ports:    in → Input, out → Output
 * - Settings: formulas — a list of { outputColumn, expression, nullable }
 * - Emits IR: { operation: 'DerivedColumn', stepType: Transform }; no imports.
 *
 * The design-time output schema is produced by `FormulaSchemaNode`
 * (`beamflow:formula`); see the schema registration mapping.
 */

import { NodeCategory, IRStepType } from '@beamflow/shared';
import {
  defineNode,
  inputPort,
  outputPort,
  listSetting,
  requiredError,
} from '../helpers.js';

interface FormulaRow {
  outputColumn?: string;
  expression?: string;
  nullable?: boolean;
}

export const derivedColumn = defineNode({
  type: 'beamflow:derived-column',
  name: 'Derived Column',
  description:
    'Add one or more computed columns to each record. Expressions use bare column names, e.g. (Value - 1) / (MaxScale - 1).',
  category: NodeCategory.Transform,
  subcategory: 'Shaping',
  icon: 'calculator',
  tags: ['derive', 'compute', 'formula', 'column', 'expression', 'map', 'transform'],

  ports: [
    inputPort('in', 'Input'),
    outputPort('out', 'Output'),
  ],

  settings: [
    listSetting(
      'formulas',
      'Computed Columns',
      [
        { key: 'outputColumn', label: 'Output Column', type: 'text', placeholder: 'NormalizedValue' },
        { key: 'expression', label: 'Expression', type: 'text', placeholder: '(Value - 1) / (MaxScale - 1)' },
        { key: 'nullable', label: 'Nullable', type: 'boolean', defaultValue: true },
      ],
      {
        description:
          'Each row adds a new column. Reference existing columns by bare name; later formulas can use columns derived above.',
        group: 'Formulas',
        order: 1,
      },
    ),
  ],

  validate(settings) {
    const issues = [];
    const formulas = (settings.formulas as FormulaRow[] | undefined) ?? [];
    if (formulas.length === 0) {
      issues.push(requiredError('formulas', 'Add at least one computed column.'));
    }
    formulas.forEach((f, i) => {
      if (!f.outputColumn || f.outputColumn.trim() === '') {
        issues.push(requiredError('formulas', `Computed column #${i + 1} needs an output column name.`));
      }
      if (!f.expression || f.expression.trim() === '') {
        issues.push(requiredError('formulas', `Computed column #${i + 1} needs an expression.`));
      }
    });
    return issues;
  },

  toIR(settings) {
    const formulas = ((settings.formulas as FormulaRow[] | undefined) ?? [])
      .filter((f) => f.outputColumn && f.expression)
      .map((f) => ({
        outputColumn: (f.outputColumn as string).trim(),
        expression: (f.expression as string).trim(),
        nullable: f.nullable ?? true,
      }));

    return {
      operation: 'DerivedColumn',
      stepType: IRStepType.Transform,
      params: { formulas },
      imports: [],
    };
  },
});
