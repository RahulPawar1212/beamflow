import { migrate as migrateLibsql } from 'drizzle-orm/libsql/migrator';
import { migrate as migratePg } from 'drizzle-orm/postgres-js/migrator';
import { db, isPostgres } from './client.js';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function runMigrations(): Promise<void> {
  console.log('[Migrations] Checking database migrations...');
  try {
    if (isPostgres) {
      const folder = join(__dirname, '..', '..', 'drizzle', 'postgres');
      await migratePg(db, { migrationsFolder: folder });
    } else {
      const folder = join(__dirname, '..', '..', 'drizzle', 'sqlite');
      await migrateLibsql(db, { migrationsFolder: folder });
    }
    console.log('[Migrations] Database migrations applied successfully.');
  } catch (err) {
    console.error('[Migrations] Failed to run database migrations:', err);
    throw err;
  }
}
