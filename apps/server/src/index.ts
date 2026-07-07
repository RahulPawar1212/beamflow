/**
 * @module @beamflow/server
 *
 * BeamFlow API server entry point — starts the Fastify app built by
 * {@link buildApp} (see `app.ts` for the wiring).
 *
 * Responsibilities:
 * - Serve node definitions for the editor palette
 * - Pipeline CRUD (create, read, update, delete)
 * - Code generation (workflow → IR → Python Beam)
 * - Pipeline execution (local DirectRunner)
 */

import { buildApp } from './app.js';

const PORT = parseInt(process.env.PORT || '3001', 10);
const HOST = process.env.HOST || '0.0.0.0';

/** CORS origins: `CORS_ORIGINS` (comma-separated) or the dev defaults. */
const CORS_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
  : undefined;

async function main(): Promise<void> {
  console.log('[BeamFlow] Initializing...');

  const { app, registry } = await buildApp({
    corsOrigins: CORS_ORIGINS,
    logger: { level: process.env.LOG_LEVEL || 'info' },
  });

  console.log(`[BeamFlow] ${registry.size} node types registered`);

  try {
    await app.listen({ port: PORT, host: HOST });
    console.log(`[BeamFlow] Server running at http://${HOST}:${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main().catch((err) => {
  // Startup failures (plugin load, registry, etc.) before app.listen's own guard.
  console.error('[BeamFlow] Fatal startup error:', err);
  process.exit(1);
});

// Trigger server restart

// Trigger server restart for mutex fix

// Trigger server restart for BigInt fix
