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
   * Required language-specific imports.
   * Example: ['apache_beam.io', 'apache_beam.transforms']
   */
  readonly imports: string[];
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
