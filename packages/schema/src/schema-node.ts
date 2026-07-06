/**
 * @module @beamflow/schema/schema-node
 *
 * The ISchemaNode interface — the contract every node type must implement
 * to participate in the design-time schema propagation system.
 *
 * Core principle:
 * - Schema nodes are PURE metadata transformers.
 * - They receive PipelineSchema objects as input.
 * - They return a PipelineSchema as output.
 * - They NEVER inspect PCollection data or call any Beam APIs.
 * - They run entirely in the workflow editor process.
 *
 * Separation from INodeDefinition (runtime):
 * - INodeDefinition.toIR()  → generates Apache Beam code (runtime)
 * - ISchemaNode.getOutputSchema() → computes column metadata (design-time)
 *
 * These two concerns are intentionally kept in separate objects so that
 * adding a new node type never requires touching the Beam code generator,
 * and vice versa.
 */

import type { PipelineSchema, SchemaValidationIssue } from './types.js';

/**
 * The design-time schema interface for a workflow node.
 *
 * Implementations receive the output schemas of all upstream nodes and
 * compute the schema of their own output. The propagation engine calls
 * getOutputSchema() in topological order.
 *
 * @example
 * class FilterSchemaNode implements ISchemaNode {
 *   constructor(
 *     public readonly nodeId: string,
 *     // No settings needed — filter preserves schema
 *   ) {}
 *
 *   getOutputSchema(inputSchemas: PipelineSchema[]): PipelineSchema {
 *     const input = inputSchemas[0];
 *     if (!input) return emptySchema();
 *     // Filter doesn't change schema — only row count changes at runtime
 *     return bumpVersion(input);
 *   }
 *
 *   validateSchema(inputSchemas: PipelineSchema[]): SchemaValidationIssue[] {
 *     if (inputSchemas.length === 0) return [missingInputError(this.nodeId)];
 *     return [];
 *   }
 * }
 */
export interface ISchemaNode {
  /**
   * The workflow node ID this schema node corresponds to.
   * Must match the INodeInstance.id in the workflow graph.
   */
  readonly nodeId: string;

  /**
   * Compute this node's output schema given the schemas of all its inputs.
   *
   * @param inputSchemas - Ordered array of output schemas from upstream nodes.
   *   - Index 0 is typically the primary input.
   *   - For Join nodes: index 0 = left, index 1 = right.
   *   - For Union nodes: all inputs are passed in order.
   *   - For Source nodes: this array is always empty.
   * @returns The computed output schema. Must never be null/undefined.
   *   If inputs are missing or invalid, return an empty schema.
   */
  getOutputSchema(inputSchemas: PipelineSchema[]): PipelineSchema;

  /**
   * Validate this node's schema configuration against its input schemas.
   *
   * This is called BEFORE execution to surface issues at design-time:
   * - Missing required columns
   * - Type mismatches in Join keys
   * - Invalid formula expressions
   * - Incompatible Union schemas
   *
   * @param inputSchemas - Same ordered array as passed to getOutputSchema().
   * @returns Array of issues (empty = no issues).
   */
  validateSchema(inputSchemas: PipelineSchema[]): SchemaValidationIssue[];
}

/**
 * Factory function type for creating schema nodes.
 * Each node type registers a factory so the engine can create schema nodes
 * from node instances without coupling to concrete implementations.
 */
export type SchemaNodeFactory = (
  nodeId: string,
  settings: Record<string, unknown>,
) => ISchemaNode;

/**
 * Registry of schema node factories, keyed by node type string.
 * e.g. 'beamflow:csv-source' → CsvSourceSchemaNode factory
 */
export class SchemaNodeRegistry {
  private readonly factories = new Map<string, SchemaNodeFactory>();

  /** Register a factory for a node type. */
  register(nodeType: string, factory: SchemaNodeFactory): void {
    this.factories.set(nodeType, factory);
  }

  /** Create a schema node for the given node type and settings. */
  create(
    nodeType: string,
    nodeId: string,
    settings: Record<string, unknown>,
  ): ISchemaNode | undefined {
    const factory = this.factories.get(nodeType);
    if (!factory) return undefined;
    return factory(nodeId, settings);
  }

  /** Whether a factory is registered for this node type. */
  has(nodeType: string): boolean {
    return this.factories.has(nodeType);
  }

  /** All registered node types. */
  get registeredTypes(): string[] {
    return Array.from(this.factories.keys());
  }
}

/** Global default schema node registry instance. */
export const schemaNodeRegistry = new SchemaNodeRegistry();
