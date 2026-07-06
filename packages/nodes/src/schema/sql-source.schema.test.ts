import { describe, it, expect } from 'vitest';
import { SqlSourceSchemaNode } from './sql-source.schema.js';
import { ColumnDataType, emptySchema } from '@beamflow/schema';

describe('SqlSourceSchemaNode', () => {
  it('returns empty schema when no columns are configured', () => {
    const node = new SqlSourceSchemaNode('node_1', {});
    const schema = node.getOutputSchema([]);
    expect(schema).toEqual(emptySchema());
  });

  it('correctly maps columns with stable source attributes', () => {
    const node = new SqlSourceSchemaNode('node_1', {
      schemaColumns: [
        { name: 'id', type: 'integer' },
        { name: 'name', type: 'string' },
      ],
    });

    const schema = node.getOutputSchema([]);
    expect(schema.columns).toHaveLength(2);

    expect(schema.columns[0]).toEqual({
      id: 'node_1:id',
      name: 'id',
      type: ColumnDataType.INTEGER,
      nullable: true,
      sourceNodeId: 'node_1',
      sourceColumn: 'id',
    });

    expect(schema.columns[1]).toEqual({
      id: 'node_1:name',
      name: 'name',
      type: ColumnDataType.STRING,
      nullable: true,
      sourceNodeId: 'node_1',
      sourceColumn: 'name',
    });
  });

  it('runs validation checking types and names', () => {
    const nodeValid = new SqlSourceSchemaNode('node_1', {
      schemaColumns: [
        { name: 'id', type: 'integer' },
      ],
    });
    const issuesValid = nodeValid.validateSchema([]);
    expect(issuesValid).toHaveLength(0);

    const nodeInvalid = new SqlSourceSchemaNode('node_2', {
      schemaColumns: [
        { name: '', type: 'string' },
        { name: 'duplicate', type: 'string' },
        { name: 'duplicate', type: 'string' },
        { name: 'bad_type', type: 'unknown_type' },
      ],
    });
    const issuesInvalid = nodeInvalid.validateSchema([]);
    expect(issuesInvalid.length).toBeGreaterThan(0);
  });
});
