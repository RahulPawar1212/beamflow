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
      description: 'Database connection string (managed via the Configure Connection wizard).',
      placeholder: 'postgresql://username:password@localhost:5432/mydb',
      required: true,
      group: 'Source',
      order: 1,
    }),
    {
      key: 'connectionProvider',
      label: 'Connection Provider',
      type: SettingType.Text,
      defaultValue: 'PostgreSQL',
      hidden: true,
    } as any,
    {
      key: 'host',
      label: 'Host',
      type: SettingType.Text,
      defaultValue: 'localhost',
      hidden: true,
    } as any,
    {
      key: 'port',
      label: 'Port',
      type: SettingType.Number,
      defaultValue: 5432,
      hidden: true,
    } as any,
    {
      key: 'databaseName',
      label: 'Database Name',
      type: SettingType.Text,
      defaultValue: '',
      hidden: true,
    } as any,
    {
      key: 'username',
      label: 'Username',
      type: SettingType.Text,
      defaultValue: '',
      hidden: true,
    } as any,
    {
      key: 'password',
      label: 'Password',
      type: SettingType.Text,
      defaultValue: '',
      hidden: true,
    } as any,
    {
      key: 'sqlitePath',
      label: 'SQLite Path',
      type: SettingType.Text,
      defaultValue: 'beamflow.db',
      hidden: true,
    } as any,
    {
      key: 'containsProduction',
      label: 'Contains Production Data',
      type: SettingType.Boolean,
      defaultValue: false,
      hidden: true,
    } as any,
    {
      key: 'rememberConnection',
      label: 'Remember Connection',
      type: SettingType.Boolean,
      defaultValue: true,
      hidden: true,
    } as any,
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
