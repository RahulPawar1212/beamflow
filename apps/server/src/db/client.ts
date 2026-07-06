import { drizzle as drizzleLibsql } from 'drizzle-orm/libsql';
import { drizzle as drizzlePg } from 'drizzle-orm/postgres-js';
import { createClient } from '@libsql/client';
import postgres from 'postgres';
import * as schema from './schema.js';

const dbUrl = process.env.DATABASE_URL;
const isPg = !!(dbUrl?.startsWith('postgresql://') || dbUrl?.startsWith('postgres://'));

let dbInstance: any;

if (isPg) {
  const queryClient = postgres(dbUrl!);
  dbInstance = drizzlePg(queryClient, { schema });
  console.log('[Database] Connected to PostgreSQL');
} else {
  const sqliteFile = process.env.NODE_ENV === 'test'
    ? 'file::memory:?cache=shared'
    : (dbUrl?.startsWith('file:') ? dbUrl : `file:${dbUrl || 'beamflow.db'}`);
  const client = createClient({ url: sqliteFile });
  dbInstance = drizzleLibsql(client, { schema });
  console.log(`[Database] Connected to LibSQL/SQLite (${sqliteFile})`);
}

export const db = dbInstance;
export const isPostgres = isPg;
