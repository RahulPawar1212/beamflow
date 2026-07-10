/**
 * CSV Output node (`beamflow:csv-output`).
 *
 * Writes pipeline results to a CSV file (a sink — no output port).
 *
 * - Category: Output
 * - Ports:    in → Records (no outputs)
 * - Settings: filePath (required), delimiter, includeHeader (default true)
 * - Emits IR: { operation: 'WriteToCSV', stepType: Write };
 *             imports `apache_beam.io.WriteToText`.
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
      description: 'File name prefix — Beam appends a shard suffix, e.g. this becomes "-00000-of-00001". Enter a full file path (not a folder); a bare folder path writes a same-named FILE next to it, not into it.',
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
