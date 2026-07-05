import { describe, it, expect } from 'vitest';
import { IRStepType, NodeCategory } from '@beamflow/shared';
import { jsonSource } from './json-source.js';

describe('jsonSource node', () => {
  it('has the expected identity and ports', () => {
    expect(jsonSource.type).toBe('beamflow:json-source');
    expect(jsonSource.category).toBe(NodeCategory.Source);
    expect(jsonSource.ports.map((p) => p.direction)).toEqual(['output']);
  });

  describe('toIR', () => {
    it('maps to a Read step, omitting jsonPath when unset', () => {
      const ir = jsonSource.toIR({ filePath: '/data.jsonl' }, 'n');
      expect(ir.operation).toBe('ReadFromJSON');
      expect(ir.stepType).toBe(IRStepType.Read);
      expect(ir.params).toEqual({ filePath: '/data.jsonl', jsonPath: undefined });
      expect(ir.imports).toContain('apache_beam.io.ReadFromText');
    });

    it('passes through jsonPath when provided', () => {
      const ir = jsonSource.toIR({ filePath: '/d.json', jsonPath: '$.results' }, 'n');
      expect(ir.params.jsonPath).toBe('$.results');
    });
  });

  describe('validate', () => {
    it('requires filePath', () => {
      expect(jsonSource.validate({ filePath: '   ' })).toHaveLength(1);
    });

    it('passes with a filePath', () => {
      expect(jsonSource.validate({ filePath: '/data.jsonl' })).toEqual([]);
    });
  });
});
