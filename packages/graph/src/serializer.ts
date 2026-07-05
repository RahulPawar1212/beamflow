/**
 * @module @beamflow/graph/serializer
 *
 * Serialization and deserialization of workflows (DAG ↔ JSON).
 * Includes schema versioning for future migration support.
 */

import type {
  IWorkflowMetadata,
  SerializedWorkflow,
  INodeInstance,
  IConnection,
} from '@beamflow/shared';
import { SCHEMA_VERSION } from '@beamflow/shared';
import { DAG } from './dag.js';

/**
 * Serialize a DAG and its metadata into a JSON-serializable workflow document.
 */
export function serializeWorkflow(
  dag: DAG,
  metadata: IWorkflowMetadata,
): SerializedWorkflow {
  return {
    schemaVersion: SCHEMA_VERSION,
    metadata: {
      ...metadata,
      updatedAt: new Date().toISOString(),
    },
    nodes: dag.getAllNodes(),
    connections: dag.getAllEdges(),
  };
}

/**
 * Deserialize a JSON workflow document into a DAG.
 *
 * @param data - The serialized workflow JSON.
 * @returns Object containing the rebuilt DAG and metadata.
 * @throws Error if the schema version is unsupported.
 */
export function deserializeWorkflow(data: SerializedWorkflow): {
  dag: DAG;
  metadata: IWorkflowMetadata;
} {
  // Version check — future: add migration logic here
  if (!data.schemaVersion) {
    throw new Error('Missing schemaVersion in workflow document.');
  }

  const dag = new DAG();

  // Rebuild nodes
  for (const node of data.nodes) {
    dag.addNode(node);
  }

  // Rebuild edges
  for (const connection of data.connections) {
    dag.addEdge(connection);
  }

  return {
    dag,
    metadata: data.metadata,
  };
}

/**
 * Create an empty workflow with default metadata.
 */
export function createEmptyWorkflow(
  id: string,
  name: string,
): { dag: DAG; metadata: IWorkflowMetadata } {
  const now = new Date().toISOString();
  return {
    dag: new DAG(),
    metadata: {
      id,
      name,
      description: '',
      createdAt: now,
      updatedAt: now,
    },
  };
}

/**
 * Validate that a serialized workflow has the expected structure.
 * Returns true if valid, or an error message string.
 */
export function validateSerializedWorkflow(
  data: unknown,
): data is SerializedWorkflow {
  if (!data || typeof data !== 'object') return false;

  const doc = data as Record<string, unknown>;

  return (
    typeof doc.schemaVersion === 'string' &&
    typeof doc.metadata === 'object' &&
    doc.metadata !== null &&
    Array.isArray(doc.nodes) &&
    Array.isArray(doc.connections)
  );
}
