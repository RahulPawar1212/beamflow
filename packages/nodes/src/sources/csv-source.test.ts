import { describe, it, expect } from 'vitest';
import { IRStepType, NodeCategory } from '@beamflow/shared';
import { csvSource } from './csv-source.js';

describe('csvSource node', () => {
  it('has the expected identity and ports', () => {
    expect(csvSource.type).toBe('beamflow:csv-source');
    expect(csvSource.category).toBe(NodeCategory.Source);
    // Source node: one output, no input.
    expect(csvSource.ports.map((p) => p.direction)).toEqual(['output']);
  });

  describe('toIR', () => {
    it('maps settings to a Read step with defaults applied', () => {
      const ir = csvSource.toIR({ filePath: '/data.csv' }, 'node_1');
      expect(ir).toEqual({
        operation: 'ReadFromCSV',
        stepType: IRStepType.Read,
        params: {
          filePath: '/data.csv',
          delimiter: ',',
          hasHeader: true,
          encoding: 'utf-8',
        },
        imports: ['apache_beam.io.ReadFromText'],
      });
    });

    it('passes through explicit delimiter / hasHeader / encoding', () => {
      const ir = csvSource.toIR(
        { filePath: '/d.tsv', delimiter: '\t', hasHeader: false, encoding: 'latin-1' },
        'n',
      );
      expect(ir.params).toMatchObject({ delimiter: '\t', hasHeader: false, encoding: 'latin-1' });
    });
  });

  describe('validate', () => {
    it('requires filePath', () => {
      const issues = csvSource.validate({ filePath: '' });
      expect(issues).toHaveLength(1);
      expect(issues[0].settingKey).toBe('filePath');
    });

    it('passes when filePath is present', () => {
      expect(csvSource.validate({ filePath: '/data.csv' })).toEqual([]);
    });
  });
});
