/**
 * @module @beamflow/graph
 *
 * Public API for the graph package.
 *
 * Provides:
 * - DAG: the standalone graph model with topological sort and validation
 * - Serialization: workflow JSON persistence with schema versioning
 */

export { DAG } from './dag.js';
export {
  serializeWorkflow,
  deserializeWorkflow,
  createEmptyWorkflow,
  validateSerializedWorkflow,
} from './serializer.js';
