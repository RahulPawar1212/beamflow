/**
 * JSON Source node — reads data from a JSON file (one JSON object per line).
 */

import { NodeCategory, IRStepType } from '@beamflow/shared';
import {
  defineNode,
  outputPort,
  textSetting,
  requiredError,
} from '../helpers.js';

export const jsonSource = defineNode({
  type: 'beamflow:json-source',
  name: 'JSON Source',
  description: 'Read data from a JSON file. Supports JSON Lines format (one JSON object per line).',
  category: NodeCategory.Source,
  icon: 'file-json',
  tags: ['json', 'file', 'source', 'input', 'read'],

  ports: [
    outputPort('out', 'Records'),
  ],

  settings: [
    textSetting('filePath', 'File Path', {
      description: 'Path to the JSON file to read.',
      placeholder: '/path/to/data.jsonl',
      required: true,
      group: 'Source',
      order: 1,
    }),
    textSetting('jsonPath', 'JSON Path', {
      description: 'Optional JSON path expression to extract nested data (e.g., "$.results").',
      placeholder: '$.data',
      group: 'Advanced',
      order: 10,
    }),
  ],

  validate(settings) {
    const issues = [];
    if (!settings.filePath || (settings.filePath as string).trim() === '') {
      issues.push(requiredError('filePath', 'File path is required.'));
    }
    return issues;
  },

  toIR(settings, nodeId) {
    return {
      operation: 'ReadFromJSON',
      stepType: IRStepType.Read,
      params: {
        filePath: settings.filePath,
        jsonPath: settings.jsonPath || undefined,
      },
      imports: ['apache_beam.io.ReadFromText'],
    };
  },
});
