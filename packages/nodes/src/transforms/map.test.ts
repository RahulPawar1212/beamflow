import { describe, it, expect } from 'vitest';
import { IRStepType, NodeCategory } from '@beamflow/shared';
import { map } from './map.js';

describe('map node', () => {
  it('has the expected identity and ports', () => {
    expect(map.type).toBe('beamflow:map');
    expect(map.category).toBe(NodeCategory.Transform);
    expect(map.ports.map((p) => p.direction)).toEqual(['input', 'output']);
  });

  describe('toIR', () => {
    it('maps to a Transform step; outputField undefined when empty', () => {
      const ir = map.toIR({ expression: 'element' }, 'n');
      expect(ir.operation).toBe('Map');
      expect(ir.stepType).toBe(IRStepType.Transform);
      expect(ir.params).toEqual({ expression: 'element', outputField: undefined });
    });

    it('passes through outputField', () => {
      const ir = map.toIR({ expression: 'x*2', outputField: 'doubled' }, 'n');
      expect(ir.params.outputField).toBe('doubled');
    });
  });

  describe('validate', () => {
    it('requires expression', () => {
      expect(map.validate({ expression: '' })).toHaveLength(1);
    });

    it('passes with an expression', () => {
      expect(map.validate({ expression: 'element' })).toEqual([]);
    });
  });
});
