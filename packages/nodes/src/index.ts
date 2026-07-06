/**
 * @module @beamflow/nodes
 *
 * Built-in node definitions plugin for BeamFlow.
 *
 * This is the REFERENCE IMPLEMENTATION for how plugins work.
 * It demonstrates:
 * - How to define nodes using the helper functions
 * - How to register them as a plugin
 * - How to organize nodes by category
 *
 * External plugin authors should follow this same pattern.
 */

import type { IPlugin, INodeDefinition } from '@beamflow/shared';

// Sources
import { csvSource } from './sources/csv-source.js';
import { jsonSource } from './sources/json-source.js';
import { sqlSource } from './sources/sql-source.js';

// Transforms
import { filter } from './transforms/filter.js';
import { map } from './transforms/map.js';
import { groupBy } from './transforms/group-by.js';

// Outputs
import { csvOutput } from './outputs/csv-output.js';

/**
 * Every built-in node, in palette order.
 *
 * This is the single source of truth for the built-in node set. To add a new
 * built-in node: create its file under `sources/`, `transforms/`, or
 * `outputs/`, import it above, and add it to this array — registration is then
 * automatic (see `builtinNodesPlugin.register` below). No other edits needed.
 */
export const builtinNodes: INodeDefinition[] = [
  // Sources
  csvSource,
  jsonSource,
  sqlSource,
  // Transforms
  filter,
  map,
  groupBy,
  // Outputs
  csvOutput,
];

/**
 * The built-in nodes plugin.
 * Registers every node in {@link builtinNodes} with the registry.
 */
export const builtinNodesPlugin: IPlugin = {
  name: '@beamflow/builtin-nodes',
  version: '0.1.0',
  description:
    'Built-in source, transform, and output nodes for BeamFlow pipelines.',

  register(registerNode) {
    for (const node of builtinNodes) {
      registerNode(node);
    }
  },
};

// Re-export individual nodes for direct access
export { csvSource, jsonSource, filter, map, groupBy, csvOutput };

// Re-export helpers for plugin authors
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
} from './helpers.js';
export type { DefineNodeOptions } from './helpers.js';

// Schema propagation registry and node exports
export * from './schema/index.js';

