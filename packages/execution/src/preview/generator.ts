import { DAG } from '@beamflow/graph';
import { buildIR } from '@beamflow/ir';
import type { NodeRegistry } from '@beamflow/core';
import { generatePythonBeam, registerOperationHandler, toPythonString } from '@beamflow/beam-generator';
import type { GeneratedPipeline, IConnection, INodeInstance } from '@beamflow/shared';
import { IRStepType } from '@beamflow/shared';

// Register the custom Preview Feather Sink operation as a reusable PTransform
// class, following the same one-class-per-operation-type pattern as every
// other leaf operation in @beamflow/beam-generator.
registerOperationHandler('PreviewFeatherSink', {
  classNameHint: 'PreviewFeatherSinkTransform',
  emitClass: (className, emitter) => {
    emitter.addImport('apache_beam as beam');
    emitter.addImport('pyarrow as pa');
    emitter.addImport('pyarrow.feather as feather');
    emitter.addImport('pandas as pd');

    emitter.blank();
    emitter.line(`class _${className}WriteDoFn(beam.DoFn):`);
    emitter.indent();
    emitter.line(`def __init__(self, file_path):`);
    emitter.indent();
    emitter.line(`self.file_path = file_path`);
    emitter.dedent();
    emitter.blank();
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
    emitter.line(`feather.write_feather(df, self.file_path, compression='uncompressed')`);
    emitter.line(`yield element`);
    emitter.dedent();
    emitter.dedent();
    emitter.blank();

    emitter.line(`class ${className}(beam.PTransform):`);
    emitter.indent();
    emitter.line(`def __init__(self, file_path, limit=1000):`);
    emitter.indent();
    emitter.line(`super().__init__()`);
    emitter.line(`self.file_path = file_path`);
    emitter.line(`self.limit = limit`);
    emitter.dedent();
    emitter.blank();
    emitter.line(`def expand(self, pcoll):`);
    emitter.indent();
    emitter.line(`sample = pcoll | 'Preview_Sample' >> beam.combiners.Sample.FixedSizeGlobally(self.limit)`);
    emitter.line(`return sample | 'Preview_Write' >> beam.ParDo(_${className}WriteDoFn(self.file_path))`);
    emitter.dedent();
    emitter.dedent();
  },
  instantiationKwargs: (step) => {
    const filePath = (step.params.filePath as string) || '';
    const limit = (step.params.limit as number) || 1000;
    return `file_path='${toPythonString(filePath)}', limit=${limit}`;
  },
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
  // buildIR maps a built-in node's output to a step whose id === node.id, and a
  // composite/custom node's output to its LAST internal step (`${node.id}__s<n>`).
  // We must resolve the target node's output step explicitly rather than assuming
  // it is the last step in ir.steps — in a multi-branch DAG the target's step is
  // not necessarily last, which would attach the preview sink to a sibling branch.
  if (ir.steps.length === 0) {
    throw new Error(`Preview pipeline for ${targetNodeId} produced no IR steps`);
  }
  const exactStep = ir.steps.find(s => s.id === targetNodeId);
  // For composite nodes the output is the last `${targetNodeId}__s<n>` step.
  const compositeStep = [...ir.steps].reverse().find(s => s.id.startsWith(`${targetNodeId}__s`));
  const resolvedStep = exactStep ?? compositeStep ?? ir.steps[ir.steps.length - 1];

  // A Write/sink step's PTransform (e.g. WriteToCSVTransform) returns a write
  // result, not a PCollection of records — sampling/feathering THAT (instead
  // of the real data feeding into it) either produces garbage or crashes
  // deep in the runner. Previewing a sink means "show me the data it's
  // about to write," so redirect to its upstream input step instead.
  const targetOutputStepId =
    resolvedStep.type === IRStepType.Write && resolvedStep.inputs.length > 0
      ? resolvedStep.inputs[0]
      : resolvedStep.id;
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
