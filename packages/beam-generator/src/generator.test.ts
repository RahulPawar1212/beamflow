import { describe, it, expect } from 'vitest';
import { generatePythonBeam } from './generator.js';
import { IRStepType } from '@beamflow/shared';

describe('Beam Generator Package', () => {
  it('generates executable Python Beam code for simple pipeline', () => {
    const mockPipeline = {
      id: 'my_pipeline',
      name: 'My Pipeline',
      version: '1.0.0',
      steps: [
        {
          id: 'step_1',
          label: 'Read CSV',
          type: IRStepType.Read,
          operation: 'ReadFromCSV',
          params: { filePath: 'input.csv', delimiter: ',', hasHeader: true },
          inputs: [],
          imports: [],
        },
        {
          id: 'step_2',
          label: 'Filter age',
          type: IRStepType.Transform,
          operation: 'Filter',
          params: { field: 'age', operator: '>', value: '18' },
          inputs: ['step_1'],
          imports: [],
        },
        {
          id: 'step_3',
          label: 'Map fields',
          type: IRStepType.Transform,
          operation: 'Map',
          params: { expression: 'element.get("name", "").upper()', outputField: 'upper_name' },
          inputs: ['step_2'],
          imports: [],
        },
        {
          id: 'step_4',
          label: 'Write CSV',
          type: IRStepType.Write,
          operation: 'WriteToCSV',
          params: { filePath: 'output.csv', delimiter: ',', includeHeader: true },
          inputs: ['step_3'],
          imports: [],
        },
      ],
      connections: [
        { fromStepId: 'step_1', toStepId: 'step_2' },
        { fromStepId: 'step_2', toStepId: 'step_3' },
        { fromStepId: 'step_3', toStepId: 'step_4' },
      ],
    };

    const generated = generatePythonBeam(mockPipeline as any);
    expect(generated.filename).toBe('my_pipeline_pipeline.py');
    expect(generated.language).toBe('python');
    expect(generated.code).toContain('import apache_beam as beam');
    expect(generated.code).toContain('ReadFromText');
    expect(generated.code).toContain('beam.Filter');
    expect(generated.code).toContain('WriteToText');
    expect(generated.requirements).toContain('apache-beam');
  });

  it('generates correct Python Beam code for GroupBy operation', () => {
    const mockPipeline = {
      id: 'groupby_pipeline',
      name: 'GroupBy Pipeline',
      version: '1.0.0',
      steps: [
        {
          id: 'step_1',
          label: 'Read CSV',
          type: IRStepType.Read,
          operation: 'ReadFromCSV',
          params: { filePath: 'input.csv', delimiter: ',', hasHeader: true },
          inputs: [],
          imports: [],
        },
        {
          id: 'step_2',
          label: 'GroupBy Dept',
          type: IRStepType.Combine,
          operation: 'GroupBy',
          params: { keyFields: ['department'], aggregation: 'sum', aggregateField: 'salary' },
          inputs: ['step_1'],
          imports: [],
        },
      ],
      connections: [
        { fromStepId: 'step_1', toStepId: 'step_2' },
      ],
    };

    const generated = generatePythonBeam(mockPipeline as any);
    expect(generated.code).toContain('department');
    expect(generated.code).toContain('salary');
    expect(generated.code).toContain('combiners');
    // key_fields must be a real Python list literal (self.key_fields is
    // iterated with len()/indexing), not a stringified-JSON Python string.
    expect(generated.code).toContain("key_fields=['department']");
  });

  describe('PTransform class emission (leaf operations)', () => {
    const basicPipeline = {
      id: 'my_pipeline',
      name: 'My Pipeline',
      version: '1.0.0',
      steps: [
        {
          id: 'step_1', label: 'Read CSV', type: IRStepType.Read, operation: 'ReadFromCSV',
          params: { filePath: 'input.csv', delimiter: ',', hasHeader: true }, inputs: [], imports: [],
        },
        {
          id: 'step_2', label: 'Filter age', type: IRStepType.Transform, operation: 'Filter',
          params: { field: 'age', operator: '>', value: '18' }, inputs: ['step_1'], imports: [],
        },
        {
          id: 'step_3', label: 'Write CSV', type: IRStepType.Write, operation: 'WriteToCSV',
          params: { filePath: 'output.csv' }, inputs: ['step_2'], imports: [],
        },
      ],
      connections: [],
    };

    it('emits exactly one class per operation type, before def run()', () => {
      const generated = generatePythonBeam(basicPipeline as any);

      expect(generated.code).toMatch(/class \w+\(beam\.PTransform\):/);
      // Exactly one class definition per operation type used.
      expect(generated.code.match(/class ReadFromCSVTransform\(beam\.PTransform\):/g)?.length).toBe(1);
      expect(generated.code.match(/class FilterTransform\(beam\.PTransform\):/g)?.length).toBe(1);
      expect(generated.code.match(/class WriteToCSVTransform\(beam\.PTransform\):/g)?.length).toBe(1);
      expect(generated.code).toContain('def expand(self, pcoll):');

      // Classes must be defined before def run() uses them.
      const classIdx = generated.code.indexOf('class FilterTransform');
      const runIdx = generated.code.indexOf('def run():');
      expect(classIdx).toBeGreaterThan(-1);
      expect(runIdx).toBeGreaterThan(classIdx);

      // Instantiation at the use site passes this node's own params as kwargs.
      expect(generated.code).toContain("FilterTransform(field='age', operator='>', value='18')");
    });

    it('reuses leaf classes for a composite custom node inline-IR chain', () => {
      // Mirrors what buildIR emits for a user-authored composite custom node
      // (apps/editor/src/customNodes.ts): a chain of ordinary IRSteps whose
      // ids carry the `${node.id}__s<n>` composite convention, but whose
      // operations are the SAME built-in operation strings — so they must
      // reuse the exact same FilterTransform/MapTransform classes as any
      // other Filter/Map node, with no separate code path.
      const pipeline = {
        id: 'p', name: 'P', version: '1.0.0',
        steps: [
          { id: 'src', label: 'Source', type: IRStepType.Read, operation: 'ReadFromCSV', params: { filePath: 'a.csv' }, inputs: [], imports: [] },
          { id: 'custom_1__s0', label: 'Filter step', type: IRStepType.Transform, operation: 'Filter', params: { field: 'age', operator: '>', value: '18' }, inputs: ['src'], imports: [] },
          { id: 'plain_filter', label: 'Plain Filter', type: IRStepType.Transform, operation: 'Filter', params: { field: 'x', operator: '==', value: '1' }, inputs: ['custom_1__s0'], imports: [] },
        ],
        connections: [],
      };
      const generated = generatePythonBeam(pipeline as any);
      // Only one FilterTransform class, reused by both the custom node's
      // internal step and the ordinary sibling Filter node.
      expect(generated.code.match(/class FilterTransform\(beam\.PTransform\):/g)?.length).toBe(1);
      expect(generated.code).toContain("FilterTransform(field='age', operator='>', value='18')");
      expect(generated.code).toContain("FilterTransform(field='x', operator='==', value='1')");
    });

    it('emits a class for expression-kind custom nodes (MapExpr/FilterExpr/FlatMapExpr)', () => {
      const pipeline = {
        id: 'p', name: 'P', version: '1.0.0',
        steps: [
          { id: 'src', label: 'Source', type: IRStepType.Read, operation: 'ReadFromCSV', params: { filePath: 'a.csv' }, inputs: [], imports: [] },
          { id: 'custom_expr', label: 'My Custom Map', type: IRStepType.Transform, operation: 'MapExpr', params: { expression: "element['x'] * 2" }, inputs: ['src'], imports: [] },
        ],
        connections: [],
      };
      const generated = generatePythonBeam(pipeline as any);
      expect(generated.code.match(/class MapExprTransform\(beam\.PTransform\):/g)?.length).toBe(1);
      expect(generated.code).toContain("MapExprTransform(expression='element[\\'x\\'] * 2')");
    });

    it('reuses one class across multiple instances with different kwargs', () => {
      const pipeline = {
        id: 'two_filters',
        name: 'Two Filters',
        version: '1.0.0',
        steps: [
          { id: 's1', label: 'Source', type: IRStepType.Read, operation: 'ReadFromCSV', params: { filePath: 'a.csv' }, inputs: [], imports: [] },
          { id: 's2', label: 'Filter A', type: IRStepType.Transform, operation: 'Filter', params: { field: 'a', operator: '==', value: '1' }, inputs: ['s1'], imports: [] },
          { id: 's3', label: 'Filter B', type: IRStepType.Transform, operation: 'Filter', params: { field: 'b', operator: '==', value: '2' }, inputs: ['s2'], imports: [] },
        ],
        connections: [],
      };
      const generated = generatePythonBeam(pipeline as any);
      // One class definition...
      expect(generated.code.match(/class FilterTransform\(beam\.PTransform\):/g)?.length).toBe(1);
      // ...but two distinct instantiations with different kwargs.
      expect(generated.code).toContain("FilterTransform(field='a', operator='==', value='1')");
      expect(generated.code).toContain("FilterTransform(field='b', operator='==', value='2')");
    });
  });

  describe('PTransform class emission (composite/subflow steps)', () => {
    function makeSimpleSubPipeline() {
      return {
        id: 'sf_1', name: 'My Subflow', version: '1.0.0',
        steps: [
          { id: 'inner_input', label: 'Input 1', type: IRStepType.Read, operation: 'SubflowInput', params: { inputName: 'Input 1' }, inputs: [], imports: [] },
          { id: 'inner_filter', label: 'Filter', type: IRStepType.Transform, operation: 'Filter', params: { field: 'age', operator: '>', value: '18' }, inputs: ['inner_input'], imports: [] },
          { id: 'inner_output', label: 'Output 1', type: IRStepType.Write, operation: 'SubflowOutput', params: { outputName: 'Output 1' }, inputs: ['inner_filter'], imports: [] },
        ],
        connections: [],
      };
    }

    it('emits a composite class with expand() wrapping the nested pipeline', () => {
      const pipeline = {
        id: 'p', name: 'Parent', version: '1.0.0',
        steps: [
          { id: 'src', label: 'Source', type: IRStepType.Read, operation: 'ReadFromCSV', params: { filePath: 'a.csv' }, inputs: [], imports: [] },
          {
            id: 'proxy', label: 'My Subflow', type: IRStepType.Transform, operation: 'Subflow',
            params: { subflowId: 'sf_1' }, inputs: ['src'], imports: [],
            subPipeline: makeSimpleSubPipeline(),
            compositeParams: [], compositeParamOverrides: {},
            compositeOutputs: [{ sourceStepId: 'inner_filter', name: 'Output 1' }],
            compositeInputNames: ['Input 1'],
            compositeSourceName: 'My Subflow', compositeSourceId: 'sf_1',
          },
        ],
        connections: [],
      };
      const generated = generatePythonBeam(pipeline as any);
      expect(generated.code).toContain('class My_Subflow(beam.PTransform):');
      expect(generated.code).toContain('def expand(self, pcoll):');
      // The nested Filter reuses the shared FilterTransform class.
      expect(generated.code.match(/class FilterTransform\(beam\.PTransform\):/g)?.length).toBe(1);
      expect(generated.code).toContain("FilterTransform(field='age', operator='>', value='18')");
      // Class defined before its use site.
      expect(generated.code.indexOf('class My_Subflow')).toBeLessThan(generated.code.indexOf('def run():'));
      expect(generated.code).toContain(">> My_Subflow(");
    });

    it('orders nested subflow classes before the outer class that uses them', () => {
      const innerSub = makeSimpleSubPipeline();
      const outerSub = {
        id: 'sf_outer', name: 'Outer Subflow', version: '1.0.0',
        steps: [
          { id: 'oi', label: 'Input 1', type: IRStepType.Read, operation: 'SubflowInput', params: { inputName: 'Input 1' }, inputs: [], imports: [] },
          {
            id: 'nested', label: 'Inner Subflow', type: IRStepType.Transform, operation: 'Subflow',
            params: { subflowId: 'sf_1' }, inputs: ['oi'], imports: [],
            subPipeline: innerSub,
            compositeParams: [], compositeParamOverrides: {},
            compositeOutputs: [{ sourceStepId: 'inner_filter', name: 'Output 1' }],
            compositeInputNames: ['Input 1'],
            compositeSourceName: 'My Subflow', compositeSourceId: 'sf_1',
          },
          { id: 'oo', label: 'Output 1', type: IRStepType.Write, operation: 'SubflowOutput', params: { outputName: 'Output 1' }, inputs: ['nested'], imports: [] },
        ],
        connections: [],
      };
      const pipeline = {
        id: 'p', name: 'Parent', version: '1.0.0',
        steps: [
          { id: 'src', label: 'Source', type: IRStepType.Read, operation: 'ReadFromCSV', params: { filePath: 'a.csv' }, inputs: [], imports: [] },
          {
            id: 'proxy', label: 'Outer Subflow', type: IRStepType.Transform, operation: 'Subflow',
            params: { subflowId: 'sf_outer' }, inputs: ['src'], imports: [],
            subPipeline: outerSub,
            compositeParams: [], compositeParamOverrides: {},
            compositeOutputs: [{ sourceStepId: 'nested', name: 'Output 1' }],
            compositeInputNames: ['Input 1'],
            compositeSourceName: 'Outer Subflow', compositeSourceId: 'sf_outer',
          },
        ],
        connections: [],
      };
      const generated = generatePythonBeam(pipeline as any);
      expect(generated.code.indexOf('class My_Subflow')).toBeLessThan(generated.code.indexOf('class Outer_Subflow'));
      expect(generated.code.indexOf('class Outer_Subflow')).toBeLessThan(generated.code.indexOf('def run():'));
    });

    it('emits one class and two instantiations when the same subflow is referenced twice', () => {
      const pipeline = {
        id: 'p', name: 'Parent', version: '1.0.0',
        steps: [
          { id: 'src', label: 'Source', type: IRStepType.Read, operation: 'ReadFromCSV', params: { filePath: 'a.csv' }, inputs: [], imports: [] },
          {
            id: 'proxy1', label: 'Subflow A', type: IRStepType.Transform, operation: 'Subflow',
            params: { subflowId: 'sf_1' }, inputs: ['src'], imports: [],
            subPipeline: makeSimpleSubPipeline(),
            compositeParams: [], compositeParamOverrides: {},
            compositeOutputs: [{ sourceStepId: 'inner_filter', name: 'Output 1' }],
            compositeInputNames: ['Input 1'],
            compositeSourceName: 'My Subflow', compositeSourceId: 'sf_1',
          },
          {
            id: 'proxy2', label: 'Subflow B', type: IRStepType.Transform, operation: 'Subflow',
            params: { subflowId: 'sf_1' }, inputs: ['proxy1'], imports: [],
            subPipeline: makeSimpleSubPipeline(),
            compositeParams: [], compositeParamOverrides: {},
            compositeOutputs: [{ sourceStepId: 'inner_filter', name: 'Output 1' }],
            compositeInputNames: ['Input 1'],
            compositeSourceName: 'My Subflow', compositeSourceId: 'sf_1',
          },
        ],
        connections: [],
      };
      const generated = generatePythonBeam(pipeline as any);
      expect(generated.code.match(/class My_Subflow\(beam\.PTransform\):/g)?.length).toBe(1);
      expect(generated.code.match(/>> My_Subflow\(\)/g)?.length).toBe(2);
    });

    it('handles multi-input subflows with a dict-keyed expand(self, pcolls)', () => {
      const subPipeline = {
        id: 'sf_multi', name: 'Multi Input', version: '1.0.0',
        steps: [
          { id: 'in_a', label: 'Input A', type: IRStepType.Read, operation: 'SubflowInput', params: { inputName: 'Input A' }, inputs: [], imports: [] },
          { id: 'in_b', label: 'Input B', type: IRStepType.Read, operation: 'SubflowInput', params: { inputName: 'Input B' }, inputs: [], imports: [] },
          { id: 'joined', label: 'Map', type: IRStepType.Transform, operation: 'Map', params: { expression: 'element' }, inputs: ['in_a'], imports: [] },
          { id: 'out', label: 'Output 1', type: IRStepType.Write, operation: 'SubflowOutput', params: { outputName: 'Output 1' }, inputs: ['joined'], imports: [] },
        ],
        connections: [],
      };
      const pipeline = {
        id: 'p', name: 'Parent', version: '1.0.0',
        steps: [
          { id: 'src_a', label: 'Source A', type: IRStepType.Read, operation: 'ReadFromCSV', params: { filePath: 'a.csv' }, inputs: [], imports: [] },
          { id: 'src_b', label: 'Source B', type: IRStepType.Read, operation: 'ReadFromCSV', params: { filePath: 'b.csv' }, inputs: [], imports: [] },
          {
            id: 'proxy', label: 'Multi Input', type: IRStepType.Transform, operation: 'Subflow',
            params: { subflowId: 'sf_multi' }, inputs: ['src_a', 'src_b'], imports: [],
            subPipeline,
            compositeParams: [], compositeParamOverrides: {},
            compositeOutputs: [{ sourceStepId: 'joined', name: 'Output 1' }],
            compositeInputNames: ['Input A', 'Input B'],
            compositeSourceName: 'Multi Input', compositeSourceId: 'sf_multi',
          },
        ],
        connections: [],
      };
      const generated = generatePythonBeam(pipeline as any);
      expect(generated.code).toContain('def expand(self, pcolls):');
      expect(generated.code).toContain("{'Input A':");
      expect(generated.code).toContain("'Input B':");
    });

    it('handles multi-output subflows with a dict return and bracket access at the use site', () => {
      const subPipeline = {
        id: 'sf_multi_out', name: 'Multi Output', version: '1.0.0',
        steps: [
          { id: 'in', label: 'Input 1', type: IRStepType.Read, operation: 'SubflowInput', params: { inputName: 'Input 1' }, inputs: [], imports: [] },
          { id: 'branch_a', label: 'Filter A', type: IRStepType.Transform, operation: 'Filter', params: { field: 'a', operator: '>', value: '0' }, inputs: ['in'], imports: [] },
          { id: 'branch_b', label: 'Filter B', type: IRStepType.Transform, operation: 'Filter', params: { field: 'b', operator: '>', value: '0' }, inputs: ['in'], imports: [] },
        ],
        connections: [],
      };
      const pipeline = {
        id: 'p', name: 'Parent', version: '1.0.0',
        steps: [
          { id: 'src', label: 'Source', type: IRStepType.Read, operation: 'ReadFromCSV', params: { filePath: 'a.csv' }, inputs: [], imports: [] },
          {
            id: 'proxy', label: 'Multi Output', type: IRStepType.Transform, operation: 'Subflow',
            params: { subflowId: 'sf_multi_out' }, inputs: ['src'], imports: [],
            subPipeline,
            compositeParams: [], compositeParamOverrides: {},
            compositeOutputs: [
              { sourceStepId: 'branch_a', name: 'Output A' },
              { sourceStepId: 'branch_b', name: 'Output B' },
            ],
            compositeInputNames: ['Input 1'],
            compositeSourceName: 'Multi Output', compositeSourceId: 'sf_multi_out',
          },
          { id: 'sink', label: 'Sink', type: IRStepType.Write, operation: 'WriteToCSV', params: { filePath: 'out.csv' }, inputs: ['proxy'], inputOutputKeys: ['Output A'], imports: [] },
        ],
        connections: [],
      };
      const generated = generatePythonBeam(pipeline as any);
      expect(generated.code).toContain("return {'Output A':");
      expect(generated.code).toContain("'Output B':");
      expect(generated.code).toContain("step_proxy['Output A']");
    });

    it('wires exposed subflow parameters to REAL __init__ constructor args, not baked-in literals', () => {
      const pipeline = {
        id: 'p', name: 'Parent', version: '1.0.0',
        steps: [
          { id: 'src', label: 'Source', type: IRStepType.Read, operation: 'ReadFromCSV', params: { filePath: 'a.csv' }, inputs: [], imports: [] },
          {
            id: 'proxy', label: 'My Subflow', type: IRStepType.Transform, operation: 'Subflow',
            params: { subflowId: 'sf_1' }, inputs: ['src'], imports: [],
            subPipeline: makeSimpleSubPipeline(),
            compositeParams: [
              { id: 'param_1', name: 'Min Age', type: 'string', defaultValue: '18', targetStepId: 'inner_filter', targetParamKey: 'value' },
            ],
            compositeParamOverrides: { param_1: '21' },
            compositeOutputs: [{ sourceStepId: 'inner_filter', name: 'Output 1' }],
            compositeInputNames: ['Input 1'],
            compositeSourceName: 'My Subflow', compositeSourceId: 'sf_1',
          },
        ],
        connections: [],
      };
      const generated = generatePythonBeam(pipeline as any);
      // Constructor accepts the parameter with its default value.
      expect(generated.code).toContain("def __init__(self, Min_Age='18'):");
      // The nested Filter's `value` reads the constructor arg, not a literal.
      expect(generated.code).toContain("FilterTransform(field='age', operator='>', value=self.Min_Age)");
      expect(generated.code).not.toContain("value='18'");
      // The usage site passes this instance's override.
      expect(generated.code).toContain("My_Subflow(Min_Age='21')");
    });
  });
});
