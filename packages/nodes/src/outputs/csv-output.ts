/**
 * CSV Output node — writes pipeline results to a CSV file.
 */

import { NodeCategory, IRStepType } from '@beamflow/shared';
import {
  defineNode,
  inputPort,
  textSetting,
  selectSetting,
  booleanSetting,
  requiredError,
} from '../helpers.js';

export const csvOutput = defineNode({
  type: 'beamflow:csv-output',
  name: 'CSV Output',
  description: 'Write pipeline results to a CSV file.',
  category: NodeCategory.Output,
  icon: 'file-output',
  tags: ['csv', 'file', 'output', 'write', 'sink'],

  ports: [
    inputPort('in', 'Records'),
  ],

  settings: [
    textSetting('filePath', 'Output File Path', {
      description: 'Path where the CSV file will be written.',
      placeholder: '/path/to/output.csv',
      required: true,
      group: 'Output',
      order: 1,
    }),
    selectSetting('delimiter', 'Delimiter', [
      { label: 'Comma (,)', value: ',' },
      { label: 'Tab (\\t)', value: '\t' },
      { label: 'Pipe (|)', value: '|' },
      { label: 'Semicolon (;)', value: ';' },
    ], {
      description: 'Character used to separate fields in output.',
      defaultValue: ',',
      group: 'Output',
      order: 2,
    }),
    booleanSetting('includeHeader', 'Include Header Row', {
      description: 'Whether to write column names as the first row.',
      defaultValue: true,
      group: 'Output',
      order: 3,
    }),
  ],

  validate(settings) {
    const issues = [];
    if (!settings.filePath || (settings.filePath as string).trim() === '') {
      issues.push(requiredError('filePath', 'Output file path is required.'));
    }
    return issues;
  },

  toIR(settings, nodeId) {
    return {
      operation: 'WriteToCSV',
      stepType: IRStepType.Write,
      params: {
        filePath: settings.filePath,
        delimiter: settings.delimiter || ',',
        includeHeader: settings.includeHeader ?? true,
      },
      imports: ['apache_beam.io.WriteToText'],
    };
  },
});
