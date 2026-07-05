import { describe, it, expect } from 'vitest';
import { IRStepType, NodeCategory } from '@beamflow/shared';
import { groupBy } from './group-by.js';

describe('groupBy node', () => {
  it('has the expected identity and ports', () => {
    expect(groupBy.type).toBe('beamflow:group-by');
    expect(groupBy.category).toBe(NodeCategory.Transform);
    expect(groupBy.ports.map((p) => p.direction)).toEqual(['input', 'output']);
  });

  describe('toIR', () => {
    it('splits comma-separated keyFields into a trimmed array', () => {
      const ir = groupBy.toIR({ keyFields: 'department, role ', aggregation: 'count' }, 'n');
      expect(ir.operation).toBe('GroupBy');
      expect(ir.stepType).toBe(IRStepType.Combine);
      expect(ir.params.keyFields).toEqual(['department', 'role']);
      expect(ir.params.aggregation).toBe('count');
      expect(ir.imports).toContain('apache_beam.transforms.combiners');
    });

    it('defaults aggregation to count and drops empty key segments', () => {
      const ir = groupBy.toIR({ keyFields: 'a,,b,' }, 'n');
      expect(ir.params.keyFields).toEqual(['a', 'b']);
      expect(ir.params.aggregation).toBe('count');
    });
  });

  describe('validate', () => {
    it('requires keyFields', () => {
      const issues = groupBy.validate({ keyFields: '', aggregation: 'count' });
      expect(issues.some((i) => i.settingKey === 'keyFields')).toBe(true);
    });

    it('requires aggregateField for non-count aggregations', () => {
      const issues = groupBy.validate({ keyFields: 'dept', aggregation: 'sum', aggregateField: '' });
      expect(issues.some((i) => i.settingKey === 'aggregateField')).toBe(true);
    });

    it('does NOT require aggregateField for count', () => {
      const issues = groupBy.validate({ keyFields: 'dept', aggregation: 'count' });
      expect(issues).toEqual([]);
    });
  });
});
