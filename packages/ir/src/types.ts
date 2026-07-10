/**
 * @module @beamflow/ir/types
 *
 * IR type system — the bridge between the visual graph and code generation.
 *
 * This is the KEY ARCHITECTURAL LAYER that enables multi-language targeting.
 * The IR is independent of:
 * - React Flow's graph model (UI concern)
 * - Any specific Beam SDK language (codegen concern)
 * - Any specific runner (execution concern)
 *
 * Adding a new target language (e.g., Java Beam) only requires a new
 * generator that consumes IRPipeline — no changes to the editor or graph.
 */

import type { IRStepType } from '@beamflow/shared';

/**
 * A complete IR pipeline ready for code generation.
 */
export interface IRPipeline {
  /** Pipeline identifier. */
  readonly id: string;
  /** Human-readable pipeline name. */
  readonly name: string;
  /** Schema version of this IR format. */
  readonly version: string;
  /** Pipeline steps in topological (execution) order. */
  readonly steps: IRStep[];
  /** Data flow connections between steps. */
  readonly connections: IRConnection[];
  /** Global pipeline options. */
  readonly options?: IRPipelineOptions;
}

/**
 * A parameter exposed by a composite (subflow) step, surfaced as a
 * constructor argument on the generated PTransform subclass.
 */
export interface IRCompositeParameter {
  /** Stable id — matches the source ISubflowParameter.id. */
  readonly id: string;
  /** Human-readable name (used as the constructor kwarg name). */
  readonly name: string;
  readonly type: 'string' | 'number' | 'boolean' | 'enum';
  /** Value to use when the usage site doesn't override it. */
  readonly defaultValue: unknown;
  /** Internal step (within subPipeline) whose param this parameter drives. */
  readonly targetStepId: string;
  /** The param key on that internal step. */
  readonly targetParamKey: string;
}

/** One resolved output of a composite step's internal pipeline. */
export interface IRCompositeOutput {
  /** Internal step id (within subPipeline.steps) whose output this is. */
  readonly sourceStepId: string;
  /** Output name as seen from the parent, when explicitly named. */
  readonly name?: string;
}

/**
 * A single step in the IR pipeline.
 * Maps to one Beam PTransform in the generated code.
 */
export interface IRStep {
  /** Unique step identifier (derived from the source node ID). */
  readonly id: string;
  /** Human-readable label for the step. */
  readonly label: string;
  /** Step type classification. */
  readonly type: IRStepType;
  /**
   * The Beam operation name.
   * Examples: 'ReadFromText', 'Filter', 'Map', 'WriteToText', 'GroupByKey'
   */
  readonly operation: string;
  /**
   * Operation parameters — passed to the code generator.
   * Keys and values depend on the operation type.
   */
  readonly params: Record<string, unknown>;
  /** IDs of steps that this step depends on (input data sources). */
  readonly inputs: string[];
  /**
   * For each entry in `inputs`, the named output of that step to consume
   * (parallel array). Undefined/omitted entry = the step's single/default
   * output. Only meaningful when the referenced input step is a
   * multi-output composite (`compositeOutputs.length > 1`) — the generator
   * emits `stepVar['<name>']` instead of `stepVar` for such an entry.
   */
  readonly inputOutputKeys?: ReadonlyArray<string | undefined>;
  /**
   * Required language-specific imports.
   * Example: ['apache_beam.io', 'apache_beam.transforms']
   */
  readonly imports: string[];

  /**
   * The subflow's own nested IR pipeline. Present only for composite
   * (subflow) steps — its presence is the sole discriminator for "this step
   * compiles to a PTransform subclass with a nested expand() body" rather
   * than a leaf operation. Absent for ordinary/leaf steps.
   */
  readonly subPipeline?: IRPipeline;
  /** Exposed parameters (constructor args) for the generated PTransform. */
  readonly compositeParams?: readonly IRCompositeParameter[];
  /** This usage site's override values, keyed by IRCompositeParameter.id. */
  readonly compositeParamOverrides?: Record<string, unknown>;
  /**
   * Resolved output routing(s) inside subPipeline. One entry = a single
   * return value; more than one = a dict/tuple return.
   */
  readonly compositeOutputs?: readonly IRCompositeOutput[];
  /**
   * Names of the composite's declared inputs, in expand()'s dict-key order.
   * Length 1 is the common single-input case.
   */
  readonly compositeInputNames?: readonly string[];
  /** Human-readable source name (the subflow's name), for class naming. */
  readonly compositeSourceName?: string;
  /** The originating subflow document id — the class-key/dedup basis. */
  readonly compositeSourceId?: string;
}

/**
 * A data flow connection between two IR steps.
 */
export interface IRConnection {
  /** Source step ID. */
  readonly fromStepId: string;
  /** Target step ID. */
  readonly toStepId: string;
  /** Optional: which output of the source (for multi-output steps). */
  readonly outputTag?: string;
}

/**
 * Global pipeline configuration options.
 */
export interface IRPipelineOptions {
  /** The Beam runner to use. */
  readonly runner?: string;
  /** Temporary file location. */
  readonly tempLocation?: string;
  /** Additional runner-specific options. */
  readonly extra?: Record<string, unknown>;
}
