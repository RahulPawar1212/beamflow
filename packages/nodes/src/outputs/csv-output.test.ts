import { describe, it, expect } from 'vitest';
import { IRStepType, NodeCategory } from '@beamflow/shared';
import { csvOutput } from './csv-output.js';

describe('csvOutput node', () => {
  it('has the expected identity and ports', () => {
    expect(csvOutput.type).toBe('beamflow:csv-output');
    expect(csvOutput.category).toBe(NodeCategory.Output);
    // Sink node: one input, no output.
    expect(csvOutput.ports.map((p) => p.direction)).toEqual(['input']);
  });

  describe('toIR', () => {
    it('maps to a Write step with defaults applied', () => {
      const ir = csvOutput.toIR({ filePath: '/out.csv' }, 'n');
      expect(ir).toEqual({
        operation: 'WriteToCSV',
        stepType: IRStepType.Write,
        params: { filePath: '/out.csv', delimiter: ',', includeHeader: true },
        imports: ['apache_beam.io.WriteToText'],
      });
    });

    it('respects includeHeader=false and a custom delimiter', () => {
      const ir = csvOutput.toIR({ filePath: '/o.tsv', delimiter: '\t', includeHeader: false }, 'n');
      expect(ir.params).toMatchObject({ delimiter: '\t', includeHeader: false });
    });
  });

  describe('validate', () => {
    it('requires filePath', () => {
      expect(csvOutput.validate({ filePath: '' })).toHaveLength(1);
    });

    it('passes with a filePath', () => {
      expect(csvOutput.validate({ filePath: '/out.csv' })).toEqual([]);
    });
  });
});
