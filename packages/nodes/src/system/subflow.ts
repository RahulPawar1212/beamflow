/**
 * Subflow node (`system:subflow`).
 * Represents a reusable nested workflow.
 */

import { NodeCategory, IRStepType } from '@beamflow/shared';
import {
  defineNode,
  inputPort,
  outputPort,
  textSetting,
} from '../helpers.js';

export const subflowNode = defineNode({
  type: 'system:subflow',
  name: 'Subflow',
  description: 'A reusable nested workflow containing its own logic.',
  category: NodeCategory.Custom, // Or a new System category
  icon: 'boxes', // Folder-like or pipeline icon
  tags: ['subflow', 'nested', 'reusable', 'group'],

  ports: [
    inputPort('in', 'Input', { multiple: true }),
    outputPort('out', 'Output', { multiple: true }),
  ],

  settings: [
    textSetting('subflowId', 'Subflow ID', {
      description: 'The ID of the target workflow this subflow references.',
      required: true,
      fixed: true,
      group: 'Internal',
    }),
  ],

  validate(settings) {
    const issues = [];
    if (!settings.subflowId) {
      issues.push({ severity: 'error' as any, message: 'Subflow ID is required.', settingKey: 'subflowId' });
    }
    return issues;
  },

  toIR(settings, nodeId) {
    // The actual compiler needs to intercept this and inline the subflow's IR.
    // For now, we return a placeholder step that the compiler will expand.
    return {
      operation: 'Subflow',
      stepType: IRStepType.Transform,
      params: {
        subflowId: settings.subflowId,
      },
      imports: [],
    };
  },
});
