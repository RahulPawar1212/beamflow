/**
 * GroupBy transform node (`beamflow:group-by`).
 *
 * Groups records by one or more key fields and applies an aggregation.
 *
 * - Category: Transform
 * - Ports:    in → Input, out → Grouped
 * - Settings: keyFields (required, comma-separated → split to array in IR),
 *             aggregation (count|sum|avg|min|max), aggregateField
 *             (required for non-count aggregations)
 * - Emits IR: { operation: 'GroupBy', stepType: Combine };
 *             imports `apache_beam.transforms.combiners`.
 */

import { NodeCategory, IRStepType } from '@beamflow/shared';
import {
  defineNode,
  inputPort,
  outputPort,
  textSetting,
  selectSetting,
  requiredError,
} from '../helpers.js';

export const groupBy = defineNode({
  type: 'beamflow:group-by',
  name: 'Group By',
  description: 'Group records by one or more key fields and apply an aggregation function.',
  category: NodeCategory.Transform,
  icon: 'group',
  tags: ['group', 'aggregate', 'combine', 'count', 'sum', 'avg'],

  ports: [
    inputPort('in', 'Input'),
    outputPort('out', 'Grouped'),
  ],

  settings: [
    textSetting('keyFields', 'Key Fields', {
      description: 'Comma-separated field names to group by.',
      placeholder: 'department, role',
      required: true,
      group: 'Grouping',
      order: 1,
    }),
    selectSetting('aggregation', 'Aggregation', [
      { label: 'Count', value: 'count' },
      { label: 'Sum', value: 'sum' },
      { label: 'Average', value: 'avg' },
      { label: 'Min', value: 'min' },
      { label: 'Max', value: 'max' },
    ], {
      description: 'Aggregation function to apply.',
      defaultValue: 'count',
      group: 'Grouping',
      order: 2,
    }),
    textSetting('aggregateField', 'Aggregate Field', {
      description: 'The field to aggregate (required for sum, avg, min, max).',
      placeholder: 'salary',
      group: 'Grouping',
      order: 3,
    }),
  ],

  validate(settings) {
    const issues = [];
    if (!settings.keyFields || (settings.keyFields as string).trim() === '') {
      issues.push(requiredError('keyFields', 'At least one key field is required.'));
    }
    const agg = settings.aggregation as string;
    if (agg && agg !== 'count' && (!settings.aggregateField || (settings.aggregateField as string).trim() === '')) {
      issues.push(
        requiredError('aggregateField', `Aggregate field is required for "${agg}" aggregation.`),
      );
    }
    return issues;
  },

  toIR(settings, nodeId) {
    const keyFieldsStr = settings.keyFields as string || '';
    const keyFields = keyFieldsStr.split(',').map((f: string) => f.trim()).filter(Boolean);

    return {
      operation: 'GroupBy',
      stepType: IRStepType.Combine,
      params: {
        keyFields,
        aggregation: settings.aggregation || 'count',
        aggregateField: settings.aggregateField || undefined,
      },
      imports: ['apache_beam.transforms.combiners'],
    };
  },
});
