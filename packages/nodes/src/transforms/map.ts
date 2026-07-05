/**
 * Map transform node — applies a transformation expression to each record.
 */

import { NodeCategory, IRStepType } from '@beamflow/shared';
import {
  defineNode,
  inputPort,
  outputPort,
  textSetting,
  expressionSetting,
  requiredError,
} from '../helpers.js';

export const map = defineNode({
  type: 'beamflow:map',
  name: 'Map',
  description: 'Transform each record by applying an expression. Can add new fields or modify existing ones.',
  category: NodeCategory.Transform,
  icon: 'arrow-right-left',
  tags: ['map', 'transform', 'expression', 'modify', 'compute'],

  ports: [
    inputPort('in', 'Input'),
    outputPort('out', 'Mapped'),
  ],

  settings: [
    expressionSetting('expression', 'Expression', {
      description: 'Python expression to compute. Use "element" to reference the current record. Example: element.get("price", 0) * 1.1',
      placeholder: 'element.get("price", 0) * 1.1',
      required: true,
      group: 'Transform',
      order: 1,
    }),
    textSetting('outputField', 'Output Field', {
      description: 'Name of the field to store the result in. Leave empty to replace the entire record.',
      placeholder: 'price_with_tax',
      group: 'Transform',
      order: 2,
    }),
  ],

  validate(settings) {
    const issues = [];
    if (!settings.expression || (settings.expression as string).trim() === '') {
      issues.push(requiredError('expression', 'Expression is required.'));
    }
    return issues;
  },

  toIR(settings, nodeId) {
    return {
      operation: 'Map',
      stepType: IRStepType.Transform,
      params: {
        expression: settings.expression,
        outputField: settings.outputField || undefined,
      },
      imports: [],
    };
  },
});
