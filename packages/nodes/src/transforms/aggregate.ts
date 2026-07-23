/**
 * Aggregate transform node (`beamflow:aggregate`).
 *
 * Groups records by one or more key columns and computes MULTIPLE aggregation
 * functions at once, emitting ONE output record per group. The output record
 * is a dict containing the group-by columns plus one column per aggregation
 * (SUM / AVG / MIN / MAX / COUNT / COUNT_DISTINCT / FIRST / LAST).
 *
 * This is richer than `beamflow:group-by` (which produces a single
 * (key, value) reduction). Use this when a group needs several results
 * side-by-side, e.g. SUM(x), COUNT(*), FIRST(id) together.
 *
 * - Category: Transform (subcategory: Aggregation)
 * - Ports:    in → Input, out → Aggregated
 * - Settings: groupByColumns (comma-separated → array),
 *             aggregations — list of { column, func, outputName }
 * - Emits IR: { operation: 'Aggregate', stepType: Combine };
 *             imports `apache_beam as beam` (GroupByKey lives on beam).
 *
 * Design-time output schema comes from `AggregateSchemaNode`.
 */

import { NodeCategory, IRStepType } from '@beamflow/shared';
import {
  defineNode,
  inputPort,
  outputPort,
  textSetting,
  listSetting,
  requiredError,
} from '../helpers.js';

interface AggregationRow {
  column?: string;
  func?: string;
  outputName?: string;
}

const AGG_FUNCS = ['SUM', 'AVG', 'MIN', 'MAX', 'COUNT', 'COUNT_DISTINCT', 'FIRST', 'LAST'];

export const aggregate = defineNode({
  type: 'beamflow:aggregate',
  name: 'Aggregate',
  description:
    'Group records by key columns and compute multiple aggregations (SUM, COUNT, FIRST, …) into one row per group.',
  category: NodeCategory.Transform,
  subcategory: 'Aggregation',
  icon: 'sigma',
  tags: ['aggregate', 'group', 'sum', 'count', 'first', 'combine', 'reduce'],

  ports: [
    inputPort('in', 'Input'),
    outputPort('out', 'Aggregated'),
  ],

  settings: [
    textSetting('groupByColumns', 'Group By Columns', {
      description: 'Comma-separated column names to group by. Leave empty to aggregate over all rows.',
      placeholder: 'TargetGroupId',
      group: 'Grouping',
      order: 1,
    }),
    listSetting(
      'aggregations',
      'Aggregations',
      [
        {
          key: 'func',
          label: 'Function',
          type: 'select',
          options: AGG_FUNCS.map((f) => ({ label: f, value: f })),
          defaultValue: 'SUM',
        },
        { key: 'column', label: 'Column', type: 'column', placeholder: 'Value ( * for COUNT )' },
        { key: 'outputName', label: 'Output Name', type: 'text', placeholder: 'SumValue' },
      ],
      {
        description:
          'Each row is one aggregation. Use COUNT with an empty column (or *) to count all rows in the group.',
        group: 'Aggregations',
        order: 2,
      },
    ),
  ],

  validate(settings) {
    const issues = [];
    const aggregations = (settings.aggregations as AggregationRow[] | undefined) ?? [];
    if (aggregations.length === 0) {
      issues.push(requiredError('aggregations', 'Add at least one aggregation.'));
    }
    aggregations.forEach((a, i) => {
      const func = (a.func || '').toUpperCase();
      if (!a.outputName || a.outputName.trim() === '') {
        issues.push(requiredError('aggregations', `Aggregation #${i + 1} needs an output name.`));
      }
      const countsAll = func === 'COUNT' && (!a.column || a.column.trim() === '' || a.column.trim() === '*');
      if (!countsAll && (!a.column || a.column.trim() === '')) {
        issues.push(requiredError('aggregations', `Aggregation #${i + 1} (${func}) needs a column.`));
      }
    });
    return issues;
  },

  toIR(settings) {
    const groupByColumns = ((settings.groupByColumns as string) || '')
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);

    const aggregations = ((settings.aggregations as AggregationRow[] | undefined) ?? [])
      .filter((a) => a.outputName)
      .map((a) => ({
        column: (a.column || '').trim(),
        func: (a.func || 'SUM').toUpperCase(),
        outputName: (a.outputName as string).trim(),
      }));

    return {
      operation: 'Aggregate',
      stepType: IRStepType.Combine,
      params: { groupByColumns, aggregations },
      imports: ['apache_beam as beam'],
    };
  },
});
