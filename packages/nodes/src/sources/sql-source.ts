/**
 * SQL Connection Source node (`beamflow:sql-source`).
 *
 * Reads records from a database by running a SQL query.
 *
 * - Category: Source
 * - Ports:    out → Records (no inputs)
 * - Settings: connectionString (required), sqlQuery (required, sql text-area)
 * - Emits IR: { operation: 'ReadFromSQL', stepType: Read } with those params.
 */

import { NodeCategory, IRStepType, SettingType } from '@beamflow/shared';
import {
  defineNode,
  outputPort,
  textSetting,
  requiredError,
} from '../helpers.js';

export const sqlSource = defineNode({
  type: 'beamflow:sql-source',
  name: 'SQL Source',
  description: 'Read data from a database by running a SQL query.',
  category: NodeCategory.Source,
  icon: 'database',
  tags: ['sql', 'database', 'source', 'input', 'query', 'postgres', 'sqlite'],

  ports: [
    outputPort('out', 'Records'),
  ],

  settings: [
    textSetting('connectionString', 'Connection String', {
      description: 'Database connection string (e.g. postgresql://user:pass@host:5432/db or file:beamflow.db).',
      placeholder: 'postgresql://username:password@localhost:5432/mydb',
      required: true,
      group: 'Source',
      order: 1,
    }),
    {
      key: 'sqlQuery',
      label: 'SQL Query',
      description: 'The SQL query to fetch records.',
      type: SettingType.SQL,
      defaultValue: 'SELECT * FROM my_table',
      placeholder: 'SELECT id, name, age FROM users WHERE age > 18',
      validation: [
        {
          type: 'required',
          message: 'SQL Query is required.',
        },
      ],
      group: 'Source',
      order: 2,
    } as any,
  ],

  validate(settings) {
    const issues = [];
    if (!settings.connectionString || (settings.connectionString as string).trim() === '') {
      issues.push(requiredError('connectionString', 'Connection String is required.'));
    }
    if (!settings.sqlQuery || (settings.sqlQuery as string).trim() === '') {
      issues.push(requiredError('sqlQuery', 'SQL Query is required.'));
    }
    return issues;
  },

  toIR(settings, nodeId) {
    return {
      operation: 'ReadFromSQL',
      stepType: IRStepType.Read,
      params: {
        connectionString: settings.connectionString,
        sqlQuery: settings.sqlQuery,
      },
      imports: [],
    };
  },
});
