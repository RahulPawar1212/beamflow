/**
 * @module @beamflow/ir
 *
 * Public API for the intermediate representation package.
 *
 * Provides:
 * - IR types: IRPipeline, IRStep, IRConnection
 * - IR builder: converts a DAG into an IRPipeline
 * - IR optimizer: optimization passes for generated code quality
 */

export type {
  IRPipeline,
  IRStep,
  IRConnection,
  IRPipelineOptions,
} from './types.js';

export { buildIR, validateIR } from './builder.js';
export type { IRBuilderOptions } from './builder.js';

export { optimizeIR, fuseFilters, detectDeadBranches } from './optimizer.js';
export type { IRPass } from './optimizer.js';
