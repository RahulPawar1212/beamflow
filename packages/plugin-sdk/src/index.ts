/**
 * @module @beamflow/plugin-sdk
 *
 * The official SDK for building BeamFlow plugins.
 *
 * This package re-exports everything a plugin author needs to create
 * custom nodes, connectors, and extensions for BeamFlow.
 *
 * @example
 * ```typescript
 * import {
 *   defineNode, inputPort, outputPort, textSetting,
 *   NodeCategory, IRStepType,
 *   type IPlugin
 * } from '@beamflow/plugin-sdk';
 *
 * const myNode = defineNode({
 *   type: 'my-org:custom-transform',
 *   name: 'Custom Transform',
 *   description: 'Does something custom',
 *   category: NodeCategory.Transform,
 *   icon: 'cog',
 *   ports: [inputPort('in', 'Input'), outputPort('out', 'Output')],
 *   settings: [textSetting('param', 'Parameter', { required: true })],
 *   toIR(settings, nodeId) {
 *     return {
 *       operation: 'CustomTransform',
 *       stepType: IRStepType.Transform,
 *       params: { param: settings.param },
 *     };
 *   },
 * });
 *
 * export const myPlugin: IPlugin = {
 *   name: 'my-custom-plugin',
 *   version: '1.0.0',
 *   description: 'My custom BeamFlow plugin',
 *   register(registerNode) {
 *     registerNode(myNode);
 *   },
 * };
 * ```
 */

// ─── Core types (from @beamflow/shared) ─────────────────────────────────────
export {
  // Enums
  NodeCategory,
  PortDirection,
  DataType,
  SettingType,
  IRStepType,
  ValidationSeverity,
  ExecutionStatus,
  // Interfaces
  type IPlugin,
  type INodeDefinition,
  type IPort,
  type ISettingDefinition,
  type ISettingValidation,
  type INodeInstance,
  type IConnection,
  type IRStepDefinition,
  type ValidationIssue,
  type IWorkflow,
  type IWorkflowMetadata,
  type GeneratedPipeline,
  type SerializedWorkflow,
  SCHEMA_VERSION,
} from '@beamflow/shared';

// ─── Node definition helpers (from @beamflow/nodes) ─────────────────────────
export {
  defineNode,
  inputPort,
  outputPort,
  textSetting,
  selectSetting,
  booleanSetting,
  numberSetting,
  expressionSetting,
  requiredError,
} from '@beamflow/nodes';
export type { DefineNodeOptions } from '@beamflow/nodes';
