import { describe, it, expect } from 'vitest';
import { IRStepType, NodeCategory } from '@beamflow/shared';
import { filter } from './filter.js';

describe('filter node', () => {
  it('has the expected identity and ports', () => {
    expect(filter.type).toBe('beamflow:filter');
    expect(filter.category).toBe(NodeCategory.Transform);
    expect(filter.ports.map((p) => p.direction)).toEqual(['input', 'output']);
  });

  describe('toIR', () => {
    it('maps to a Transform step, defaulting operator to ==', () => {
      const ir = filter.toIR({ field: 'age', value: '18' }, 'n');
      expect(ir).toEqual({
        operation: 'Filter',
        stepType: IRStepType.Transform,
        params: { field: 'age', operator: '==', value: '18' },
        imports: [],
      });
    });

    it('preserves an explicit operator', () => {
      const ir = filter.toIR({ field: 'name', operator: 'contains', value: 'a' }, 'n');
      expect(ir.params.operator).toBe('contains');
    });
  });

  describe('validate', () => {
    it('requires field', () => {
      const issues = filter.validate({ field: '', operator: '==', value: '1' });
      expect(issues.some((i) => i.settingKey === 'field')).toBe(true);
    });

    it('requires value for comparison operators', () => {
      const issues = filter.validate({ field: 'age', operator: '>', value: '' });
      expect(issues.some((i) => i.settingKey === 'value')).toBe(true);
    });

    it('does NOT require value for the is_null operator', () => {
      const issues = filter.validate({ field: 'age', operator: 'is_null', value: '' });
      expect(issues.some((i) => i.settingKey === 'value')).toBe(false);
    });

    it('accepts a numeric zero value', () => {
      const issues = filter.validate({ field: 'age', operator: '==', value: 0 });
      expect(issues).toEqual([]);
    });
  });
});
