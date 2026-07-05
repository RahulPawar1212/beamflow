import { describe, it, expect, vi } from 'vitest';
import { buildIR, validateIR } from './builder.js';
import { optimizeIR, fuseFilters, detectDeadBranches } from './optimizer.js';
import { DAG } from '@beamflow/graph';
import { createRegistry } from '@beamflow/core';
import {
  NodeCategory,
  DataType,
  PortDirection,
  SettingType,
  IRStepType,
} from '@beamflow/shared';

const testNodeDefA = {
  type: 'test:source',
  name: 'TestSource',
  description: '',
  category: NodeCategory.Source,
  icon: '',
  version: '1.0.0',
  ports: [{ id: 'out', name: 'out', direction: PortDirection.Output, dataType: DataType.Record, required: false }],
  settings: [],
  toIR: (settings: any, id: string) => ({
    stepType: IRStepType.Read,
    operation: 'ReadFromCSV',
    params: { file: 'data.csv' },
  }),
  validate: () => [],
};

const testNodeDefB = {
  type: 'test:filter',
  name: 'TestFilter',
  description: '',
  category: NodeCategory.Transform,
  icon: '',
  version: '1.0.0',
  ports: [
    { id: 'in', name: 'in', direction: PortDirection.Input, dataType: DataType.Record, required: true },
    { id: 'out', name: 'out', direction: PortDirection.Output, dataType: DataType.Record, required: false },
  ],
  settings: [],
  toIR: (settings: any, id: string) => ({
    stepType: IRStepType.Transform,
    operation: 'Filter',
    params: { condition: 'x > 1' },
  }),
  validate: () => [],
};

describe('IR Package', () => {
  describe('IR Builder', () => {
    it('converts a DAG to IR pipeline correctly', () => {
      const registry = createRegistry();
      registry.register(testNodeDefA);
      registry.register(testNodeDefB);

      const dag = new DAG();
      dag.addNode({ id: 'node_1', type: 'test:source', settings: {}, position: { x: 0, y: 0 } });
      dag.addNode({ id: 'node_2', type: 'test:filter', settings: {}, position: { x: 100, y: 0 } });
      dag.addEdge({ id: 'edge_1', sourceNodeId: 'node_1', sourcePortId: 'out', targetNodeId: 'node_2', targetPortId: 'in' });

      const ir = buildIR(dag, registry, { name: 'MyPipeline' });
      expect(ir.name).toBe('MyPipeline');
      expect(ir.steps.length).toBe(2);
      expect(ir.steps[0].id).toBe('node_1');
      expect(ir.steps[0].operation).toBe('ReadFromCSV');
      expect(ir.steps[1].id).toBe('node_2');
      expect(ir.steps[1].inputs).toContain('node_1');
      expect(ir.connections.length).toBe(1);
      expect(ir.connections[0]).toEqual({ fromStepId: 'node_1', toStepId: 'node_2' });

      const errors = validateIR(ir);
      expect(errors).toEqual([]);
    });

    it('validates dangling refs in IR', () => {
      const badPipeline = {
        id: 'bad',
        name: 'Bad',
        version: '1.0.0',
        steps: [
          { id: 'step_1', label: 'Step 1', type: IRStepType.Read, operation: 'Read', params: {}, inputs: ['missing_step'] },
        ],
        connections: [
          { fromStepId: 'step_1', toStepId: 'missing_step_2' },
        ],
      };

      const errors = validateIR(badPipeline as any);
      expect(errors.length).toBe(2);
      expect(errors[0]).toContain('Connection references non-existent target step');
      expect(errors[1]).toContain('references non-existent input step');
    });
  });

  describe('IR Optimizer', () => {
    it('fuses adjacent filters', () => {
      const mockPipeline = {
        id: 'test',
        name: 'Test',
        version: '1.0.0',
        steps: [
          { id: 'source', label: 'Source', type: IRStepType.Read, operation: 'Read', params: {}, inputs: [] },
          { id: 'filter_1', label: 'Filter 1', type: IRStepType.Transform, operation: 'Filter', params: { field: 'a', op: '==', val: 1 }, inputs: ['source'] },
          { id: 'filter_2', label: 'Filter 2', type: IRStepType.Transform, operation: 'Filter', params: { field: 'b', op: '==', val: 2 }, inputs: ['filter_1'] },
        ],
        connections: [
          { fromStepId: 'source', toStepId: 'filter_1' },
          { fromStepId: 'filter_1', toStepId: 'filter_2' },
        ],
      };

      const optimized = optimizeIR(mockPipeline as any, [fuseFilters]);
      expect(optimized.steps.length).toBe(2);
      expect(optimized.steps[0].id).toBe('source');
      expect(optimized.steps[1].id).toBe('filter_2');
      expect(optimized.steps[1].inputs).toContain('source');
      const params = optimized.steps[1].params as any;
      expect(params.fused).toBe(true);
      expect(params.conditions.length).toBe(2);
      expect(optimized.connections.length).toBe(1);
      expect(optimized.connections[0]).toEqual({ fromStepId: 'source', toStepId: 'filter_2' });
    });

    it('warns on dead branches', () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const mockPipeline = {
        id: 'test',
        name: 'Test',
        version: '1.0.0',
        steps: [
          { id: 'source', label: 'Source', type: IRStepType.Read, operation: 'Read', params: {}, inputs: [] },
          { id: 'dead_transform', label: 'Dead Transform', type: IRStepType.Transform, operation: 'Map', params: {}, inputs: ['source'] },
        ],
        connections: [
          { fromStepId: 'source', toStepId: 'dead_transform' },
        ],
      };

      optimizeIR(mockPipeline as any, [detectDeadBranches]);
      expect(consoleWarnSpy).toHaveBeenCalled();
      consoleWarnSpy.mockRestore();
    });
  });
});
