/**
 * @module @beamflow/beam-generator/generator
 *
 * Translates an IRPipeline into executable Apache Beam Python code.
 *
 * Architecture:
 * - Each IR operation type (ReadFromText, Filter, Map, etc.) has a
 *   dedicated emit function
 * - The generator walks IR steps in topological order, emitting Python
 *   for each step
 * - The PythonEmitter handles formatting, indentation, and imports
 *
 * Extension point:
 * - Add new operation handlers to the operationHandlers map
 * - Future generators (Java, TypeScript) implement the same interface
 *   but use different emitters
 */

import type { GeneratedPipeline } from '@beamflow/shared';
import type { IRPipeline, IRStep } from '@beamflow/ir';
import { PythonEmitter, toPythonVar, toPythonString } from './python-emitter.js';

/**
 * A handler that emits Python code for a specific IR operation.
 */
type OperationHandler = (
  step: IRStep,
  emitter: PythonEmitter,
  context: GenerationContext,
) => void;

/**
 * Context passed to operation handlers during code generation.
 */
interface GenerationContext {
  /** Map of step ID → Python variable name. */
  readonly varNames: Map<string, string>;
  /** The full pipeline for cross-referencing. */
  readonly pipeline: IRPipeline;
}

// ─── Operation Handlers ─────────────────────────────────────────────────────

const handleReadFromCSV: OperationHandler = (step, emitter, ctx) => {
  const varName = ctx.varNames.get(step.id)!;
  const filePath = step.params.filePath as string || '';
  const delimiter = step.params.delimiter as string || ',';
  const hasHeader = step.params.hasHeader as boolean ?? true;

  emitter.addImport('apache_beam as beam');
  emitter.addFromImport('apache_beam.io', 'ReadFromText');
  emitter.addImport('csv');
  emitter.addImport('io');

  emitter.blank();
  emitter.comment(`Read CSV: ${step.label}`);

  if (hasHeader) {
    // Parse CSV with headers
    emitter.addFromImport('apache_beam.io.filesystems', 'FileSystems');
    emitter.blank();
    emitter.line(`# Read CSV header locally first to avoid distributed parsing issues`);
    emitter.line(`with FileSystems.open('${toPythonString(filePath)}') as f:`);
    emitter.indent();
    emitter.line(`wrapper = io.TextIOWrapper(f, encoding='utf-8')`);
    emitter.line(`reader = csv.reader(wrapper, delimiter='${toPythonString(delimiter)}')`);
    emitter.line(`raw_header = next(reader)`);
    emitter.line(`header = [h.strip().lstrip('\\ufeff') for h in raw_header]`);
    emitter.dedent();
    emitter.blank();
    
    emitter.line(`${varName}_raw = p | '${step.label}_Read' >> ReadFromText('${toPythonString(filePath)}', skip_header_lines=1)`);
    
    emitter.line(`def parse_${toPythonVar(step.id)}(element, header_cols):`);
    emitter.indent();
    emitter.line(`reader = csv.reader(io.StringIO(element), delimiter='${toPythonString(delimiter)}')`);
    emitter.line(`for row in reader:`);
    emitter.indent();
    emitter.line(`clean_row = [v.strip() if isinstance(v, str) else v for v in row]`);
    emitter.line(`yield dict(zip(header_cols, clean_row))`);
    emitter.dedent();
    emitter.dedent();
    emitter.blank();
    
    emitter.line(`${varName} = ${varName}_raw | '${step.label}_Parse' >> beam.FlatMap(parse_${toPythonVar(step.id)}, header_cols=header)`);
  } else {
    // Parse CSV without headers — return list of values
    emitter.line(`${varName}_raw = p | '${step.label}_Read' >> ReadFromText('${toPythonString(filePath)}')`);
    emitter.line(`${varName} = ${varName}_raw | '${step.label}_Parse' >> beam.Map(lambda line: line.split('${toPythonString(delimiter)}'))`);
  }
};

const handleReadFromJSON: OperationHandler = (step, emitter, ctx) => {
  const varName = ctx.varNames.get(step.id)!;
  const filePath = step.params.filePath as string || '';

  emitter.addImport('apache_beam as beam');
  emitter.addFromImport('apache_beam.io', 'ReadFromText');
  emitter.addImport('json');

  emitter.blank();
  emitter.comment(`Read JSON: ${step.label}`);
  emitter.line(`${varName}_raw = p | '${step.label}_Read' >> ReadFromText('${toPythonString(filePath)}')`);
  emitter.line(`${varName} = ${varName}_raw | '${step.label}_Parse' >> beam.Map(json.loads)`);
};

const handleFilter: OperationHandler = (step, emitter, ctx) => {
  const varName = ctx.varNames.get(step.id)!;
  const inputVar = getInputVar(step, ctx);
  const field = step.params.field as string || '';
  const operator = step.params.operator as string || '==';
  const value = step.params.value as string || '';

  emitter.addImport('apache_beam as beam');

  emitter.blank();
  emitter.comment(`Filter: ${step.label}`);

  const condition = buildFilterCondition(field, operator, value);
  emitter.line(`${varName} = ${inputVar} | '${step.label}' >> beam.Filter(${condition})`);
};

const handleMap: OperationHandler = (step, emitter, ctx) => {
  const varName = ctx.varNames.get(step.id)!;
  const inputVar = getInputVar(step, ctx);
  const expression = step.params.expression as string || 'element';
  const outputField = step.params.outputField as string || '';

  emitter.addImport('apache_beam as beam');

  emitter.blank();
  emitter.comment(`Map: ${step.label}`);

  if (outputField) {
    // Add a new field to the record
    emitter.line(`def ${toPythonVar(step.id)}_map_fn(element):`);
    emitter.indent();
    emitter.line(`result = dict(element)`);
    emitter.line(`result['${toPythonString(outputField)}'] = ${expression}`);
    emitter.line(`return result`);
    emitter.dedent();
    emitter.blank();
    emitter.line(`${varName} = ${inputVar} | '${step.label}' >> beam.Map(${toPythonVar(step.id)}_map_fn)`);
  } else {
    emitter.line(`${varName} = ${inputVar} | '${step.label}' >> beam.Map(lambda element: ${expression})`);
  }
};

const handleGroupBy: OperationHandler = (step, emitter, ctx) => {
  const varName = ctx.varNames.get(step.id)!;
  const inputVar = getInputVar(step, ctx);
  const keyFields = step.params.keyFields as string[] || [];
  const aggregation = step.params.aggregation as string || 'count';
  const aggregateField = step.params.aggregateField as string || '';

  emitter.addImport('apache_beam as beam');
  emitter.addFromImport('apache_beam.transforms', 'combiners');

  emitter.blank();
  emitter.comment(`GroupBy: ${step.label}`);

  // Key extraction
  const keyExpr =
    keyFields.length === 1
      ? `lambda element: element.get('${toPythonString(keyFields[0])}', '')`
      : `lambda element: tuple(element.get(k, '') for k in ${JSON.stringify(keyFields)})`;

  emitter.line(`${varName}_keyed = ${inputVar} | '${step.label}_Key' >> beam.Map(lambda element: (${keyExpr.replace('lambda element: ', '')}(element) if callable(${keyExpr.replace('lambda element: ', '')}) else ${keyExpr.replace('lambda element: ', '')}(element), element))`);

  // Simplify: use direct key-value approach
  emitter.blank();
  emitter.line(`# Key-value pairs for grouping`);
  const valueExpr = aggregateField
    ? `float(el.get('${toPythonString(aggregateField)}', 0))`
    : `el`;

  emitter.line(`${varName}_kv = ${inputVar} | '${step.label}_ToKV' >> beam.Map(`);
  emitter.indent();
  if (keyFields.length === 1) {
    emitter.line(`lambda el: (el.get('${toPythonString(keyFields[0])}', ''), ${valueExpr})`);
  } else {
    emitter.line(`lambda el: (tuple(el.get(k, '') for k in ${JSON.stringify(keyFields)}), ${valueExpr})`);
  }
  emitter.dedent();
  emitter.line(`)`);

  // Aggregation
  const aggFunc = getAggregationFunction(aggregation, aggregateField);
  emitter.line(`${varName} = ${varName}_kv | '${step.label}_Group' >> ${aggFunc}`);
};

const handleWriteToCSV: OperationHandler = (step, emitter, ctx) => {
  const varName = ctx.varNames.get(step.id)!;
  const inputVar = getInputVar(step, ctx);
  const filePath = step.params.filePath as string || 'output.csv';
  const delimiter = step.params.delimiter as string || ',';
  const includeHeader = step.params.includeHeader as boolean ?? true;

  emitter.addImport('apache_beam as beam');
  emitter.addFromImport('apache_beam.io', 'WriteToText');

  emitter.blank();
  emitter.comment(`Write CSV: ${step.label}`);

  // Convert records to CSV lines
  emitter.line(`def ${toPythonVar(step.id)}_to_csv(element):`);
  emitter.indent();
  emitter.line(`if isinstance(element, dict):`);
  emitter.indent();
  emitter.line(`return '${toPythonString(delimiter)}'.join(str(v) for v in element.values())`);
  emitter.dedent();
  emitter.line(`return str(element)`);
  emitter.dedent();
  emitter.blank();

  emitter.line(`${varName}_csv = ${inputVar} | '${step.label}_Format' >> beam.Map(${toPythonVar(step.id)}_to_csv)`);

  if (includeHeader) {
    emitter.line(`# Note: Header writing requires collecting keys from the first element.`);
    emitter.line(`# For production use, consider a custom sink or post-processing step.`);
  }

  emitter.line(`${varName} = ${varName}_csv | '${step.label}_Write' >> WriteToText('${toPythonString(filePath)}')`);
};

// ─── Custom (user-authored) expression handlers ──────────────────────────────
// These back the browser-authored custom PTransform nodes. Each takes a raw
// Python `expression` evaluated over `element` and emits the corresponding
// lambda-based Beam transform. Kept separate from the built-in Map/Filter
// handlers so built-in behavior is untouched.

const handleMapExpr: OperationHandler = (step, emitter, ctx) => {
  const varName = ctx.varNames.get(step.id)!;
  const inputVar = getInputVar(step, ctx);
  const expression = (step.params.expression as string) || 'element';

  emitter.addImport('apache_beam as beam');
  emitter.blank();
  emitter.comment(`Custom Map: ${step.label}`);
  emitter.line(
    `${varName} = ${inputVar} | '${step.label}' >> beam.Map(lambda element: ${expression})`,
  );
};

const handleFilterExpr: OperationHandler = (step, emitter, ctx) => {
  const varName = ctx.varNames.get(step.id)!;
  const inputVar = getInputVar(step, ctx);
  const expression = (step.params.expression as string) || 'True';

  emitter.addImport('apache_beam as beam');
  emitter.blank();
  emitter.comment(`Custom Filter: ${step.label}`);
  emitter.line(
    `${varName} = ${inputVar} | '${step.label}' >> beam.Filter(lambda element: ${expression})`,
  );
};

const handleFlatMapExpr: OperationHandler = (step, emitter, ctx) => {
  const varName = ctx.varNames.get(step.id)!;
  const inputVar = getInputVar(step, ctx);
  const expression = (step.params.expression as string) || '[element]';

  emitter.addImport('apache_beam as beam');
  emitter.blank();
  emitter.comment(`Custom FlatMap: ${step.label}`);
  emitter.line(
    `${varName} = ${inputVar} | '${step.label}' >> beam.FlatMap(lambda element: ${expression})`,
  );
};

// ─── Handler Registry ───────────────────────────────────────────────────────

const operationHandlers = new Map<string, OperationHandler>([
  ['ReadFromCSV', handleReadFromCSV],
  ['ReadFromJSON', handleReadFromJSON],
  ['Filter', handleFilter],
  ['Map', handleMap],
  ['GroupBy', handleGroupBy],
  ['WriteToCSV', handleWriteToCSV],
  // Custom expression-based operations
  ['MapExpr', handleMapExpr],
  ['FilterExpr', handleFilterExpr],
  ['FlatMapExpr', handleFlatMapExpr],
]);

// ─── Helper Functions ───────────────────────────────────────────────────────

function getInputVar(step: IRStep, ctx: GenerationContext): string {
  if (step.inputs.length === 0) return 'p';
  return ctx.varNames.get(step.inputs[0]) || 'p';
}

function buildFilterCondition(
  field: string,
  operator: string,
  value: string,
): string {
  const accessExpr = `element.get('${toPythonString(field)}', '')`;

  switch (operator) {
    case '==':
      return `lambda element: str(${accessExpr}) == '${toPythonString(value)}'`;
    case '!=':
      return `lambda element: str(${accessExpr}) != '${toPythonString(value)}'`;
    case '>':
      return `lambda element: float(${accessExpr}) > ${value}`;
    case '<':
      return `lambda element: float(${accessExpr}) < ${value}`;
    case '>=':
      return `lambda element: float(${accessExpr}) >= ${value}`;
    case '<=':
      return `lambda element: float(${accessExpr}) <= ${value}`;
    case 'contains':
      return `lambda element: '${toPythonString(value)}' in str(${accessExpr})`;
    case 'regex':
      return `lambda element: bool(re.search(r'${toPythonString(value)}', str(${accessExpr})))`;
    case 'is_null':
      return `lambda element: ${accessExpr} is None or ${accessExpr} == ''`;
    default:
      return `lambda element: str(${accessExpr}) == '${toPythonString(value)}'`;
  }
}

function getAggregationFunction(
  aggregation: string,
  aggregateField: string,
): string {
  switch (aggregation) {
    case 'count':
      return `beam.combiners.Count.PerKey()`;
    case 'sum':
      return `beam.CombinePerKey(sum)`;
    case 'avg':
      return `beam.combiners.Mean.PerKey()`;
    case 'min':
      return `beam.CombinePerKey(min)`;
    case 'max':
      return `beam.CombinePerKey(max)`;
    default:
      return `beam.GroupByKey()`;
  }
}

// ─── Main Generator ─────────────────────────────────────────────────────────

/**
 * Generate Apache Beam Python code from an IR pipeline.
 *
 * @param pipeline - The IR pipeline to generate code for.
 * @returns A GeneratedPipeline containing the Python source code.
 */
export function generatePythonBeam(pipeline: IRPipeline): GeneratedPipeline {
  const emitter = new PythonEmitter();

  // Always-needed imports
  emitter.addImport('apache_beam as beam');
  emitter.addFromImport('apache_beam.options.pipeline_options', 'PipelineOptions');

  // Generate variable names for each step
  const varNames = new Map<string, string>();
  for (const step of pipeline.steps) {
    varNames.set(step.id, toPythonVar(`step_${step.id}`));
  }

  const context: GenerationContext = { varNames, pipeline };

  // Pipeline setup
  emitter.line(`def run():`);
  emitter.indent();
  emitter.line(`"""Run the ${pipeline.name} pipeline."""`);
  emitter.blank();

  // Pipeline options
  emitter.line(`pipeline_options = PipelineOptions([`);
  emitter.indent();
  const runner = pipeline.options?.runner || 'DirectRunner';
  emitter.line(`'--runner=${runner}',`);
  if (pipeline.options?.tempLocation) {
    emitter.line(`'--temp_location=${pipeline.options.tempLocation}',`);
  }
  emitter.dedent();
  emitter.line(`])`);
  emitter.blank();

  // Pipeline context manager
  emitter.line(`with beam.Pipeline(options=pipeline_options) as p:`);
  emitter.indent();

  // Emit each step
  for (const step of pipeline.steps) {
    const handler = operationHandlers.get(step.operation);
    if (!handler) {
      emitter.blank();
      emitter.comment(`WARNING: No handler for operation "${step.operation}"`);
      emitter.comment(`Step "${step.label}" was skipped.`);
      continue;
    }

    // Add step-specific imports
    for (const imp of step.imports) {
      if (imp.includes('.')) {
        const parts = imp.split('.');
        const module = parts.slice(0, -1).join('.');
        const name = parts[parts.length - 1];
        emitter.addFromImport(module, name);
      } else {
        emitter.addImport(imp);
      }
    }

    handler(step, emitter, context);
  }

  emitter.dedent(); // end 'with' block
  emitter.dedent(); // end function

  // Main block
  emitter.blank();
  emitter.blank();
  emitter.line(`if __name__ == '__main__':`);
  emitter.indent();
  emitter.line(`run()`);
  emitter.dedent();

  const code = emitter.build();

  return {
    code,
    filename: `${toPythonVar(pipeline.id)}_pipeline.py`,
    language: 'python',
    requirements: ['apache-beam'],
    irPipeline: pipeline,
  };
}

/**
 * Register a custom operation handler for code generation.
 * This is the extension point for adding support for new IR operations.
 */
export function registerOperationHandler(
  operation: string,
  handler: OperationHandler,
): void {
  operationHandlers.set(operation, handler);
}
