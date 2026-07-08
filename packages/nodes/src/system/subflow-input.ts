/**
 * Subflow Input node (`system:subflow-input`).
 * Used inside a Subflow graph to represent data coming from the parent workflow.
 */

import { NodeCategory, IRStepType } from '@beamflow/shared';
import {
  defineNode,
  outputPort,
  textSetting,
} from '../helpers.js';

export const subflowInputNode = defineNode({
  type: 'system:subflow-input',
  name: 'Subflow Input',
  description: 'Receives data from the parent workflow into this subflow.',
  category: NodeCategory.Source, // It acts as a source within the subflow
  icon: 'log-in', // A suitable icon for input
  tags: ['subflow', 'input', 'source'],

  ports: [
    outputPort('out', 'Data', { multiple: true }),
  ],

  settings: [
    textSetting('inputName', 'Input Name', {
      description: 'The name of this input port as seen on the parent Subflow node.',
      required: true,
      defaultValue: 'Input',
      group: 'General',
    }),
    textSetting('mockColumns', 'Mock Columns (for design)', {
      description: 'Comma-separated list of column names to simulate schema propagation while editing.',
      required: false,
      group: 'Design',
    }),
  ],

  validate(settings) {
    const issues = [];
    if (!settings.inputName) {
      issues.push({ severity: 'error' as any, message: 'Input Name is required.', settingKey: 'inputName' });
    }
    return issues;
  },

  toIR(settings, nodeId) {
    // The compiler maps this to the incoming data from the parent graph.
    return {
      operation: 'SubflowInput',
      stepType: IRStepType.Read,
      params: {
        inputName: settings.inputName,
      },
      imports: [],
    };
  },
});
