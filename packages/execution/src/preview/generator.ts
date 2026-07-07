import { DAG } from '@beamflow/graph';
import { buildIR } from '@beamflow/ir';
import type { NodeRegistry } from '@beamflow/core';
import { generatePythonBeam, registerOperationHandler } from '@beamflow/beam-generator';
import type { GeneratedPipeline, IConnection, INodeInstance } from '@beamflow/shared';
import { IRStepType } from '@beamflow/shared';

// Register the custom Preview Feather Sink operation handler for Python codegen
registerOperationHandler('PreviewFeatherSink', (step, emitter, ctx) => {
  const varName = ctx.varNames.get(step.id)!;
  const inputVar = ctx.varNames.get(step.inputs[0]);
  const filePath = step.params.filePath as string;
  const limit = (step.params.limit as number) || 1000;

  emitter.addImport('apache_beam as beam');
  emitter.addImport('pyarrow as pa');
  emitter.addImport('pyarrow.feather as feather');
  emitter.addImport('pandas as pd');

  emitter.blank();
  emitter.comment('Preview: Sample and Write to Feather');
  
  // Create a custom DoFn to write a list of dicts (from FixedSizeGlobally) to Feather
  emitter.line(`class WritePreviewFeather(beam.DoFn):`);
  emitter.indent();
  emitter.line(`def process(self, element):`);
  emitter.indent();
  emitter.line(`if not element:`);
  emitter.indent();
  emitter.line(`df = pd.DataFrame()`);
  emitter.dedent();
  emitter.line(`else:`);
  emitter.indent();
  emitter.line(`df = pd.DataFrame(element)`);
  emitter.dedent();
  emitter.line(`feather.write_feather(df, '${filePath}')`);
  emitter.line(`yield element`);
  emitter.dedent();
  emitter.dedent();
  emitter.blank();

  emitter.line(`${varName}_sample = ${inputVar} | 'Preview_Sample' >> beam.combiners.Sample.FixedSizeGlobally(${limit})`);
  emitter.line(`${varName} = ${varName}_sample | 'Preview_Write' >> beam.ParDo(WritePreviewFeather())`);
});

/**
 * Generate a partial pipeline for previewing a specific node.
 */
export function generatePreviewPipeline(
  fullDag: DAG,
  targetNodeId: string,
  registry: NodeRegistry,
  featherFilePath: string,
  limit: number = 1000
): GeneratedPipeline {
  
  // 1. Traverse upstream to find all required nodes
  const requiredNodes = new Map<string, INodeInstance>();
  const queue = [targetNodeId];
  
  // Validate target exists
  const targetNode = fullDag.getNode(targetNodeId);
  if (!targetNode) {
    throw new Error(`Target node ${targetNodeId} not found in workflow`);
  }
  
  while (queue.length > 0) {
    const currentId = queue.shift()!;
    if (!requiredNodes.has(currentId)) {
      const node = fullDag.getNode(currentId);
      if (node) {
        requiredNodes.set(currentId, node);
        const upstream = fullDag.getUpstream(currentId);
        queue.push(...upstream.map(n => n.id));
      }
    }
  }

  // 2. Build a truncated DAG
  const previewDag = new DAG();
  for (const node of requiredNodes.values()) {
    previewDag.addNode(node);
  }

  // Clone edges that exist entirely within the required nodes
  const allEdges = fullDag.getAllEdges();
  for (const edge of allEdges) {
    if (requiredNodes.has(edge.sourceNodeId) && requiredNodes.has(edge.targetNodeId)) {
      previewDag.addEdge({ ...edge });
    }
  }

  // 3. Generate IR for the truncated DAG
  const ir = buildIR(previewDag, registry, {
    name: `preview_${targetNodeId}`
  });

  // 4. Append the Preview Sink IR step
  // Since buildIR maps node output to its ID (or custom internal ID), 
  // and the target node is a leaf in this truncated DAG, its final step is the last step in ir.steps.
  const targetOutputStepId = ir.steps[ir.steps.length - 1].id;
  const previewStepId = `${targetNodeId}__preview_sink`;
  
  ir.steps.push({
    id: previewStepId,
    label: 'Preview Sink',
    type: IRStepType.Write,
    operation: 'PreviewFeatherSink',
    params: {
      filePath: featherFilePath.replace(/\\/g, '/'), // Ensure path works in Python string
      limit
    },
    inputs: [targetOutputStepId], // Depends on target node's final output step
    imports: [],
  });

  // 5. Generate Python code
  const generated = generatePythonBeam(ir);
  
  // Inject pyarrow and pandas dependencies
  generated.requirements.push('pyarrow', 'pandas');

  return generated;
}
