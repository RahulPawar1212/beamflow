/**
 * Filter Rows transform node (`beamflow:filter-rows`).
 *
 * Keeps records that satisfy a set of conditions combined with AND / OR.
 * Unlike `beamflow:filter` (a single field/operator/value), this supports
 * several conditions at once, including range ("between") and membership
 * ("in list" / "not in list") checks — e.g.
 *   Value between 1 and MaxScale  AND  Value not in [Exclude…].
 *
 * `toIR` compiles the structured conditions down to ONE Python boolean
 * expression evaluated over `element` (the row dict), which the code
 * generator drops into a `beam.Filter`. Keeping the compiled expression in
 * IR keeps the emitted transform trivial and open-ended.
 *
 * - Category: Transform (subcategory: Filtering)
 * - Ports:    in → Input, out → Filtered
 * - Settings: combine (AND | OR), conditions — list of
 *             { column, operator, value, value2 }
 * - Emits IR: { operation: 'FilterRows', stepType: Transform,
 *               params: { expression } }; no imports.
 *
 * Schema-preserving: the design-time output schema equals the input schema
 * (mapped to `FilterSchemaNode`).
 */

import { NodeCategory, IRStepType } from '@beamflow/shared';
import {
  defineNode,
  inputPort,
  outputPort,
  selectSetting,
  listSetting,
  requiredError,
} from '../helpers.js';

interface ConditionRow {
  column?: string;
  operator?: string;
  value?: string;
  value2?: string;
}

const OPERATORS = [
  { label: 'Equals (==)', value: '==' },
  { label: 'Not Equals (!=)', value: '!=' },
  { label: 'Greater Than (>)', value: '>' },
  { label: 'Less Than (<)', value: '<' },
  { label: 'Greater or Equal (>=)', value: '>=' },
  { label: 'Less or Equal (<=)', value: '<=' },
  { label: 'Between (inclusive)', value: 'between' },
  { label: 'In List', value: 'in' },
  { label: 'Not In List', value: 'not_in' },
  { label: 'Contains', value: 'contains' },
  { label: 'Is Null / Empty', value: 'is_null' },
  { label: 'Is Not Null / Empty', value: 'is_not_null' },
];

/** Python source for reading a column, numeric-coerced where it helps comparisons. */
function accessNum(column: string): string {
  // _num(element.get('col')) — _num is emitted as a module-level helper by the generator.
  return `_num(element.get(${py(column)}))`;
}
function accessRaw(column: string): string {
  return `element.get(${py(column)})`;
}

/** Escape a value as a Python string literal. */
function py(value: string): string {
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** Render one right-hand-side value: numeric if it looks numeric, else a string literal. */
function pyValue(raw: string): string {
  const t = raw.trim();
  if (t !== '' && !Number.isNaN(Number(t))) return t; // numeric literal
  return py(t);
}

/**
 * Render a right-hand operand for a NUMERIC comparison (between / < / > / …).
 * A numeric literal stays a number; anything else is treated as a COLUMN
 * reference (numeric-coerced), so bounds like "Value between 1 and MaxScale"
 * compare against the row's MaxScale column rather than the string 'MaxScale'.
 */
function pyNumericOperand(raw: string): string {
  const t = raw.trim();
  if (t !== '' && !Number.isNaN(Number(t))) return t; // numeric literal
  if (t === '') return "''";
  return accessNum(t); // column reference
}

/** Parse a comma-separated list into a Python list literal, numeric where possible. */
function pyList(raw: string): string {
  const items = String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
  return `[${items.map(pyValue).join(', ')}]`;
}

/** Compile one condition row to a Python boolean sub-expression. */
function compileCondition(c: ConditionRow): string | null {
  const column = (c.column || '').trim();
  const op = c.operator || '==';
  if (!column) return null;

  switch (op) {
    case 'is_null':
      return `(${accessRaw(column)} in (None, ''))`;
    case 'is_not_null':
      return `(${accessRaw(column)} not in (None, ''))`;
    case 'between': {
      const lo = pyNumericOperand(c.value ?? '');
      const hi = pyNumericOperand(c.value2 ?? '');
      return `(${lo} <= ${accessNum(column)} <= ${hi})`;
    }
    case 'in':
      return `(${accessRaw(column)} in ${pyList(c.value ?? '')})`;
    case 'not_in':
      return `(${accessRaw(column)} not in ${pyList(c.value ?? '')})`;
    case 'contains':
      return `(${pyValue(c.value ?? '')} in str(${accessRaw(column)}))`;
    case '==':
    case '!=':
      return `(${accessRaw(column)} ${op} ${pyValue(c.value ?? '')})`;
    case '>':
    case '<':
    case '>=':
    case '<=':
      return `(${accessNum(column)} ${op} ${pyNumericOperand(c.value ?? '')})`;
    default:
      return null;
  }
}

export const filterRows = defineNode({
  type: 'beamflow:filter-rows',
  name: 'Filter Rows',
  description:
    'Keep records matching several conditions combined with AND/OR. Supports range (between) and in-list / not-in-list checks.',
  category: NodeCategory.Transform,
  subcategory: 'Filtering',
  icon: 'filter',
  tags: ['filter', 'where', 'condition', 'between', 'in', 'range', 'transform'],

  ports: [
    inputPort('in', 'Input'),
    outputPort('out', 'Filtered'),
  ],

  settings: [
    selectSetting('combine', 'Combine With', [
      { label: 'AND (all must match)', value: 'AND' },
      { label: 'OR (any may match)', value: 'OR' },
    ], {
      description: 'How multiple conditions are combined.',
      defaultValue: 'AND',
      group: 'Conditions',
      order: 1,
    }),
    listSetting(
      'conditions',
      'Conditions',
      [
        { key: 'column', label: 'Column', type: 'column', placeholder: 'Value' },
        { key: 'operator', label: 'Operator', type: 'select', options: OPERATORS, defaultValue: '==' },
        { key: 'value', label: 'Value', type: 'text', placeholder: '1  (or comma list for In)' },
        { key: 'value2', label: 'Value 2', type: 'text', placeholder: 'upper bound (Between)' },
      ],
      {
        description:
          'Each row is one condition. For Between, use Value (lower) and Value 2 (upper). For In/Not In, put a comma-separated list in Value.',
        group: 'Conditions',
        order: 2,
      },
    ),
  ],

  validate(settings) {
    const issues = [];
    const conditions = (settings.conditions as ConditionRow[] | undefined) ?? [];
    if (conditions.length === 0) {
      issues.push(requiredError('conditions', 'Add at least one condition.'));
    }
    conditions.forEach((c, i) => {
      if (!c.column || c.column.trim() === '') {
        issues.push(requiredError('conditions', `Condition #${i + 1} needs a column.`));
      }
      const op = c.operator || '==';
      const noValueOps = ['is_null', 'is_not_null'];
      if (!noValueOps.includes(op) && (c.value === undefined || c.value === '')) {
        issues.push(requiredError('conditions', `Condition #${i + 1} needs a value.`));
      }
      if (op === 'between' && (c.value2 === undefined || c.value2 === '')) {
        issues.push(requiredError('conditions', `Condition #${i + 1} (Between) needs an upper bound.`));
      }
    });
    return issues;
  },

  toIR(settings) {
    const conditions = (settings.conditions as ConditionRow[] | undefined) ?? [];
    const combine = (settings.combine as string) === 'OR' ? ' or ' : ' and ';

    const parts = conditions
      .map(compileCondition)
      .filter((p): p is string => p !== null);

    // Empty condition set → keep everything.
    const expression = parts.length > 0 ? parts.join(combine) : 'True';

    return {
      operation: 'FilterRows',
      stepType: IRStepType.Transform,
      params: { expression },
      imports: [],
    };
  },
});
