/**
 * CSV Source node — reads data from a CSV file.
 *
 * This is a reference implementation showing how to build a source node.
 * Every node is a self-contained definition implementing INodeDefinition.
 */

import { NodeCategory, IRStepType } from '@beamflow/shared';
import {
  defineNode,
  outputPort,
  textSetting,
  selectSetting,
  booleanSetting,
  requiredError,
} from '../helpers.js';

export const csvSource = defineNode({
  type: 'beamflow:csv-source',
  name: 'CSV Source',
  description: 'Read data from a CSV file. Each row becomes a record in the pipeline.',
  category: NodeCategory.Source,
  icon: 'file-csv',
  tags: ['csv', 'file', 'source', 'input', 'read'],

  ports: [
    outputPort('out', 'Records'),
  ],

  settings: [
    textSetting('filePath', 'File Path', {
      description: 'Path to the CSV file to read.',
      placeholder: '/path/to/data.csv',
      required: true,
      group: 'Source',
      order: 1,
    }),
    selectSetting('delimiter', 'Delimiter', [
      { label: 'Comma (,)', value: ',' },
      { label: 'Tab (\\t)', value: '\t' },
      { label: 'Pipe (|)', value: '|' },
      { label: 'Semicolon (;)', value: ';' },
    ], {
      description: 'Character used to separate fields.',
      defaultValue: ',',
      group: 'Source',
      order: 2,
    }),
    booleanSetting('hasHeader', 'Has Header Row', {
      description: 'Whether the first row contains column names.',
      defaultValue: true,
      group: 'Source',
      order: 3,
    }),
    selectSetting('encoding', 'Encoding', [
      { label: 'UTF-8', value: 'utf-8' },
      { label: 'ASCII', value: 'ascii' },
      { label: 'Latin-1', value: 'latin-1' },
    ], {
      description: 'Character encoding of the file.',
      defaultValue: 'utf-8',
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
      operation: 'ReadFromCSV',
      stepType: IRStepType.Read,
      params: {
        filePath: settings.filePath,
        delimiter: settings.delimiter || ',',
        hasHeader: settings.hasHeader ?? true,
        encoding: settings.encoding || 'utf-8',
      },
      imports: ['apache_beam.io.ReadFromText'],
    };
  },
});
