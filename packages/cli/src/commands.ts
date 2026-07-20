/**
 * Command implementations, kept as pure functions (registry + docs in, result
 * out) so they can be unit-tested headlessly without spawning the process.
 * The thin `index.ts` entry only parses argv and prints.
 */
import { deserializeWorkflow } from '@beamflow/graph';
import { buildIR, optimizeIR, validateIR } from '@beamflow/ir';
import { generatePythonBeam } from '@beamflow/beam-generator';
import { effectiveSubflowParameters, type ISubflowParameter } from '@beamflow/shared';
import type { SerializedWorkflow } from '@beamflow/shared';
import type { NodeRegistry } from '@beamflow/core';
import { makeSubflowResolver } from './workflow-io.js';

/** One subflow node's exposed parameters, as inspected by `beamflow params`. */
export interface SubflowParamReport {
  nodeId: string;
  subflowId: string | undefined;
  parameters: ISubflowParameter[];
}

/**
 * Report the EFFECTIVE parameters (stored + live-derived) for every
 * `system:subflow` node in the workflow — the exact computation the editor's
 * parent PropertyPanel / schema-store perform, run headlessly. A required
 * inner setting that is FILLED must yield NO parameter here.
 */
export function inspectParams(
  workflow: SerializedWorkflow,
  subflowIndex: Map<string, SerializedWorkflow>,
  registry: NodeRegistry,
): SubflowParamReport[] {
  const resolveSettings = (nodeType: string) => registry.get(nodeType)?.settings;
  const reports: SubflowParamReport[] = [];

  for (const node of workflow.nodes) {
    if (node.type !== 'system:subflow') continue;
    const subflowId = node.settings?.subflowId as string | undefined;
    const subflowDoc = subflowId ? subflowIndex.get(subflowId) : undefined;
    reports.push({
      nodeId: node.id,
      subflowId,
      parameters: effectiveSubflowParameters(subflowDoc, resolveSettings),
    });
  }

  return reports;
}

export interface GenerateResult {
  code: string;
  filename?: string;
  requirements?: string[];
}

/**
 * The server's generate chain (pipelines.ts), headless: deserialize → buildIR
 * (recursive subflow composites via the resolver) → optimize → generate Python.
 */
export function generate(
  workflow: SerializedWorkflow,
  subflowIndex: Map<string, SerializedWorkflow>,
  registry: NodeRegistry,
): GenerateResult {
  const resolveSubflow = makeSubflowResolver(subflowIndex);
  const { dag, metadata } = deserializeWorkflow(workflow);

  const graphIssues = dag.validate(registry);
  const graphErrors = graphIssues.filter((i) => i.severity === 'error');
  if (graphErrors.length > 0) {
    throw new Error(
      'Graph validation failed:\n' + graphErrors.map((e) => `  - ${e.message}`).join('\n'),
    );
  }

  const ir = buildIR(dag, registry, { name: metadata.name, resolveSubflow });

  const irErrors = validateIR(ir);
  if (irErrors.length > 0) {
    throw new Error('IR validation failed:\n' + irErrors.map((e) => `  - ${e}`).join('\n'));
  }

  const optimized = optimizeIR(ir);
  const generated = generatePythonBeam(optimized);
  return {
    code: generated.code,
    filename: generated.filename,
    requirements: generated.requirements,
  };
}
