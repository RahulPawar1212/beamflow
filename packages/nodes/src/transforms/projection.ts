/**
 * Projection transform node (`beamflow:projection`).
 *
 * Builds a new record containing a chosen subset of columns, optionally
 * renamed, plus literal constant columns. Output column order follows the
 * declared selections. Anything not listed is dropped.
 *
 * Example (from a survey CSI flow — illustrative only):
 *   QuestionId              (rename/keep)
 *   Weight     = Count      (rename Count → Weight)
 *   Value      = CSI        (rename CSI → Value)
 *   TargetGroupId = Key     (rename)
 *
 * - Category: Transform (subcategory: Shaping)
 * - Ports:    in → Input, out → Output
 * - Settings: selections — list of { outputName, sourceColumn, constant }
 * - Emits IR: { operation: 'Projection', stepType: Transform }; no imports.
 *
 * Design-time output schema comes from `SelectSchemaNode`, which understands
 * the `selections` shape (rename + constant).
 */

import { NodeCategory, IRStepType } from '@beamflow/shared';
import {
  defineNode,
  inputPort,
  outputPort,
  listSetting,
  requiredError,
} from '../helpers.js';

interface SelectionRow {
  outputName?: string;
  sourceColumn?: string;
  constant?: string;
}

export const projection = defineNode({
  type: 'beamflow:projection',
  name: 'Projection',
  description:
    'Select, reorder, and rename columns into a new record. Optionally assign literal constant values.',
  category: NodeCategory.Transform,
  subcategory: 'Shaping',
  icon: 'columns',
  tags: ['projection', 'select', 'rename', 'columns', 'map', 'transform'],

  ports: [
    inputPort('in', 'Input'),
    outputPort('out', 'Output'),
  ],

  settings: [
    listSetting(
      'selections',
      'Output Columns',
      [
        { key: 'outputName', label: 'Output Name', type: 'text', placeholder: 'Weight' },
        { key: 'sourceColumn', label: 'Source Column', type: 'column', placeholder: 'Count' },
        { key: 'constant', label: 'Constant', type: 'text', placeholder: '(optional literal)' },
      ],
      {
        description:
          'Each row is one output column. Set a Source Column to keep/rename it, or leave it empty and set a Constant for a literal value.',
        group: 'Projection',
        order: 1,
      },
    ),
  ],

  validate(settings) {
    const issues = [];
    const selections = (settings.selections as SelectionRow[] | undefined) ?? [];
    if (selections.length === 0) {
      issues.push(requiredError('selections', 'Add at least one output column.'));
    }
    selections.forEach((s, i) => {
      if (!s.outputName || s.outputName.trim() === '') {
        issues.push(requiredError('selections', `Output column #${i + 1} needs an output name.`));
      }
      const hasSource = s.sourceColumn && s.sourceColumn.trim() !== '';
      const hasConstant = s.constant !== undefined && s.constant !== '';
      if (!hasSource && !hasConstant) {
        issues.push(
          requiredError('selections', `Output column #${i + 1} needs a source column or a constant.`),
        );
      }
    });
    return issues;
  },

  toIR(settings) {
    const selections = ((settings.selections as SelectionRow[] | undefined) ?? [])
      .filter((s) => s.outputName)
      .map((s) => {
        const row: { outputName: string; sourceColumn: string; constant?: string } = {
          outputName: (s.outputName as string).trim(),
          sourceColumn: (s.sourceColumn || '').trim(),
        };
        if ((!row.sourceColumn) && s.constant !== undefined && s.constant !== '') {
          row.constant = s.constant;
        }
        return row;
      });

    return {
      operation: 'Projection',
      stepType: IRStepType.Transform,
      params: { selections },
      imports: [],
    };
  },
});
