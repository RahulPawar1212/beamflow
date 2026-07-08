/**
 * Subflow Output node (`system:subflow-output`).
 * Used inside a Subflow graph to represent data returning to the parent workflow.
 */

import { NodeCategory, IRStepType } from '@beamflow/shared';
import {
  defineNode,
  inputPort,
  textSetting,
} from '../helpers.js';

export const subflowOutputNode = defineNode({
  type: 'system:subflow-output',
  name: 'Subflow Output',
  description: 'Sends data from this subflow back to the parent workflow.',
  category: NodeCategory.Output, // It acts as a sink within the subflow
  icon: 'log-out', // A suitable icon for output
  tags: ['subflow', 'output', 'sink'],

  ports: [
    inputPort('in', 'Data', { multiple: true }),
  ],

  settings: [
    textSetting('outputName', 'Output Name', {
      description: 'The name of this output port as seen on the parent Subflow node.',
      required: true,
      defaultValue: 'Output',
      group: 'General',
    }),
  ],

  validate(settings) {
    const issues = [];
    if (!settings.outputName) {
      issues.push({ severity: 'error' as any, message: 'Output Name is required.', settingKey: 'outputName' });
    }
    return issues;
  },

  toIR(settings, nodeId) {
    // The compiler maps this to the outgoing data to the parent graph.
    return {
      operation: 'SubflowOutput',
      stepType: IRStepType.Write,
      params: {
        outputName: settings.outputName,
      },
      imports: [],
    };
  },
});
