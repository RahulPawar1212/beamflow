/**
 * @module @beamflow/server
 *
 * BeamFlow API server — Fastify-based REST API.
 *
 * Responsibilities:
 * - Serve node definitions for the editor palette
 * - Pipeline CRUD (create, read, update, delete)
 * - Code generation (workflow → IR → Python Beam)
 * - Pipeline execution (local DirectRunner)
 *
 * Startup sequence:
 * 1. Create node registry
 * 2. Load built-in plugins
 * 3. Initialize storage
 * 4. Register routes
 * 5. Start server
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import { createRegistry } from '@beamflow/core';
import { createPluginLoader } from '@beamflow/core';
import { builtinNodesPlugin } from '@beamflow/nodes';
import { nodeRoutes } from './routes/nodes.js';
import { pipelineRoutes } from './routes/pipelines.js';
import { LocalJsonStorage } from './storage.js';

const PORT = parseInt(process.env.PORT || '3001', 10);
const HOST = process.env.HOST || '0.0.0.0';

async function main(): Promise<void> {
  // ─── 1. Initialize core systems ───────────────────────────────────
  console.log('[BeamFlow] Initializing...');

  // Create the node registry
  const registry = createRegistry();

  // Load plugins
  const pluginLoader = createPluginLoader(registry);
  const loaded = pluginLoader.load(builtinNodesPlugin);
  console.log(
    `[BeamFlow] Loaded plugin "${loaded.name}" with ${loaded.nodeCount} node types`,
  );

  // Initialize storage
  const storage = new LocalJsonStorage();

  // ─── 2. Create Fastify server ─────────────────────────────────────
  const app = Fastify({
    logger: {
      level: 'info',
    },
  });

  // CORS for frontend dev server
  await app.register(cors, {
    origin: [
      'http://localhost:5173', // Vite dev server
      'http://localhost:3000',
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  });

  // ─── 3. Register routes ───────────────────────────────────────────
  await nodeRoutes(app, registry);
  await pipelineRoutes(app, storage, registry);

  // Health check
  app.get('/api/health', async () => ({
    status: 'ok',
    version: '0.1.0',
    nodeTypes: registry.size,
    plugins: pluginLoader.getAllLoaded().map((p) => p.name),
  }));

  // ─── 4. Start server ─────────────────────────────────────────────
  try {
    await app.listen({ port: PORT, host: HOST });
    console.log(`[BeamFlow] Server running at http://${HOST}:${PORT}`);
    console.log(`[BeamFlow] ${registry.size} node types registered`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
