/**
 * @module @beamflow/shared
 *
 * Public API for the shared types and utilities package.
 * All other BeamFlow packages should import from this entry point.
 */

// Re-export all types
export {
  // Enums
  NodeCategory,
  PortDirection,
  DataType,
  SettingType,
  ExecutionStatus,
  IRStepType,
  ValidationSeverity,
  // Interfaces
  type IPort,
  type ISettingValidation,
  type ISettingDefinition,
  type INodeDefinition,
  type INodeInstance,
  type InlineIRStep,
  type IConnection,
  type IWorkflowMetadata,
  type IProject,
  type IWorkflow,
  type IRStepDefinition,
  type ValidationIssue,
  type GeneratedPipeline,
  type RunnerConfig,
  type ExecutionResult,
  type IPlugin,
  // Serialization
  type SerializedWorkflow,
  SCHEMA_VERSION,
} from './types.js';

export * from './preview.js';

// Re-export utilities
export {
  generateId,
  deepClone,
  timestamp,
  isDefined,
  groupBy,
  safeJsonParse,
  debounce,
} from './utils.js';

// Subflow output-boundary classifier (shared by server + editor expanders).
export { resolveSubflowOutputs } from './subflow-outputs.js';
export type {
  SubflowNodeLite,
  SubflowEdgeLite,
  SubflowOutputRouting,
  SubflowOutputResolution,
} from './subflow-outputs.js';
