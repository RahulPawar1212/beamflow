import { ISchemaNode, PipelineSchema, SchemaValidationIssue, emptySchema } from '@beamflow/schema';

/**
 * Schema node for subflow boundary/proxy nodes that simply forward their
 * upstream schema (`system:subflow-output`, `system:subflow` / `system:subflow-proxy`).
 *
 * These are pure passthroughs at design time: whatever schema reaches them from
 * the (inlined) upstream node is what they emit. Registering them explicitly
 * makes schema propagation across the subflow boundary deterministic instead of
 * relying on the "unknown node type" fallback stub in the editor.
 */
export class SubflowPassthroughSchemaNode implements ISchemaNode {
  constructor(
    public readonly nodeId: string,
    private readonly settings: Record<string, unknown>,
  ) {}

  getOutputSchema(inputSchemas: PipelineSchema[]): PipelineSchema {
    return inputSchemas[0] ?? emptySchema();
  }

  validateSchema(_inputSchemas: PipelineSchema[]): SchemaValidationIssue[] {
    return [];
  }
}
