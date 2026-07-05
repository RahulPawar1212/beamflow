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
  });
});
