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

// Transforms
import { filter } from './transforms/filter.js';
import { map } from './transforms/map.js';
import { groupBy } from './transforms/group-by.js';

// Outputs
import { csvOutput } from './outputs/csv-output.js';

/**
 * The built-in nodes plugin.
 * Registers all 6 MVP node types with the registry.
 */
export const builtinNodesPlugin: IPlugin = {
  name: '@beamflow/builtin-nodes',
  version: '0.1.0',
  description:
    'Built-in source, transform, and output nodes for BeamFlow pipelines.',

  register(registerNode) {
    // Sources
    registerNode(csvSource);
    registerNode(jsonSource);

    // Transforms
    registerNode(filter);
    registerNode(map);
    registerNode(groupBy);

    // Outputs
    registerNode(csvOutput);
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
