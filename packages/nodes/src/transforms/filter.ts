/**
 * Filter transform node — filters records based on a field condition.
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

export const filter = defineNode({
  type: 'beamflow:filter',
  name: 'Filter',
  description: 'Filter records based on a field value condition. Only matching records pass through.',
  category: NodeCategory.Transform,
  icon: 'filter',
  tags: ['filter', 'where', 'condition', 'transform'],

  ports: [
    inputPort('in', 'Input'),
    outputPort('out', 'Filtered'),
  ],

  settings: [
    textSetting('field', 'Field Name', {
      description: 'The field/column to filter on.',
      placeholder: 'age',
      required: true,
      group: 'Condition',
      order: 1,
    }),
    selectSetting('operator', 'Operator', [
      { label: 'Equals (==)', value: '==' },
      { label: 'Not Equals (!=)', value: '!=' },
      { label: 'Greater Than (>)', value: '>' },
      { label: 'Less Than (<)', value: '<' },
      { label: 'Greater or Equal (>=)', value: '>=' },
      { label: 'Less or Equal (<=)', value: '<=' },
      { label: 'Contains', value: 'contains' },
      { label: 'Regex Match', value: 'regex' },
      { label: 'Is Null / Empty', value: 'is_null' },
    ], {
      description: 'Comparison operator.',
      defaultValue: '==',
      group: 'Condition',
      order: 2,
    }),
    textSetting('value', 'Value', {
      description: 'The value to compare against.',
      placeholder: '18',
      group: 'Condition',
      order: 3,
    }),
  ],

  validate(settings) {
    const issues = [];
    if (!settings.field || (settings.field as string).trim() === '') {
      issues.push(requiredError('field', 'Field name is required.'));
    }
    const op = settings.operator as string;
    if (op !== 'is_null' && (!settings.value && settings.value !== 0)) {
      issues.push(requiredError('value', 'Comparison value is required (except for "Is Null" operator).'));
    }
    return issues;
  },

  toIR(settings, nodeId) {
    return {
      operation: 'Filter',
      stepType: IRStepType.Transform,
      params: {
        field: settings.field,
        operator: settings.operator || '==',
        value: settings.value,
      },
      imports: [],
    };
  },
});
