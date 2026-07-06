import { defineConfig } from 'drizzle-kit';

const dbUrl = process.env.DATABASE_URL;
const isPg = !!(dbUrl?.startsWith('postgresql://') || dbUrl?.startsWith('postgres://'));

export default defineConfig({
  schema: './src/db/schema.ts',
  out: isPg ? './drizzle/postgres' : './drizzle/sqlite',
  dialect: isPg ? 'postgresql' : 'sqlite',
  dbCredentials: {
    url: dbUrl || 'beamflow.db',
  },
});
