import { ISchemaNode, PipelineSchema, SchemaValidationIssue, createColumn, emptySchema, bumpVersion, ColumnDataType } from '@beamflow/schema';

export class SubflowInputSchemaNode implements ISchemaNode {
  constructor(
    public readonly nodeId: string,
    private readonly settings: Record<string, unknown>,
  ) {}

  getOutputSchema(inputSchemas: PipelineSchema[]): PipelineSchema {
    // If it is wired to an upstream node (e.g. inlined into a parent workflow during
    // expandForSchema), forward that real schema — even if it is currently empty (the
    // upstream source may just not be configured yet). Fabricating mock columns here
    // would produce a design-time schema that never matches runtime.
    if (inputSchemas.length > 0 && inputSchemas[0]) {
      return inputSchemas[0];
    }

    // Otherwise, we are editing the subflow standalone (no incoming edge). Use mockColumns.
    const mockStr = typeof this.settings.mockColumns === 'string' ? this.settings.mockColumns : '';
    if (!mockStr.trim()) {
      return emptySchema();
    }

    const colNames = mockStr.split(',').map(s => s.trim()).filter(s => s.length > 0);
    const columns = colNames.map(name => createColumn({ name, type: ColumnDataType.STRING, nullable: true, sourceNodeId: this.nodeId }));

    
    return {
      version: 1,
      columns,
    };
  }

  validateSchema(inputSchemas: PipelineSchema[]): SchemaValidationIssue[] {
    return [];
  }
}
