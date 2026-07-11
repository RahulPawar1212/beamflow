/**
 * @module @beamflow/beam-generator/generator
 *
 * Translates an IRPipeline into executable Apache Beam Python code.
 *
 * Architecture:
 * - Every operation — leaf (Filter, Map, GroupBy, ReadFromCSV, …), custom/
 *   composite (user-authored inlineIR chains), and subflow (nested IR) alike
 *   — compiles to its own reusable `class Foo(beam.PTransform)`. Each
 *   distinct "class key" is emitted exactly once; every usage site
 *   instantiates that class with its own constructor kwargs.
 * - `collectClassPlans` walks the IR post-order (children before parents,
 *   so a subflow's nested classes exist before the class that uses them),
 *   assigning each class key a collision-safe Python class name.
 * - The PythonEmitter handles formatting, indentation, and imports.
 *
 * Extension point:
 * - Add new leaf operation handlers to the operationHandlers map.
 * - Future generators (Java, TypeScript) implement the same interface
 *   but use different emitters.
 */

import type { GeneratedPipeline } from '@beamflow/shared';
import type { IRPipeline, IRStep } from '@beamflow/ir';
import { PythonEmitter, toPythonVar, toPythonString, pcollVarName, stepLabelName } from './python-emitter.js';

/**
 * Emits the body of a class's `expand(self, pcoll)` method (or, for the
 * top-level pipeline, the equivalent inline statement) for one step.
 */
type ExpandBodyEmitter = (
  step: IRStep,
  emitter: PythonEmitter,
  context: GenerationContext,
) => void;

/**
 * A handler for one leaf operation type. `emitClass` is called exactly once
 * per operation type (regardless of how many nodes use it); `instantiationKwargs`
 * is called once per usage site to compute that site's constructor call.
 */
interface OperationClassHandler {
  /** Python class name hint — sanitized/deduped by collectClassPlans. */
  classNameHint: string;
  /** Emit `class <Name>(beam.PTransform): ...` exactly once. */
  emitClass: (className: string, emitter: PythonEmitter, context: GenerationContext) => void;
  /** Compute this step's constructor kwargs, e.g. "field='age', operator='>'". */
  instantiationKwargs: (step: IRStep, context: GenerationContext) => string;
}

/**
 * Context passed to operation handlers during code generation.
 */
interface GenerationContext {
  /** Map of step ID → Python variable name (scoped to the pipeline currently being emitted). */
  readonly varNames: Map<string, string>;
  /** The IR pipeline currently being emitted (top-level or a subPipeline). */
  readonly pipeline: IRPipeline;
  /** Resolved class names, keyed by class key (operation name / compositeSourceId / custom node id). */
  readonly classPlan: ClassPlan;
  /**
   * Per-step param overrides, scoped to the pipeline currently being emitted:
   * stepId -> paramKey -> a Python source EXPRESSION (e.g. `self.min_age`)
   * to emit instead of a literal. Populated when a composite class's
   * expand() emits a nested step whose param is driven by one of the
   * composite's own constructor parameters (IRCompositeParameter).
   */
  readonly paramOverrides?: ReadonlyMap<string, ReadonlyMap<string, string>>;
  /**
   * Python expression that evaluates to the enclosing `beam.Pipeline`
   * object, valid in the scope currently being emitted. `'p'` at the top
   * level (bound by `with beam.Pipeline(...) as p:`); inside a composite's
   * expand(), `p` doesn't exist, so this is a `<some_pcoll>.pipeline`
   * expression instead. Source-type steps with zero inputs (ReadFromCSV/
   * JSON/SQL) use this to reach the Pipeline object when they're not the
   * outermost step in the file.
   */
  readonly pipelineVarExpr: string;
}

/** One planned class: its final Python name and how to emit/instantiate it. */
interface ClassPlanEntry {
  className: string;
  emitClass: (emitter: PythonEmitter, context: GenerationContext) => void;
}

/** Maps a class key (see collectClassPlans) to its planned emission. */
type ClassPlan = Map<string, ClassPlanEntry>;

// ─── Operation Handlers (one class per operation TYPE) ─────────────────────

const filterHandler: OperationClassHandler = {
  classNameHint: 'FilterTransform',
  emitClass: (className, emitter) => {
    emitter.addImport('apache_beam as beam');
    emitter.addImport('re');
    emitter.blank();
    emitter.line(`class ${className}(beam.PTransform):`);
    emitter.indent();
    emitter.line(`def __init__(self, field, operator, value):`);
    emitter.indent();
    emitter.line(`super().__init__()`);
    emitter.line(`self.field = field`);
    emitter.line(`self.operator = operator`);
    emitter.line(`self.value = value`);
    emitter.dedent();
    emitter.blank();
    emitter.line(`def expand(self, pcoll):`);
    emitter.indent();
    emitter.line(`condition = _build_filter_condition(self.field, self.operator, self.value)`);
    emitter.line(`return pcoll | 'Filter' >> beam.Filter(condition)`);
    emitter.dedent();
    emitter.dedent();
  },
  instantiationKwargs: (step, ctx) => {
    return [
      `field=${paramExpr(step, 'field', ctx, '')}`,
      `operator=${paramExpr(step, 'operator', ctx, '==')}`,
      `value=${paramExpr(step, 'value', ctx, '')}`,
    ].join(', ');
  },
};

const mapHandler: OperationClassHandler = {
  classNameHint: 'MapTransform',
  emitClass: (className, emitter) => {
    emitter.addImport('apache_beam as beam');
    emitter.blank();
    emitter.line(`class ${className}(beam.PTransform):`);
    emitter.indent();
    emitter.line(`def __init__(self, expression, output_field=''):`);
    emitter.indent();
    emitter.line(`super().__init__()`);
    emitter.line(`self.expression = expression`);
    emitter.line(`self.output_field = output_field`);
    emitter.dedent();
    emitter.blank();
    emitter.line(`def expand(self, pcoll):`);
    emitter.indent();
    emitter.line(`if self.output_field:`);
    emitter.indent();
    emitter.line(`def map_fn(element, expression=self.expression, output_field=self.output_field):`);
    emitter.indent();
    emitter.line(`result = dict(element)`);
    emitter.line(`result[output_field] = eval(expression, {}, {'element': element})`);
    emitter.line(`return result`);
    emitter.dedent();
    emitter.line(`return pcoll | 'Map' >> beam.Map(map_fn)`);
    emitter.dedent();
    emitter.line(`return pcoll | 'Map' >> beam.Map(lambda element, expression=self.expression: eval(expression, {}, {'element': element}))`);
    emitter.dedent();
    emitter.dedent();
  },
  instantiationKwargs: (step, ctx) => {
    return [
      `expression=${paramExpr(step, 'expression', ctx, 'element')}`,
      `output_field=${paramExpr(step, 'outputField', ctx, '')}`,
    ].join(', ');
  },
};

const groupByHandler: OperationClassHandler = {
  classNameHint: 'GroupByTransform',
  emitClass: (className, emitter) => {
    emitter.addImport('apache_beam as beam');
    emitter.addFromImport('apache_beam.transforms', 'combiners');
    emitter.blank();
    emitter.line(`class ${className}(beam.PTransform):`);
    emitter.indent();
    emitter.line(`def __init__(self, key_fields, aggregation='count', aggregate_field=''):`);
    emitter.indent();
    emitter.line(`super().__init__()`);
    emitter.line(`self.key_fields = key_fields`);
    emitter.line(`self.aggregation = aggregation`);
    emitter.line(`self.aggregate_field = aggregate_field`);
    emitter.dedent();
    emitter.blank();
    emitter.line(`def _key_value(self, el):`);
    emitter.indent();
    emitter.line(`if len(self.key_fields) == 1:`);
    emitter.indent();
    emitter.line(`key = el.get(self.key_fields[0], '')`);
    emitter.dedent();
    emitter.line(`else:`);
    emitter.indent();
    emitter.line(`key = tuple(el.get(k, '') for k in self.key_fields)`);
    emitter.dedent();
    emitter.line(`value = float(el.get(self.aggregate_field, 0)) if self.aggregate_field else el`);
    emitter.line(`return (key, value)`);
    emitter.dedent();
    emitter.blank();
    emitter.line(`def expand(self, pcoll):`);
    emitter.indent();
    emitter.line(`kv = pcoll | 'GroupBy_ToKV' >> beam.Map(self._key_value)`);
    emitter.line(`if self.aggregation == 'sum':`);
    emitter.indent();
    emitter.line(`return kv | 'GroupBy_Group' >> beam.CombinePerKey(sum)`);
    emitter.dedent();
    emitter.line(`if self.aggregation == 'avg':`);
    emitter.indent();
    emitter.line(`return kv | 'GroupBy_Group' >> beam.combiners.Mean.PerKey()`);
    emitter.dedent();
    emitter.line(`if self.aggregation == 'min':`);
    emitter.indent();
    emitter.line(`return kv | 'GroupBy_Group' >> beam.CombinePerKey(min)`);
    emitter.dedent();
    emitter.line(`if self.aggregation == 'max':`);
    emitter.indent();
    emitter.line(`return kv | 'GroupBy_Group' >> beam.CombinePerKey(max)`);
    emitter.dedent();
    emitter.line(`return kv | 'GroupBy_Group' >> beam.combiners.Count.PerKey()`);
    emitter.dedent();
    emitter.dedent();
  },
  instantiationKwargs: (step, ctx) => {
    return [
      `key_fields=${paramExpr(step, 'keyFields', ctx, [])}`,
      `aggregation=${paramExpr(step, 'aggregation', ctx, 'count')}`,
      `aggregate_field=${paramExpr(step, 'aggregateField', ctx, '')}`,
    ].join(', ');
  },
};

const readFromCSVHandler: OperationClassHandler = {
  classNameHint: 'ReadFromCSVTransform',
  emitClass: (className, emitter) => {
    emitter.addImport('apache_beam as beam');
    emitter.addFromImport('apache_beam.io', 'ReadFromText');
    emitter.addFromImport('apache_beam.io.filesystems', 'FileSystems');
    emitter.addImport('csv');
    emitter.addImport('io');
    emitter.blank();
    emitter.line(`class ${className}(beam.PTransform):`);
    emitter.indent();
    emitter.line(`def __init__(self, file_path, delimiter=',', has_header=True):`);
    emitter.indent();
    emitter.line(`super().__init__()`);
    emitter.line(`self.file_path = file_path`);
    emitter.line(`self.delimiter = delimiter`);
    emitter.line(`self.has_header = has_header`);
    emitter.dedent();
    emitter.blank();
    emitter.line(`def expand(self, pcoll):`);
    emitter.indent();
    emitter.line(`p = pcoll.pipeline`);
    emitter.line(`if not self.has_header:`);
    emitter.indent();
    emitter.line(`raw = p | 'ReadFromCSV_Read' >> ReadFromText(self.file_path)`);
    emitter.line(`return raw | 'ReadFromCSV_Parse' >> beam.Map(lambda line: line.split(self.delimiter))`);
    emitter.dedent();
    emitter.line(`with FileSystems.open(self.file_path) as f:`);
    emitter.indent();
    emitter.line(`wrapper = io.TextIOWrapper(f, encoding='utf-8')`);
    emitter.line(`reader = csv.reader(wrapper, delimiter=self.delimiter)`);
    emitter.line(`raw_header = next(reader)`);
    emitter.line(`header = [h.strip().lstrip('\\ufeff') for h in raw_header]`);
    emitter.dedent();
    emitter.line(`def parse(element, header_cols):`);
    emitter.indent();
    emitter.line(`reader = csv.reader(io.StringIO(element), delimiter=self.delimiter)`);
    emitter.line(`for row in reader:`);
    emitter.indent();
    emitter.line(`clean_row = [v.strip() if isinstance(v, str) else v for v in row]`);
    emitter.line(`yield dict(zip(header_cols, clean_row))`);
    emitter.dedent();
    emitter.dedent();
    emitter.line(`raw = p | 'ReadFromCSV_Read' >> ReadFromText(self.file_path, skip_header_lines=1)`);
    emitter.line(`return raw | 'ReadFromCSV_Parse' >> beam.FlatMap(parse, header_cols=header)`);
    emitter.dedent();
    emitter.dedent();
  },
  instantiationKwargs: (step, ctx) => {
    return [
      `file_path=${paramExpr(step, 'filePath', ctx, '')}`,
      `delimiter=${paramExpr(step, 'delimiter', ctx, ',')}`,
      `has_header=${paramExpr(step, 'hasHeader', ctx, true)}`,
    ].join(', ');
  },
};

const readFromJSONHandler: OperationClassHandler = {
  classNameHint: 'ReadFromJSONTransform',
  emitClass: (className, emitter) => {
    emitter.addImport('apache_beam as beam');
    emitter.addFromImport('apache_beam.io', 'ReadFromText');
    emitter.addImport('json');
    emitter.blank();
    emitter.line(`class ${className}(beam.PTransform):`);
    emitter.indent();
    emitter.line(`def __init__(self, file_path):`);
    emitter.indent();
    emitter.line(`super().__init__()`);
    emitter.line(`self.file_path = file_path`);
    emitter.dedent();
    emitter.blank();
    emitter.line(`def expand(self, pcoll):`);
    emitter.indent();
    emitter.line(`p = pcoll.pipeline`);
    emitter.line(`raw = p | 'ReadFromJSON_Read' >> ReadFromText(self.file_path)`);
    emitter.line(`return raw | 'ReadFromJSON_Parse' >> beam.Map(json.loads)`);
    emitter.dedent();
    emitter.dedent();
  },
  instantiationKwargs: (step, ctx) => {
    return `file_path=${paramExpr(step, 'filePath', ctx, '')}`;
  },
};

const readFromSQLHandler: OperationClassHandler = {
  classNameHint: 'ReadFromSQLTransform',
  emitClass: (className, emitter) => {
    emitter.addImport('apache_beam as beam');
    emitter.addImport('sqlalchemy');
    emitter.blank();
    emitter.line(`class _${className}ExecuteSQL(beam.DoFn):`);
    emitter.indent();
    emitter.line(`def __init__(self, conn_str):`);
    emitter.indent();
    emitter.line(`self.conn_str = conn_str`);
    emitter.dedent();
    emitter.blank();
    emitter.line(`def process(self, query):`);
    emitter.indent();
    emitter.line(`engine = sqlalchemy.create_engine(self.conn_str)`);
    emitter.line(`with engine.connect() as conn:`);
    emitter.indent();
    emitter.line(`result = conn.execute(sqlalchemy.text(query))`);
    emitter.line(`keys = list(result.keys())`);
    emitter.line(`for row in result:`);
    emitter.indent();
    emitter.line(`yield dict(zip(keys, row))`);
    emitter.dedent();
    emitter.dedent();
    emitter.dedent();
    emitter.dedent();
    emitter.blank();
    emitter.line(`class ${className}(beam.PTransform):`);
    emitter.indent();
    emitter.line(`def __init__(self, connection_string, sql_query):`);
    emitter.indent();
    emitter.line(`super().__init__()`);
    emitter.line(`self.connection_string = connection_string`);
    emitter.line(`self.sql_query = sql_query`);
    emitter.dedent();
    emitter.blank();
    emitter.line(`def expand(self, pcoll):`);
    emitter.indent();
    emitter.line(`p = pcoll.pipeline`);
    emitter.line(`return (`);
    emitter.indent();
    emitter.line(`p | 'ReadFromSQL_Query' >> beam.Create([self.sql_query])`);
    emitter.line(`| 'ReadFromSQL_Execute' >> beam.ParDo(_${className}ExecuteSQL(self.connection_string))`);
    emitter.dedent();
    emitter.line(`)`);
    emitter.dedent();
    emitter.dedent();
  },
  instantiationKwargs: (step, ctx) => {
    // The mssql/pyodbc driver rewrite below is a build-time string transform
    // and can't run on a runtime `self.xxx` expression — when this param is
    // driven by an enclosing composite's constructor arg, pass it through
    // as-is (the driver rewrite only applies to literal connection strings).
    const connectionOverride = ctx.paramOverrides?.get(step.id)?.get('connectionString');
    let connectionStringExpr: string;
    if (connectionOverride !== undefined) {
      connectionStringExpr = connectionOverride;
    } else {
      let connectionString = (step.params.connectionString as string) || '';
      // Use pymssql for standard SQL Server auth, but pyodbc for Windows Auth
      if (connectionString.startsWith('mssql://') || connectionString.startsWith('sqlserver://')) {
        try {
          const url = new URL(connectionString.replace(/^sqlserver:\/\//i, 'mssql://'));
          const isWindowsAuth = url.searchParams.get('integratedSecurity') === 'true';

          if (isWindowsAuth) {
            const serverName = url.hostname;
            const portName = url.port && url.port !== '1433' ? `,${url.port}` : '';
            const dbName = url.pathname.replace(/^\//, '');
            const odbcString = `Driver={ODBC Driver 18 for SQL Server};Server=${serverName}${portName};Database=${dbName};Trusted_Connection=yes;Encrypt=no;TrustServerCertificate=yes;`;
            connectionString = `mssql+pyodbc:///?odbc_connect=${encodeURIComponent(odbcString)}`;
          } else {
            url.protocol = 'mssql+pymssql:';
            connectionString = url.toString();
          }
        } catch (e) {
          connectionString = connectionString
            .replace(/^mssql:\/\//i, 'mssql+pymssql://')
            .replace(/^sqlserver:\/\//i, 'mssql+pymssql://');
        }
      }
      connectionStringExpr = formatPyLiteral(connectionString);
    }

    return `connection_string=${connectionStringExpr}, sql_query=${paramExpr(step, 'sqlQuery', ctx, '')}`;
  },
};

const writeToCSVHandler: OperationClassHandler = {
  classNameHint: 'WriteToCSVTransform',
  emitClass: (className, emitter) => {
    emitter.addImport('apache_beam as beam');
    emitter.addFromImport('apache_beam.io', 'WriteToText');
    emitter.blank();
    emitter.line(`class ${className}(beam.PTransform):`);
    emitter.indent();
    emitter.line(`def __init__(self, file_path='output.csv', delimiter=',', include_header=True):`);
    emitter.indent();
    emitter.line(`super().__init__()`);
    emitter.line(`self.file_path = file_path`);
    emitter.line(`self.delimiter = delimiter`);
    emitter.line(`self.include_header = include_header`);
    emitter.dedent();
    emitter.blank();
    emitter.line(`def _to_csv(self, element):`);
    emitter.indent();
    emitter.line(`if isinstance(element, dict):`);
    emitter.indent();
    emitter.line(`return self.delimiter.join(str(v) for v in element.values())`);
    emitter.dedent();
    emitter.line(`return str(element)`);
    emitter.dedent();
    emitter.blank();
    emitter.line(`def expand(self, pcoll):`);
    emitter.indent();
    emitter.line(`# Note: Header writing requires collecting keys from the first element.`);
    emitter.line(`# For production use, consider a custom sink or post-processing step.`);
    emitter.line(`csv_lines = pcoll | 'WriteToCSV_Format' >> beam.Map(self._to_csv)`);
    emitter.line(`return csv_lines | 'WriteToCSV_Write' >> WriteToText(self.file_path)`);
    emitter.dedent();
    emitter.dedent();
  },
  instantiationKwargs: (step, ctx) => {
    return [
      `file_path=${paramExpr(step, 'filePath', ctx, 'output.csv')}`,
      `delimiter=${paramExpr(step, 'delimiter', ctx, ',')}`,
      `include_header=${paramExpr(step, 'includeHeader', ctx, true)}`,
    ].join(', ');
  },
};

// ─── Custom (user-authored) expression handlers ──────────────────────────────
// These back the browser-authored custom PTransform nodes. Each takes a raw
// Python `expression` evaluated over `element` and emits the corresponding
// lambda-based Beam transform. Kept separate from the built-in Map/Filter
// handlers so built-in behavior is untouched.

const mapExprHandler: OperationClassHandler = {
  classNameHint: 'MapExprTransform',
  emitClass: (className, emitter) => {
    emitter.addImport('apache_beam as beam');
    emitter.blank();
    emitter.line(`class ${className}(beam.PTransform):`);
    emitter.indent();
    emitter.line(`def __init__(self, expression='element'):`);
    emitter.indent();
    emitter.line(`super().__init__()`);
    emitter.line(`self.expression = expression`);
    emitter.dedent();
    emitter.blank();
    emitter.line(`def expand(self, pcoll):`);
    emitter.indent();
    emitter.line(`return pcoll | 'MapExpr' >> beam.Map(lambda element, expression=self.expression: eval(expression, {}, {'element': element}))`);
    emitter.dedent();
    emitter.dedent();
  },
  instantiationKwargs: (step, ctx) => {
    return `expression=${paramExpr(step, 'expression', ctx, 'element')}`;
  },
};

const filterExprHandler: OperationClassHandler = {
  classNameHint: 'FilterExprTransform',
  emitClass: (className, emitter) => {
    emitter.addImport('apache_beam as beam');
    emitter.blank();
    emitter.line(`class ${className}(beam.PTransform):`);
    emitter.indent();
    emitter.line(`def __init__(self, expression='True'):`);
    emitter.indent();
    emitter.line(`super().__init__()`);
    emitter.line(`self.expression = expression`);
    emitter.dedent();
    emitter.blank();
    emitter.line(`def expand(self, pcoll):`);
    emitter.indent();
    emitter.line(`return pcoll | 'FilterExpr' >> beam.Filter(lambda element, expression=self.expression: eval(expression, {}, {'element': element}))`);
    emitter.dedent();
    emitter.dedent();
  },
  instantiationKwargs: (step, ctx) => {
    return `expression=${paramExpr(step, 'expression', ctx, 'True')}`;
  },
};

const flatMapExprHandler: OperationClassHandler = {
  classNameHint: 'FlatMapExprTransform',
  emitClass: (className, emitter) => {
    emitter.addImport('apache_beam as beam');
    emitter.blank();
    emitter.line(`class ${className}(beam.PTransform):`);
    emitter.indent();
    emitter.line(`def __init__(self, expression='[element]'):`);
    emitter.indent();
    emitter.line(`super().__init__()`);
    emitter.line(`self.expression = expression`);
    emitter.dedent();
    emitter.blank();
    emitter.line(`def expand(self, pcoll):`);
    emitter.indent();
    emitter.line(`return pcoll | 'FlatMapExpr' >> beam.FlatMap(lambda element, expression=self.expression: eval(expression, {}, {'element': element}))`);
    emitter.dedent();
    emitter.dedent();
  },
  instantiationKwargs: (step, ctx) => {
    return `expression=${paramExpr(step, 'expression', ctx, '[element]')}`;
  },
};

// ─── Handler Registry ───────────────────────────────────────────────────────

const operationHandlers = new Map<string, OperationClassHandler>([
  ['ReadFromSQL', readFromSQLHandler],
  ['ReadFromCSV', readFromCSVHandler],
  ['ReadFromJSON', readFromJSONHandler],
  ['Filter', filterHandler],
  ['Map', mapHandler],
  ['GroupBy', groupByHandler],
  ['WriteToCSV', writeToCSVHandler],
  // Custom expression-based operations
  ['MapExpr', mapExprHandler],
  ['FilterExpr', filterExprHandler],
  ['FlatMapExpr', flatMapExprHandler],
]);

// ─── Helper Functions ───────────────────────────────────────────────────────

function getInputVar(step: IRStep, ctx: GenerationContext): string {
  if (step.inputs.length === 0) return ctx.pipelineVarExpr;
  return inputVarExpr(step, 0, ctx);
}

/**
 * Resolve the Python expression for the step's Nth input, subscripting by
 * named output key (`varName['Output Name']`) when that input references a
 * specific output of an upstream multi-output composite step.
 */
function inputVarExpr(step: IRStep, index: number, ctx: GenerationContext): string {
  const varName = ctx.varNames.get(step.inputs[index]) || 'p';
  const key = step.inputOutputKeys?.[index];
  return key ? `${varName}['${toPythonString(key)}']` : varName;
}

/** Module-level helper shared by every FilterTransform instance. */
function emitFilterConditionHelper(emitter: PythonEmitter): void {
  emitter.line(`def _build_filter_condition(field, operator, value):`);
  emitter.indent();
  emitter.line(`access = lambda element: element.get(field, '')`);
  emitter.line(`if operator == '==':`);
  emitter.indent();
  emitter.line(`return lambda element: str(access(element)) == value`);
  emitter.dedent();
  emitter.line(`if operator == '!=':`);
  emitter.indent();
  emitter.line(`return lambda element: str(access(element)) != value`);
  emitter.dedent();
  emitter.line(`if operator == '>':`);
  emitter.indent();
  emitter.line(`return lambda element: float(access(element)) > float(value)`);
  emitter.dedent();
  emitter.line(`if operator == '<':`);
  emitter.indent();
  emitter.line(`return lambda element: float(access(element)) < float(value)`);
  emitter.dedent();
  emitter.line(`if operator == '>=':`);
  emitter.indent();
  emitter.line(`return lambda element: float(access(element)) >= float(value)`);
  emitter.dedent();
  emitter.line(`if operator == '<=':`);
  emitter.indent();
  emitter.line(`return lambda element: float(access(element)) <= float(value)`);
  emitter.dedent();
  emitter.line(`if operator == 'contains':`);
  emitter.indent();
  emitter.line(`return lambda element: value in str(access(element))`);
  emitter.dedent();
  emitter.line(`if operator == 'regex':`);
  emitter.indent();
  emitter.line(`return lambda element: bool(re.search(value, str(access(element))))`);
  emitter.dedent();
  emitter.line(`if operator == 'is_null':`);
  emitter.indent();
  emitter.line(`return lambda element: access(element) is None or access(element) == ''`);
  emitter.dedent();
  emitter.line(`return lambda element: str(access(element)) == value`);
  emitter.dedent();
}

/**
 * Assign each unique class key a collision-safe, valid Python class name.
 */
function uniqueClassName(hint: string, used: Set<string>): string {
  let base = hint.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^([0-9])/, '_$1');
  if (!base) base = 'Transform';
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base}_${suffix}`;
    suffix++;
  }
  used.add(candidate);
  return candidate;
}

/**
 * Walk the IR (top-level + every nested subPipeline, post-order — children
 * before parents) and build a single ClassPlan shared by the whole file, so
 * a class key used both inside a subflow and at the top level still emits
 * exactly once.
 */
function collectClassPlans(pipeline: IRPipeline, plan: ClassPlan, usedNames: Set<string>): void {
  for (const step of pipeline.steps) {
    if (step.subPipeline) {
      // Children first, so nested subflow/leaf classes are defined before
      // the class that uses them.
      collectClassPlans(step.subPipeline, plan, usedNames);

      const key = step.compositeSourceId ?? `__anon_composite_${step.id}`;
      if (!plan.has(key)) {
        const className = uniqueClassName(step.compositeSourceName || 'Subflow', usedNames);
        plan.set(key, {
          className,
          emitClass: (emitter, ctx) => emitCompositeClass(className, step, emitter, ctx),
        });
      }
      continue;
    }

    if (operationHandlers.has(step.operation)) {
      const key = step.operation;
      if (!plan.has(key)) {
        const handler = operationHandlers.get(step.operation)!;
        const className = uniqueClassName(handler.classNameHint, usedNames);
        plan.set(key, {
          className,
          emitClass: (emitter, ctx) => handler.emitClass(className, emitter, ctx),
        });
      }
      continue;
    }
    // SubflowInput/SubflowOutput and unknown operations are handled at
    // emission time (virtual passthrough / warning comment) — no class.
  }
}

/**
 * Emit one step's instantiation line: `varName = inputExpr | 'Label' >> ClassName(kwargs)`.
 * Shared by both the top-level `run()` body and a composite's `expand()` body.
 */
function emitStepInstantiation(step: IRStep, emitter: PythonEmitter, ctx: GenerationContext): void {
  const varName = ctx.varNames.get(step.id)!;

  if (step.subPipeline) {
    const key = step.compositeSourceId ?? `__anon_composite_${step.id}`;
    const entry = ctx.classPlan.get(key)!;
    const inputExpr = compositeInputExpr(step, ctx);
    const kwargs = compositeInstantiationKwargs(step);
    emitter.blank();
    emitter.comment(`Subflow: ${step.label}`);
    emitter.line(`${varName} = ${inputExpr} | '${stepLabelName(step.label, step.id)}' >> ${entry.className}(${kwargs})`);
    return;
  }

  const handler = operationHandlers.get(step.operation);
  if (!handler) {
    emitter.blank();
    emitter.comment(`WARNING: No handler for operation "${step.operation}"`);
    emitter.comment(`Step "${step.label}" was skipped.`);
    return;
  }

  const entry = ctx.classPlan.get(step.operation)!;
  const inputVar = getInputVar(step, ctx);
  const kwargs = handler.instantiationKwargs(step, ctx);
  emitter.blank();
  emitter.comment(`${step.label}`);
  emitter.line(`${varName} = ${inputVar} | '${stepLabelName(step.label, step.id)}' >> ${entry.className}(${kwargs})`);

  for (const imp of step.imports) {
    addStepImport(emitter, imp);
  }
}

function addStepImport(emitter: PythonEmitter, imp: string): void {
  if (imp.includes('.')) {
    const parts = imp.split('.');
    const module = parts.slice(0, -1).join('.');
    const name = parts[parts.length - 1];
    emitter.addFromImport(module, name);
  } else {
    emitter.addImport(imp);
  }
}

function compositeInputExpr(step: IRStep, ctx: GenerationContext): string {
  const inputNames = step.compositeInputNames ?? ['in'];
  if (inputNames.length <= 1) {
    return getInputVar(step, ctx);
  }
  const entries = inputNames.map((name, i) => {
    return `'${toPythonString(name)}': ${inputVarExpr(step, i, ctx)}`;
  });
  return `{${entries.join(', ')}}`;
}

function compositeInstantiationKwargs(step: IRStep): string {
  const params = step.compositeParams ?? [];
  if (params.length === 0) return '';
  return params
    .map((p) => {
      const override = step.compositeParamOverrides?.[p.id];
      const value = override !== undefined ? override : p.defaultValue;
      return `${toPythonVar(p.name)}=${formatPyLiteral(value)}`;
    })
    .join(', ');
}

function formatPyLiteral(value: unknown): string {
  if (typeof value === 'string') return `'${toPythonString(value)}'`;
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (value === null || value === undefined) return 'None';
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return `[${value.map(formatPyLiteral).join(', ')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    return `{${entries.map(([k, v]) => `'${toPythonString(k)}': ${formatPyLiteral(v)}`).join(', ')}}`;
  }
  return `'${toPythonString(JSON.stringify(value))}'`;
}

/**
 * Resolve one param of a step to a Python source expression: either a real
 * reference to the enclosing composite's constructor arg (`self.min_age`),
 * when this step's param is driven by one of the composite's
 * IRCompositeParameters, or a literal formatted from `step.params[key]`
 * otherwise. Every leaf operation handler's instantiationKwargs should read
 * params through this helper instead of formatting `step.params[key]`
 * directly, so composite parameterization is genuine rather than baked-in.
 */
function paramExpr(step: IRStep, key: string, ctx: GenerationContext, fallback: unknown): string {
  const override = ctx.paramOverrides?.get(step.id)?.get(key);
  if (override !== undefined) return override;
  return formatPyLiteral(step.params[key] ?? fallback);
}

/**
 * Emit one composite (subflow) step's PTransform class, recursively emitting
 * its nested pipeline as the `expand()` body.
 */
function emitCompositeClass(
  className: string,
  step: IRStep,
  emitter: PythonEmitter,
  ctx: GenerationContext,
): void {
  emitter.addImport('apache_beam as beam');
  const subPipeline = step.subPipeline!;
  const params = step.compositeParams ?? [];
  const inputNames = step.compositeInputNames ?? ['in'];
  const outputs = step.compositeOutputs ?? [];

  emitter.blank();
  const ctorArgs = params.map((p) => `${toPythonVar(p.name)}=${formatPyLiteral(p.defaultValue)}`);
  emitter.line(`class ${className}(beam.PTransform):`);
  emitter.indent();
  emitter.line(`def __init__(self${ctorArgs.length ? ', ' + ctorArgs.join(', ') : ''}):`);
  emitter.indent();
  emitter.line(`super().__init__()`);
  for (const p of params) {
    emitter.line(`self.${toPythonVar(p.name)} = ${toPythonVar(p.name)}`);
  }
  emitter.dedent();
  emitter.blank();

  const expandArg = inputNames.length > 1 ? 'pcolls' : 'pcoll';
  emitter.line(`def expand(self, ${expandArg}):`);
  emitter.indent();

  const nestedVarNames = new Map<string, string>();
  for (const s of subPipeline.steps) {
    nestedVarNames.set(s.id, pcollVarName(s.label, s.id));
  }

  // Real constructor parameterization: any nested step whose param is
  // driven by one of this composite's own IRCompositeParameters reads
  // `self.<argname>` instead of a baked-in literal.
  const nestedParamOverrides = new Map<string, Map<string, string>>();
  for (const p of params) {
    if (!nestedParamOverrides.has(p.targetStepId)) {
      nestedParamOverrides.set(p.targetStepId, new Map());
    }
    nestedParamOverrides.get(p.targetStepId)!.set(p.targetParamKey, `self.${toPythonVar(p.name)}`);
  }

  const nestedCtx: GenerationContext = {
    varNames: nestedVarNames,
    pipeline: subPipeline,
    classPlan: ctx.classPlan,
    paramOverrides: nestedParamOverrides,
    // Inside expand(), there is no top-level `p` — only pcoll/pcolls exist.
    // A nested step with zero inputs (e.g. a source node placed directly
    // inside a subflow/custom node, rather than reading from a
    // SubflowInput boundary) still needs the real Pipeline object to attach
    // to, which we bind as a local `p` below when needed.
    pipelineVarExpr: 'p',
  };

  const needsPipelineVar = subPipeline.steps.some(
    (s) => s.operation !== 'SubflowInput' && s.operation !== 'SubflowOutput' && s.inputs.length === 0,
  );
  if (needsPipelineVar) {
    const pipelineSource = inputNames.length > 1 ? `next(iter(${expandArg}.values()))` : expandArg;
    emitter.line(`p = ${pipelineSource}.pipeline`);
  }

  // Bind SubflowInput steps directly to the incoming pcoll(s) — virtual,
  // never dispatched to a handler.
  for (const s of subPipeline.steps) {
    if (s.operation === 'SubflowInput') {
      const inputName = (s.params.inputName as string) || '';
      const idx = inputNames.indexOf(inputName);
      const boundExpr =
        inputNames.length > 1
          ? `pcolls['${toPythonString(idx >= 0 ? inputName : inputNames[0])}']`
          : 'pcoll';
      nestedVarNames.set(s.id, boundExpr);
    }
  }

  for (const s of subPipeline.steps) {
    if (s.operation === 'SubflowInput' || s.operation === 'SubflowOutput') {
      // Passthrough boundary nodes — no code emitted; SubflowInput is
      // pre-bound above, SubflowOutput's producing step already carries
      // the real value used in the final `return` below.
      continue;
    }
    emitStepInstantiation(s, emitter, nestedCtx);
  }

  emitter.blank();
  if (outputs.length <= 1) {
    const sourceId = outputs[0]?.sourceStepId;
    const returnVar = sourceId ? nestedVarNames.get(sourceId) : undefined;
    emitter.line(`return ${returnVar ?? 'pcoll'}`);
  } else {
    const entries = outputs.map((o, i) => {
      const key = o.name || `output_${i}`;
      return `'${toPythonString(key)}': ${nestedVarNames.get(o.sourceStepId)}`;
    });
    emitter.line(`return {${entries.join(', ')}}`);
  }

  emitter.dedent();
  emitter.dedent();
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

  // ── 1. Collect + emit every distinct PTransform class, post-order ────────
  const classPlan: ClassPlan = new Map();
  const usedClassNames = new Set<string>();
  collectClassPlans(pipeline, classPlan, usedClassNames);

  const usesFilter = pipelineUsesOperation(pipeline, 'Filter');
  if (usesFilter) {
    emitFilterConditionHelper(emitter);
    emitter.blank();
  }

  const topVarNames = new Map<string, string>();
  for (const step of pipeline.steps) {
    topVarNames.set(step.id, pcollVarName(step.label, step.id));
  }
  const topContext: GenerationContext = { varNames: topVarNames, pipeline, classPlan, pipelineVarExpr: 'p' };

  for (const entry of classPlan.values()) {
    entry.emitClass(emitter, topContext);
  }

  // ── 2. Emit run() — a composition of top-level PTransform instances ──────
  emitter.blank();
  emitter.blank();
  emitter.line(`def run():`);
  emitter.indent();
  emitter.line(`"""Run the ${pipeline.name} pipeline."""`);
  emitter.blank();

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

  emitter.line(`with beam.Pipeline(options=pipeline_options) as p:`);
  emitter.indent();

  for (const step of pipeline.steps) {
    emitStepInstantiation(step, emitter, topContext);
  }

  emitter.dedent(); // end 'with' block
  emitter.dedent(); // end function

  emitter.blank();
  emitter.blank();
  emitter.line(`if __name__ == '__main__':`);
  emitter.indent();
  emitter.line(`run()`);
  emitter.dedent();

  const code = emitter.build();

  const requirements = ['apache-beam'];
  const sqlSteps = collectStepsByOperation(pipeline, 'ReadFromSQL');
  if (sqlSteps.length > 0) {
    requirements.push('sqlalchemy');
    if (sqlSteps.some((s) => {
      const connStr = (s.params.connectionString as string) || '';
      return connStr.startsWith('postgres');
    })) {
      requirements.push('psycopg2-binary');
    }
    if (sqlSteps.some((s) => {
      const connStr = (s.params.connectionString as string) || '';
      return (connStr.startsWith('mssql') || connStr.startsWith('sqlserver')) && !connStr.includes('integratedSecurity=true');
    })) {
      requirements.push('pymssql');
    }
    if (sqlSteps.some((s) => {
      const connStr = (s.params.connectionString as string) || '';
      return (connStr.startsWith('mssql') || connStr.startsWith('sqlserver')) && connStr.includes('integratedSecurity=true');
    })) {
      requirements.push('pyodbc');
    }
  }

  return {
    code,
    filename: `${toPythonVar(pipeline.id)}_pipeline.py`,
    language: 'python',
    requirements,
    irPipeline: pipeline,
  };
}

/** Recursively check whether any step (top-level or nested) uses the given operation. */
function pipelineUsesOperation(pipeline: IRPipeline, operation: string): boolean {
  return pipeline.steps.some(
    (s) => s.operation === operation || (s.subPipeline && pipelineUsesOperation(s.subPipeline, operation)),
  );
}

/** Recursively collect every step (top-level or nested) with the given operation. */
function collectStepsByOperation(pipeline: IRPipeline, operation: string): IRStep[] {
  const found: IRStep[] = [];
  for (const s of pipeline.steps) {
    if (s.operation === operation) found.push(s);
    if (s.subPipeline) found.push(...collectStepsByOperation(s.subPipeline, operation));
  }
  return found;
}

/**
 * Register a custom operation handler for code generation.
 * This is the extension point for adding support for new IR operations.
 */
export function registerOperationHandler(
  operation: string,
  handler: OperationClassHandler,
): void {
  operationHandlers.set(operation, handler);
}

export type { OperationClassHandler, GenerationContext };
