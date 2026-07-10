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
    // Not required: a subflow may be self-contained (its own source inside,
    // e.g. a CSV Source used directly rather than a system:subflow-input
    // boundary), so it can legitimately have no upstream edge feeding it.
    inputPort('in', 'Input', { multiple: true, required: false }),
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
    // Unreachable via buildIR(): it intercepts `system:subflow` nodes before
    // ever calling toIR(), recursively compiling the referenced subflow into
    // a nested composite IRStep (packages/ir/src/builder.ts,
    // buildCompositeStepForSubflowNode). This stub only exists as a
    // defensive fallback for any future/alternate caller that invokes
    // toIR() directly without going through buildIR's node-type dispatch.
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
