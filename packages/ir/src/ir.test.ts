import { describe, it, expect, vi } from 'vitest';
import { buildIR, validateIR } from './builder.js';
import type { SubflowResolver } from './builder.js';
import { optimizeIR, fuseFilters, detectDeadBranches } from './optimizer.js';
import { DAG } from '@beamflow/graph';
import { createRegistry } from '@beamflow/core';
import {
  NodeCategory,
  DataType,
  PortDirection,
  SettingType,
  IRStepType,
  SCHEMA_VERSION,
} from '@beamflow/shared';
import type { SerializedWorkflow } from '@beamflow/shared';

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

// Like testNodeDefB, but declares a REQUIRED `condition` setting — used to
// exercise live auto-param derivation (deriveAutoParameters) for a subflow
// document whose metadata.parameters was never populated (a pre-feature save).
const testNodeDefRequiredFilter = {
  type: 'test:required-filter',
  name: 'TestRequiredFilter',
  description: '',
  category: NodeCategory.Transform,
  icon: '',
  version: '1.0.0',
  ports: [
    { id: 'in', name: 'in', direction: PortDirection.Input, dataType: DataType.Record, required: true },
    { id: 'out', name: 'out', direction: PortDirection.Output, dataType: DataType.Record, required: false },
  ],
  settings: [
    {
      key: 'condition',
      label: 'Condition',
      type: SettingType.Text,
      validation: [{ type: 'required' as const, message: 'Condition is required.' }],
    },
  ],
  toIR: (settings: any) => ({
    stepType: IRStepType.Transform,
    operation: 'Filter',
    params: { condition: settings.condition },
  }),
  validate: () => [],
};

// ── Minimal stand-ins for the real @beamflow/nodes system node defs ─────────
// (packages/ir doesn't depend on @beamflow/nodes; these mirror the real
// toIR() shapes for system:subflow / -input / -output closely enough to
// exercise buildIR's recursive composite-step handling.)

const testSubflowProxyDef = {
  type: 'system:subflow',
  name: 'Subflow',
  description: '',
  category: NodeCategory.Custom,
  icon: '',
  version: '1.0.0',
  ports: [
    { id: 'in', name: 'in', direction: PortDirection.Input, dataType: DataType.Record, required: false },
    { id: 'out', name: 'out', direction: PortDirection.Output, dataType: DataType.Record, required: false },
  ],
  settings: [],
  toIR: (settings: any) => ({
    stepType: IRStepType.Transform,
    operation: 'Subflow',
    params: { subflowId: settings.subflowId },
  }),
  validate: () => [],
};

const testSubflowInputDef = {
  type: 'system:subflow-input',
  name: 'Subflow Input',
  description: '',
  category: NodeCategory.Source,
  icon: '',
  version: '1.0.0',
  ports: [{ id: 'out', name: 'out', direction: PortDirection.Output, dataType: DataType.Record, required: false }],
  settings: [],
  toIR: (settings: any) => ({
    stepType: IRStepType.Read,
    operation: 'SubflowInput',
    params: { inputName: settings.inputName },
  }),
  validate: () => [],
};

const testSubflowOutputDef = {
  type: 'system:subflow-output',
  name: 'Subflow Output',
  description: '',
  category: NodeCategory.Output,
  icon: '',
  version: '1.0.0',
  ports: [{ id: 'in', name: 'in', direction: PortDirection.Input, dataType: DataType.Record, required: true }],
  settings: [],
  toIR: (settings: any) => ({
    stepType: IRStepType.Write,
    operation: 'SubflowOutput',
    params: { outputName: settings.outputName },
  }),
  validate: () => [],
};

function makeRegistryWithSubflowSystemNodes() {
  const registry = createRegistry();
  registry.register(testNodeDefA);
  registry.register(testNodeDefB);
  registry.register(testSubflowProxyDef);
  registry.register(testSubflowInputDef);
  registry.register(testSubflowOutputDef);
  return registry;
}

function makeRegistryWithRequiredFilter() {
  const registry = makeRegistryWithSubflowSystemNodes();
  registry.register(testNodeDefRequiredFilter);
  return registry;
}

/** Build a minimal SerializedWorkflow: Input -> Filter -> Output. */
function makeSimpleSubflowDoc(id: string, name: string): SerializedWorkflow {
  return {
    schemaVersion: SCHEMA_VERSION,
    metadata: {
      id,
      name,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      isSubflow: true,
      parameters: [
        {
          id: 'param_1',
          name: 'Filter Value',
          type: 'string',
          targetNodeId: 'inner_filter',
          targetSettingKey: 'condition',
        },
      ],
    },
    nodes: [
      { id: 'inner_input', type: 'system:subflow-input', settings: { inputName: 'Input 1' }, position: { x: 0, y: 0 } },
      { id: 'inner_filter', type: 'test:filter', settings: { condition: 'x > 1' }, position: { x: 100, y: 0 } },
      { id: 'inner_output', type: 'system:subflow-output', settings: { outputName: 'Output 1' }, position: { x: 200, y: 0 } },
    ],
    connections: [
      { id: 'e1', sourceNodeId: 'inner_input', sourcePortId: 'out', targetNodeId: 'inner_filter', targetPortId: 'in' },
      { id: 'e2', sourceNodeId: 'inner_filter', sourcePortId: 'out', targetNodeId: 'inner_output', targetPortId: 'in' },
    ],
  };
}

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

  describe('IR Builder — subflow composite steps', () => {
    it('compiles a system:subflow node into a nested composite IRStep', () => {
      const registry = makeRegistryWithSubflowSystemNodes();
      const subflowDoc = makeSimpleSubflowDoc('sf_1', 'My Subflow');
      const resolveSubflow: SubflowResolver = (id) =>
        id === 'sf_1' ? { workflow: subflowDoc } : undefined;

      const dag = new DAG();
      dag.addNode({ id: 'src', type: 'test:source', settings: {}, position: { x: 0, y: 0 } });
      dag.addNode({
        id: 'proxy',
        type: 'system:subflow',
        settings: { subflowId: 'sf_1', param_1: '7' },
        position: { x: 100, y: 0 },
      });
      dag.addEdge({ id: 'e1', sourceNodeId: 'src', sourcePortId: 'out', targetNodeId: 'proxy', targetPortId: 'in' });

      const ir = buildIR(dag, registry, { name: 'Parent', resolveSubflow });

      expect(ir.steps.length).toBe(2);
      const composite = ir.steps.find((s) => s.id === 'proxy')!;
      expect(composite.operation).toBe('Subflow');
      expect(composite.compositeSourceId).toBe('sf_1');
      expect(composite.subPipeline).toBeDefined();
      expect(composite.subPipeline!.steps.map((s) => s.id)).toEqual([
        'inner_input',
        'inner_filter',
        'inner_output',
      ]);

      // Output boundary resolved via the shared resolveSubflowOutputs classifier.
      expect(composite.compositeOutputs).toEqual([
        { sourceStepId: 'inner_filter', name: 'Output 1' },
      ]);

      // Input boundary named from the subflow-input node.
      expect(composite.compositeInputNames).toEqual(['Input 1']);

      // Exposed parameter resolved with its default + this usage site's override.
      expect(composite.compositeParams).toEqual([
        {
          id: 'param_1',
          name: 'Filter Value',
          type: 'string',
          defaultValue: 'x > 1',
          targetStepId: 'inner_filter',
          targetParamKey: 'condition',
        },
      ]);
      expect(composite.compositeParamOverrides).toEqual({ param_1: '7' });

      const errors = validateIR(ir);
      expect(errors).toEqual([]);
    });

    it('live-derives a composite parameter for a required-empty inner setting even with NO stored metadata.parameters', () => {
      // Simulates a subflow saved BEFORE auto-params existed: metadata.parameters
      // is empty/absent, but the inner node has a required setting left unfilled.
      // buildIR must still expose it (auto_<nodeId>_<key>) and honor an override
      // from the proxy's own settings — matching the editor's live schema-store.
      const registry = makeRegistryWithRequiredFilter();
      const oldDoc: SerializedWorkflow = {
        schemaVersion: SCHEMA_VERSION,
        metadata: { id: 'sf_old', name: 'Pre-feature Subflow', createdAt: '', updatedAt: '', isSubflow: true },
        nodes: [
          { id: 'inner_input', type: 'system:subflow-input', settings: { inputName: 'Input 1' }, position: { x: 0, y: 0 } },
          { id: 'inner_filter', type: 'test:required-filter', settings: { condition: '' }, position: { x: 100, y: 0 } },
          { id: 'inner_output', type: 'system:subflow-output', settings: { outputName: 'Output 1' }, position: { x: 200, y: 0 } },
        ],
        connections: [
          { id: 'e1', sourceNodeId: 'inner_input', sourcePortId: 'out', targetNodeId: 'inner_filter', targetPortId: 'in' },
          { id: 'e2', sourceNodeId: 'inner_filter', sourcePortId: 'out', targetNodeId: 'inner_output', targetPortId: 'in' },
        ],
      };
      const resolveSubflow: SubflowResolver = (id) => (id === 'sf_old' ? { workflow: oldDoc } : undefined);

      const dag = new DAG();
      dag.addNode({ id: 'src', type: 'test:source', settings: {}, position: { x: 0, y: 0 } });
      dag.addNode({
        id: 'proxy',
        type: 'system:subflow',
        // The proxy fills the live-derived param by its deterministic id —
        // no prior save ever materialized this id anywhere.
        settings: { subflowId: 'sf_old', auto_inner_filter_condition: 'y > 2' },
        position: { x: 100, y: 0 },
      });
      dag.addEdge({ id: 'e1', sourceNodeId: 'src', sourcePortId: 'out', targetNodeId: 'proxy', targetPortId: 'in' });

      const ir = buildIR(dag, registry, { name: 'Parent', resolveSubflow });
      const composite = ir.steps.find((s) => s.id === 'proxy')!;

      expect(composite.compositeParams).toEqual([
        {
          id: 'auto_inner_filter_condition',
          name: 'Condition',
          type: 'string',
          defaultValue: '',
          targetStepId: 'inner_filter',
          targetParamKey: 'condition',
        },
      ]);
      expect(composite.compositeParamOverrides).toEqual({ auto_inner_filter_condition: 'y > 2' });

      const errors = validateIR(ir);
      expect(errors).toEqual([]);
    });

    it('recursively compiles nested subflow-in-subflow (2+ levels)', () => {
      const registry = makeRegistryWithSubflowSystemNodes();
      const innerDoc = makeSimpleSubflowDoc('sf_inner', 'Inner Subflow');
      const outerDoc: SerializedWorkflow = {
        schemaVersion: SCHEMA_VERSION,
        metadata: { id: 'sf_outer', name: 'Outer Subflow', createdAt: '', updatedAt: '', isSubflow: true },
        nodes: [
          { id: 'outer_input', type: 'system:subflow-input', settings: { inputName: 'Input 1' }, position: { x: 0, y: 0 } },
          {
            id: 'nested_proxy',
            type: 'system:subflow',
            settings: { subflowId: 'sf_inner' },
            position: { x: 100, y: 0 },
          },
          { id: 'outer_output', type: 'system:subflow-output', settings: { outputName: 'Output 1' }, position: { x: 200, y: 0 } },
        ],
        connections: [
          { id: 'e1', sourceNodeId: 'outer_input', sourcePortId: 'out', targetNodeId: 'nested_proxy', targetPortId: 'in' },
          { id: 'e2', sourceNodeId: 'nested_proxy', sourcePortId: 'out', targetNodeId: 'outer_output', targetPortId: 'in' },
        ],
      };

      const resolveSubflow: SubflowResolver = (id) => {
        if (id === 'sf_inner') return { workflow: innerDoc };
        if (id === 'sf_outer') return { workflow: outerDoc };
        return undefined;
      };

      const dag = new DAG();
      dag.addNode({ id: 'src', type: 'test:source', settings: {}, position: { x: 0, y: 0 } });
      dag.addNode({ id: 'proxy', type: 'system:subflow', settings: { subflowId: 'sf_outer' }, position: { x: 100, y: 0 } });
      dag.addEdge({ id: 'e1', sourceNodeId: 'src', sourcePortId: 'out', targetNodeId: 'proxy', targetPortId: 'in' });

      const ir = buildIR(dag, registry, { name: 'Parent', resolveSubflow });

      const outerStep = ir.steps.find((s) => s.id === 'proxy')!;
      expect(outerStep.subPipeline).toBeDefined();
      const nestedStep = outerStep.subPipeline!.steps.find((s) => s.id === 'nested_proxy')!;
      expect(nestedStep.subPipeline).toBeDefined();
      expect(nestedStep.subPipeline!.steps.map((s) => s.id)).toEqual([
        'inner_input',
        'inner_filter',
        'inner_output',
      ]);

      expect(validateIR(ir)).toEqual([]);
    });

    it('throws when a system:subflow node has no resolver provided', () => {
      const registry = makeRegistryWithSubflowSystemNodes();
      const dag = new DAG();
      dag.addNode({ id: 'proxy', type: 'system:subflow', settings: { subflowId: 'sf_1' }, position: { x: 0, y: 0 } });

      expect(() => buildIR(dag, registry, { name: 'Parent' })).toThrow(/no subflow resolver/);
    });

    it('throws when the resolver cannot find the referenced subflow', () => {
      const registry = makeRegistryWithSubflowSystemNodes();
      const resolveSubflow: SubflowResolver = () => undefined;
      const dag = new DAG();
      dag.addNode({ id: 'proxy', type: 'system:subflow', settings: { subflowId: 'sf_missing' }, position: { x: 0, y: 0 } });

      expect(() => buildIR(dag, registry, { name: 'Parent', resolveSubflow })).toThrow(/could not be resolved/);
    });

    it('throws past the max subflow nesting depth (cycle guard)', () => {
      const registry = makeRegistryWithSubflowSystemNodes();
      // sf_a references sf_b and vice versa — an infinite recursive cycle.
      const makeCyclicDoc = (id: string, refId: string): SerializedWorkflow => ({
        schemaVersion: SCHEMA_VERSION,
        metadata: { id, name: id, createdAt: '', updatedAt: '', isSubflow: true },
        nodes: [
          { id: 'p', type: 'system:subflow', settings: { subflowId: refId }, position: { x: 0, y: 0 } },
        ],
        connections: [],
      });
      const docA = makeCyclicDoc('sf_a', 'sf_b');
      const docB = makeCyclicDoc('sf_b', 'sf_a');
      const resolveSubflow: SubflowResolver = (id) => {
        if (id === 'sf_a') return { workflow: docA };
        if (id === 'sf_b') return { workflow: docB };
        return undefined;
      };

      const dag = new DAG();
      dag.addNode({ id: 'proxy', type: 'system:subflow', settings: { subflowId: 'sf_a' }, position: { x: 0, y: 0 } });

      expect(() => buildIR(dag, registry, { name: 'Parent', resolveSubflow })).toThrow(/Max subflow nesting depth/);
    });

    it('surfaces an ambiguous output boundary as a thrown error', () => {
      const registry = makeRegistryWithSubflowSystemNodes();
      // Two terminal nodes, no explicit output node -> ambiguous.
      const ambiguousDoc: SerializedWorkflow = {
        schemaVersion: SCHEMA_VERSION,
        metadata: { id: 'sf_ambiguous', name: 'Ambiguous', createdAt: '', updatedAt: '', isSubflow: true },
        nodes: [
          { id: 'inner_input', type: 'system:subflow-input', settings: { inputName: 'Input 1' }, position: { x: 0, y: 0 } },
          { id: 'branch_a', type: 'test:filter', settings: {}, position: { x: 100, y: 0 } },
          { id: 'branch_b', type: 'test:filter', settings: {}, position: { x: 100, y: 100 } },
        ],
        connections: [
          { id: 'e1', sourceNodeId: 'inner_input', sourcePortId: 'out', targetNodeId: 'branch_a', targetPortId: 'in' },
          { id: 'e2', sourceNodeId: 'inner_input', sourcePortId: 'out', targetNodeId: 'branch_b', targetPortId: 'in' },
        ],
      };
      const resolveSubflow: SubflowResolver = (id) =>
        id === 'sf_ambiguous' ? { workflow: ambiguousDoc } : undefined;

      const dag = new DAG();
      dag.addNode({ id: 'proxy', type: 'system:subflow', settings: { subflowId: 'sf_ambiguous' }, position: { x: 0, y: 0 } });

      expect(() => buildIR(dag, registry, { name: 'Parent', resolveSubflow })).toThrow(/possible outputs/);
    });

    it('resolves inputOutputKeys for downstream consumers of a multi-output subflow', () => {
      const registry = makeRegistryWithSubflowSystemNodes();
      const multiOutputDoc: SerializedWorkflow = {
        schemaVersion: SCHEMA_VERSION,
        metadata: { id: 'sf_multi', name: 'Multi Output', createdAt: '', updatedAt: '', isSubflow: true },
        nodes: [
          { id: 'in', type: 'system:subflow-input', settings: { inputName: 'Input 1' }, position: { x: 0, y: 0 } },
          { id: 'branch_a', type: 'test:filter', settings: {}, position: { x: 100, y: 0 } },
          { id: 'branch_b', type: 'test:filter', settings: {}, position: { x: 100, y: 100 } },
          { id: 'out_a', type: 'system:subflow-output', settings: { outputName: 'Output A' }, position: { x: 200, y: 0 } },
          { id: 'out_b', type: 'system:subflow-output', settings: { outputName: 'Output B' }, position: { x: 200, y: 100 } },
        ],
        connections: [
          { id: 'e1', sourceNodeId: 'in', sourcePortId: 'out', targetNodeId: 'branch_a', targetPortId: 'in' },
          { id: 'e2', sourceNodeId: 'in', sourcePortId: 'out', targetNodeId: 'branch_b', targetPortId: 'in' },
          { id: 'e3', sourceNodeId: 'branch_a', sourcePortId: 'out', targetNodeId: 'out_a', targetPortId: 'in' },
          { id: 'e4', sourceNodeId: 'branch_b', sourcePortId: 'out', targetNodeId: 'out_b', targetPortId: 'in' },
        ],
      };
      const resolveSubflow: SubflowResolver = (id) =>
        id === 'sf_multi' ? { workflow: multiOutputDoc } : undefined;

      const dag = new DAG();
      dag.addNode({ id: 'src', type: 'test:source', settings: {}, position: { x: 0, y: 0 } });
      dag.addNode({ id: 'proxy', type: 'system:subflow', settings: { subflowId: 'sf_multi' }, position: { x: 100, y: 0 } });
      dag.addNode({ id: 'sink_a', type: 'test:filter', settings: {}, position: { x: 200, y: 0 } });
      dag.addNode({ id: 'sink_b', type: 'test:filter', settings: {}, position: { x: 200, y: 100 } });
      dag.addEdge({ id: 'e1', sourceNodeId: 'src', sourcePortId: 'out', targetNodeId: 'proxy', targetPortId: 'in' });
      dag.addEdge({ id: 'e2', sourceNodeId: 'proxy', sourcePortId: 'Output A', targetNodeId: 'sink_a', targetPortId: 'in' });
      dag.addEdge({ id: 'e3', sourceNodeId: 'proxy', sourcePortId: 'Output B', targetNodeId: 'sink_b', targetPortId: 'in' });

      const ir = buildIR(dag, registry, { name: 'Parent', resolveSubflow });
      const composite = ir.steps.find((s) => s.id === 'proxy')!;
      expect(composite.compositeOutputs?.map((o) => o.name)).toEqual(['Output A', 'Output B']);

      const sinkA = ir.steps.find((s) => s.id === 'sink_a')!;
      const sinkB = ir.steps.find((s) => s.id === 'sink_b')!;
      expect(sinkA.inputOutputKeys).toEqual(['Output A']);
      expect(sinkB.inputOutputKeys).toEqual(['Output B']);
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

    it('recurses into a composite step\'s subPipeline, applying passes there too', () => {
      const subPipeline = {
        id: 'sf_1', name: 'Sub', version: '1.0.0',
        steps: [
          { id: 'inner_source', label: 'Inner Source', type: IRStepType.Read, operation: 'Read', params: {}, inputs: [] },
          { id: 'inner_filter_1', label: 'Inner Filter 1', type: IRStepType.Transform, operation: 'Filter', params: { field: 'a', op: '==', val: 1 }, inputs: ['inner_source'] },
          { id: 'inner_filter_2', label: 'Inner Filter 2', type: IRStepType.Transform, operation: 'Filter', params: { field: 'b', op: '==', val: 2 }, inputs: ['inner_filter_1'] },
        ],
        connections: [
          { fromStepId: 'inner_source', toStepId: 'inner_filter_1' },
          { fromStepId: 'inner_filter_1', toStepId: 'inner_filter_2' },
        ],
      };
      const pipeline = {
        id: 'p', name: 'Parent', version: '1.0.0',
        steps: [
          { id: 'source', label: 'Source', type: IRStepType.Read, operation: 'Read', params: {}, inputs: [] },
          {
            id: 'composite', label: 'Composite', type: IRStepType.Transform, operation: 'Subflow',
            params: {}, inputs: ['source'], subPipeline,
            compositeOutputs: [{ sourceStepId: 'inner_filter_2' }],
          },
        ],
        connections: [
          { fromStepId: 'source', toStepId: 'composite' },
        ],
      };

      const optimized = optimizeIR(pipeline as any, [fuseFilters]);
      // Top-level steps untouched (composite step's own operation isn't 'Filter').
      expect(optimized.steps.map((s: any) => s.id)).toEqual(['source', 'composite']);
      // The nested subPipeline's adjacent filters ARE fused.
      const compositeStep: any = optimized.steps.find((s: any) => s.id === 'composite')!;
      expect(compositeStep.subPipeline.steps.length).toBe(2);
      expect(compositeStep.subPipeline.steps[1].id).toBe('inner_filter_2');
      expect(compositeStep.subPipeline.steps[1].params.fused).toBe(true);
    });
  });
});
