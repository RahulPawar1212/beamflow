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
  type ISubflowParameter,
  type IWorkflowMetadata,
  type IProject,
  type IOrganization,
  type IMembership,
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
export { resolveSubflowOutputs, resolveSubflowInputBoundary } from './subflow-outputs.js';
export type {
  SubflowNodeLite,
  SubflowEdgeLite,
  SubflowOutputRouting,
  SubflowOutputResolution,
  SubflowInputBoundaryResolution,
} from './subflow-outputs.js';

// Auto-derived subflow parameters (required-but-unfilled inner settings) —
// derived at subflow creation + on every subflow save (see editor workflow-store).
export {
  deriveAutoParameters,
  mergeSubflowParameters,
  effectiveSubflowParameters,
  isAutoParamId,
} from './subflow-auto-params.js';
export type {
  AutoParamNodeLite,
  AutoParamSettingLite,
  SettingDefsLookup,
  SubflowDocLite,
} from './subflow-auto-params.js';

// Structural graph validation (orphan nodes, unconnected required ports) —
// shared by DAG.validate() (packages/graph) and the editor's live canvas check.
export { validateGraphStructure } from './graph-validation.js';
export type {
  GraphNodeLite,
  GraphEdgeLite,
  GraphPortLite,
  GraphPortLookup,
  GraphStructureIssue,
} from './graph-validation.js';
