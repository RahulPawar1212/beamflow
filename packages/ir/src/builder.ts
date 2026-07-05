/**
 * @module @beamflow/ir/builder
 *
 * Converts a DAG (from the graph package) into an IRPipeline.
 *
 * This is the translation boundary between the visual/graph world
 * and the code generation world. Each node's toIR() method is called
 * to produce its IR step, and the builder assembles them into a
 * complete pipeline with resolved connections.
 */

import type { INodeInstance, IConnection, InlineIRStep } from '@beamflow/shared';
import type { NodeRegistry } from '@beamflow/core';
import { DAG } from '@beamflow/graph';
import type { IRPipeline, IRStep, IRConnection, IRPipelineOptions } from './types.js';

/** Options for the IR builder. */
export interface IRBuilderOptions {
  /** Pipeline name (used in generated code). */
  readonly name?: string;
  /** Global pipeline options. */
  readonly pipelineOptions?: IRPipelineOptions;
}

/**
 * Build an IRPipeline from a DAG and node registry.
 *
 * Process:
 * 1. Topologically sort the DAG
 * 2. For each node, look up its definition in the registry
 * 3. Call the definition's toIR() method with the node's settings
 * 4. Resolve graph connections into IR connections
 * 5. Assemble into a complete IRPipeline
 *
 * @throws Error if a node type is not found in the registry.
 * @throws Error if the graph contains a cycle.
 */
export function buildIR(
  dag: DAG,
  registry: NodeRegistry,
  options?: IRBuilderOptions,
): IRPipeline {
  // 1. Topological sort — guarantees execution order, throws on cycles
  const sortedNodes = dag.topologicalSort();

  // 2. Build IR steps
  const steps: IRStep[] = [];
  const allEdges = dag.getAllEdges();

  // Maps each graph node id → the IR step id that represents its OUTPUT.
  // For normal and simple custom nodes this is the node id itself; for a
  // composite (grouped) custom node it is the id of its last internal step.
  const nodeOutputStepId = new Map<string, string>();

  for (const node of sortedNodes) {
    // Graph node ids of the upstream nodes feeding this node.
    const upstreamNodeIds = allEdges
      .filter((e) => e.targetNodeId === node.id)
      .map((e) => e.sourceNodeId);
    // Resolve those to their IR output step ids.
    const externalInputStepIds = upstreamNodeIds.map(
      (id) => nodeOutputStepId.get(id) ?? id,
    );

    if (node.inlineIR) {
      // ── Custom node: use the IR carried by the instance itself ──────────
      const inlineSteps: InlineIRStep[] = Array.isArray(node.inlineIR)
        ? node.inlineIR
        : [node.inlineIR];

      if (inlineSteps.length === 0) {
        throw new Error(`Custom node "${node.id}" has empty inline IR.`);
      }

      // Emit each inline step, chaining them internally. The first step
      // receives the node's external inputs; subsequent steps chain from the
      // previous internal step (or an explicit inputRefs mapping).
      const internalIds: string[] = inlineSteps.map((_, i) =>
        inlineSteps.length === 1 ? node.id : `${node.id}__s${i}`,
      );

      inlineSteps.forEach((inlineStep, i) => {
        let inputs: string[];
        if (i === 0) {
          inputs = externalInputStepIds;
        } else if (inlineStep.inputRefs && inlineStep.inputRefs.length > 0) {
          inputs = inlineStep.inputRefs.map((ref) => internalIds[ref]);
        } else {
          inputs = [internalIds[i - 1]];
        }

        steps.push({
          id: internalIds[i],
          label: inlineStep.label || node.label || node.type,
          type: inlineStep.stepType,
          operation: inlineStep.operation,
          params: inlineStep.params,
          inputs,
          imports: inlineStep.imports ? [...inlineStep.imports] : [],
        });
      });

      // Downstream nodes connect to this composite's last internal step.
      nodeOutputStepId.set(node.id, internalIds[internalIds.length - 1]);
      continue;
    }

    // ── Registry-backed built-in node ─────────────────────────────────────
    const definition = registry.get(node.type);
    if (!definition) {
      throw new Error(
        `Node type "${node.type}" not found in registry. ` +
          `Ensure the required plugin is loaded.`,
      );
    }

    const irDef = definition.toIR(node.settings, node.id);

    steps.push({
      id: node.id,
      label: node.label || definition.name,
      type: irDef.stepType,
      operation: irDef.operation,
      params: irDef.params,
      inputs: externalInputStepIds,
      imports: irDef.imports ? [...irDef.imports] : [],
    });

    nodeOutputStepId.set(node.id, node.id);
  }

  // 3. Build IR connections from the emitted step inputs (handles both the
  //    node-level edges and the internal edges of expanded composites).
  const connections: IRConnection[] = [];
  for (const step of steps) {
    for (const inputId of step.inputs) {
      connections.push({ fromStepId: inputId, toStepId: step.id });
    }
  }

  // 4. Assemble pipeline
  const pipeline: IRPipeline = {
    id: options?.name || 'pipeline',
    name: options?.name || 'BeamFlow Pipeline',
    version: '1.0.0',
    steps,
    connections,
    options: options?.pipelineOptions,
  };

  return pipeline;
}

/**
 * Validate an IR pipeline for completeness and consistency.
 */
export function validateIR(pipeline: IRPipeline): string[] {
  const errors: string[] = [];

  if (pipeline.steps.length === 0) {
    errors.push('Pipeline has no steps.');
    return errors;
  }

  const stepIds = new Set(pipeline.steps.map((s) => s.id));

  // Check for dangling references in connections
  for (const conn of pipeline.connections) {
    if (!stepIds.has(conn.fromStepId)) {
      errors.push(
        `Connection references non-existent source step "${conn.fromStepId}".`,
      );
    }
    if (!stepIds.has(conn.toStepId)) {
      errors.push(
        `Connection references non-existent target step "${conn.toStepId}".`,
      );
    }
  }

  // Check for dangling input references in steps
  for (const step of pipeline.steps) {
    for (const inputId of step.inputs) {
      if (!stepIds.has(inputId)) {
        errors.push(
          `Step "${step.id}" references non-existent input step "${inputId}".`,
        );
      }
    }
  }

  return errors;
}
