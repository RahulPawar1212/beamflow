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

import type { INodeInstance, IConnection, InlineIRStep, SerializedWorkflow } from '@beamflow/shared';
import { resolveSubflowOutputs, IRStepType, deriveAutoParameters, mergeSubflowParameters } from '@beamflow/shared';
import type { NodeRegistry } from '@beamflow/core';
import { DAG, deserializeWorkflow } from '@beamflow/graph';
import type {
  IRPipeline,
  IRStep,
  IRConnection,
  IRPipelineOptions,
  IRCompositeParameter,
  IRCompositeOutput,
} from './types.js';

/** A pre-fetched subflow document, ready for IR building — no I/O from here. */
export interface ResolvedSubflowDoc {
  readonly workflow: SerializedWorkflow;
}

/**
 * Synchronous lookup for a subflow document by id. The caller (typically a
 * server route) is responsible for recursively pre-fetching every referenced
 * subflow before calling buildIR — packages/ir itself never performs I/O.
 */
export type SubflowResolver = (subflowId: string) => ResolvedSubflowDoc | undefined;

/** Options for the IR builder. */
export interface IRBuilderOptions {
  /** Pipeline name (used in generated code). */
  readonly name?: string;
  /** Global pipeline options. */
  readonly pipelineOptions?: IRPipelineOptions;
  /**
   * Resolves a `system:subflow` node's referenced document. When provided,
   * `system:subflow` nodes are recursively compiled into nested composite
   * IRSteps. When omitted (the default), a `system:subflow` node in the DAG
   * is a hard error — callers that never deal with subflows are unaffected,
   * since this option didn't exist before and no such node could reach
   * buildIR previously (it was always pre-flattened).
   */
  readonly resolveSubflow?: SubflowResolver;
  /** Internal recursion-depth guard — do not set on a fresh top-level call. */
  readonly _depth?: number;
}

const MAX_SUBFLOW_DEPTH = 10;

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
  const depth = options?._depth ?? 0;
  if (depth > MAX_SUBFLOW_DEPTH) {
    throw new Error('Max subflow nesting depth exceeded (circular dependency?).');
  }

  // 1. Topological sort — guarantees execution order, throws on cycles
  const sortedNodes = dag.topologicalSort();

  // 2. Build IR steps
  const steps: IRStep[] = [];
  const allEdges = dag.getAllEdges();

  // Maps each graph node id → the IR step id that represents its OUTPUT.
  // For normal and simple custom nodes this is the node id itself; for a
  // composite (grouped) custom node it is the id of its last internal step.
  const nodeOutputStepId = new Map<string, string>();
  // Maps each graph node id → its resolved multi-output names, when it is a
  // multi-output composite (subflow) step — undefined/absent for every
  // ordinary single-output node. Used to resolve which named output an
  // edge's sourcePortId selects.
  const nodeOutputNames = new Map<string, readonly string[]>();

  for (const node of sortedNodes) {
    // Upstream edges feeding this node (not just ids — sourcePortId is
    // needed to disambiguate a multi-output composite's named outputs).
    const upstreamEdges = allEdges.filter((e) => e.targetNodeId === node.id);
    // Resolve those to their IR output step ids, and — for edges whose
    // source is a multi-output composite — the specific named output.
    const externalInputStepIds = upstreamEdges.map(
      (e) => nodeOutputStepId.get(e.sourceNodeId) ?? e.sourceNodeId,
    );
    const externalInputOutputKeys = upstreamEdges.map((e) => {
      const outputNames = nodeOutputNames.get(e.sourceNodeId);
      if (!outputNames || outputNames.length <= 1) return undefined;
      return outputNames.includes(e.sourcePortId) ? e.sourcePortId : outputNames[0];
    });

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
        let inputOutputKeys: (string | undefined)[] | undefined;
        if (i === 0) {
          inputs = externalInputStepIds;
          inputOutputKeys = externalInputOutputKeys;
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
          inputOutputKeys,
          imports: inlineStep.imports ? [...inlineStep.imports] : [],
        });
      });

      // Downstream nodes connect to this composite's last internal step.
      nodeOutputStepId.set(node.id, internalIds[internalIds.length - 1]);
      continue;
    }

    if (node.type === 'system:subflow') {
      // ── Subflow proxy: recursively compile the referenced subflow into a
      //    nested composite IRStep instead of the placeholder toIR() stub. ──
      const step = buildCompositeStepForSubflowNode(
        node,
        externalInputStepIds,
        externalInputOutputKeys,
        registry,
        options,
        depth,
      );
      steps.push(step);
      nodeOutputStepId.set(node.id, step.id);
      if (step.compositeOutputs && step.compositeOutputs.length > 1) {
        nodeOutputNames.set(
          node.id,
          step.compositeOutputs.map((o, i) => o.name || `output_${i}`),
        );
      }
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
      inputOutputKeys: externalInputOutputKeys,
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
 * Recursively compile a `system:subflow` proxy node into a composite IRStep
 * whose `subPipeline` is the referenced subflow's own IR. This is what gives
 * arbitrary nesting depth for free: subDag may itself contain another
 * `system:subflow` node, handled by the same recursive `buildIR` call.
 */
function buildCompositeStepForSubflowNode(
  node: INodeInstance,
  externalInputStepIds: string[],
  externalInputOutputKeys: (string | undefined)[],
  registry: NodeRegistry,
  options: IRBuilderOptions | undefined,
  depth: number,
): IRStep {
  const subflowId = node.settings?.subflowId as string | undefined;
  if (!subflowId) {
    throw new Error(`Subflow node "${node.id}" has no subflow selected.`);
  }
  if (!options?.resolveSubflow) {
    throw new Error(
      `Subflow node "${node.id}" encountered but no subflow resolver was ` +
        `provided to buildIR(). Pre-resolve subflow documents and pass ` +
        `{ resolveSubflow } in IRBuilderOptions.`,
    );
  }
  const resolved = options.resolveSubflow(subflowId);
  if (!resolved) {
    throw new Error(
      `Subflow node "${node.id}" references subflow "${subflowId}" which ` +
        `could not be resolved (deleted or inaccessible).`,
    );
  }

  const { dag: subDag, metadata: subMeta } = deserializeWorkflow(resolved.workflow);

  const subPipeline = buildIR(subDag, registry, {
    name: subMeta.name,
    resolveSubflow: options.resolveSubflow,
    _depth: depth + 1,
  });

  // ── Composite parameters: ISubflowParameter -> IRCompositeParameter ──────
  // Live-merged with a fresh derivation from the subflow's current nodes (see
  // @beamflow/shared subflow-auto-params + editor's subflow-params.ts), so a
  // subflow saved before auto-params existed still generates code that honors
  // a value the user filled in via the live-derived parent-side parameter.
  const effectiveParams = mergeSubflowParameters(
    subMeta.parameters ?? [],
    deriveAutoParameters(resolved.workflow.nodes, (t) => registry.get(t)?.settings),
  );
  const compositeParams: IRCompositeParameter[] = effectiveParams.map(
    (p) => {
      const targetStep = subPipeline.steps.find((s) => s.id === p.targetNodeId);
      const currentValue = targetStep?.params[p.targetSettingKey];
      return {
        id: p.id,
        name: p.name,
        type: p.type,
        defaultValue: currentValue,
        targetStepId: p.targetNodeId,
        targetParamKey: p.targetSettingKey,
      };
    },
  );

  // This usage site's own overrides (the proxy node's settings, keyed by
  // ISubflowParameter.id) — used at codegen time to pick per-instantiation
  // constructor kwargs instead of always falling back to defaultValue.
  const compositeParamOverrides: Record<string, unknown> = {};
  for (const p of compositeParams) {
    if (node.settings && p.id in node.settings) {
      compositeParamOverrides[p.id] = node.settings[p.id];
    }
  }

  // ── Composite inputs: subflow-input boundary nodes, stable name order ────
  const inputNodes = subDag
    .getAllNodes()
    .filter((n) => n.type === 'system:subflow-input');
  const compositeInputNames: string[] =
    inputNodes.length > 0
      ? inputNodes.map((n) => (n.settings?.inputName as string) || n.id)
      : ['in'];

  // ── Composite outputs: reuse the SHARED classifier, don't reimplement ────
  const outputNodes = subDag
    .getAllNodes()
    .filter((n) => n.type === 'system:subflow-output');
  const activeNodes = subDag
    .getAllNodes()
    .filter(
      (n) => n.type !== 'system:subflow-input' && n.type !== 'system:subflow-output',
    );
  const edgesLite = subDag
    .getAllEdges()
    .map((e) => ({ from: e.sourceNodeId, to: e.targetNodeId }));

  const outputResolution = resolveSubflowOutputs(
    activeNodes.map((n) => ({ id: n.id, label: n.label })),
    outputNodes.map((n) => ({ id: n.id })),
    edgesLite,
  );
  if (outputResolution.error) {
    throw new Error(
      `Subflow "${subMeta.name}" (referenced by node "${node.id}"): ${outputResolution.error.message}`,
    );
  }

  const compositeOutputs: IRCompositeOutput[] = outputResolution.outputs.map(
    (routing) => {
      const sourceStepId = resolveNodeToOutputStepId(subPipeline, routing.sourceId);
      const viaOutputNode = routing.viaOutputNodeId
        ? outputNodes.find((n) => n.id === routing.viaOutputNodeId)
        : undefined;
      return {
        sourceStepId,
        name: (viaOutputNode?.settings?.outputName as string) || undefined,
      };
    },
  );

  return {
    id: node.id,
    label: node.label || subMeta.name,
    type: IRStepType.Transform,
    operation: 'Subflow',
    params: { subflowId },
    inputs: externalInputStepIds,
    inputOutputKeys: externalInputOutputKeys,
    imports: [],
    subPipeline,
    compositeParams,
    compositeParamOverrides,
    compositeOutputs,
    compositeInputNames,
    compositeSourceName: subMeta.name,
    compositeSourceId: subflowId,
  };
}

/**
 * Resolve a graph node id (from a subflow's internal DAG) to the IR step id
 * that represents its output, mirroring buildIR's own nodeOutputStepId
 * bookkeeping: for an ordinary/registry node the step id is the node id
 * itself; for an inline-IR composite custom node it's the id of its last
 * internal step, `${nodeId}__s<lastIndex>`.
 */
function resolveNodeToOutputStepId(pipeline: IRPipeline, nodeId: string): string {
  if (pipeline.steps.some((s) => s.id === nodeId)) {
    return nodeId;
  }
  const prefix = `${nodeId}__s`;
  const internalSteps = pipeline.steps
    .filter((s) => s.id.startsWith(prefix))
    .sort((a, b) => {
      const aIdx = Number(a.id.slice(prefix.length));
      const bIdx = Number(b.id.slice(prefix.length));
      return aIdx - bIdx;
    });
  if (internalSteps.length > 0) {
    return internalSteps[internalSteps.length - 1].id;
  }
  throw new Error(
    `Could not resolve output step for internal node "${nodeId}" — no matching IR step found.`,
  );
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

  // Recurse into composite steps' nested pipelines, so dangling-reference
  // checks don't silently skip subflow internals.
  for (const step of pipeline.steps) {
    if (step.subPipeline) {
      errors.push(
        ...validateIR(step.subPipeline).map((e) => `[${step.label}] ${e}`),
      );
    }
  }

  return errors;
}
