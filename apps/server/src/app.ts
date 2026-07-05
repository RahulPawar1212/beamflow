/**
 * @module @beamflow/server/app
 *
 * Builds and wires the Fastify application (registry + plugins + storage +
 * routes + error handler) without starting the network listener. Kept separate
 * from `index.ts` so both production startup and tests share identical wiring —
 * tests import `buildApp()` and drive it with `app.inject()`.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { createRegistry, createPluginLoader } from '@beamflow/core';
import type { NodeRegistry } from '@beamflow/core';
import { builtinNodesPlugin } from '@beamflow/nodes';
import { nodeRoutes } from './routes/nodes.js';
import { pipelineRoutes } from './routes/pipelines.js';
import { LocalJsonStorage, type IStorage } from './storage.js';
import { registerErrorHandler } from './errors.js';

/** Server version, surfaced at `GET /api/health`. */
export const SERVER_VERSION = '0.1.0';

export interface BuildAppOptions {
  /** Storage backend. Defaults to on-disk {@link LocalJsonStorage}. */
  storage?: IStorage;
  /** Pre-populated registry. Defaults to a fresh registry + built-in nodes. */
  registry?: NodeRegistry;
  /** CORS origins. Defaults to the local dev origins. */
  corsOrigins?: string[];
  /** Fastify logger config. Defaults to `false` (quiet) — set `true` in prod. */
  logger?: boolean | { level: string };
}

/**
 * Construct the fully-wired Fastify app. Does NOT call `listen()`.
 *
 * @returns `{ app, registry, storage }` so callers/tests can inspect the wiring.
 */
export async function buildApp(options: BuildAppOptions = {}): Promise<{
  app: FastifyInstance;
  registry: NodeRegistry;
  storage: IStorage;
}> {
  // Registry + built-in nodes (unless a registry was supplied).
  const registry = options.registry ?? createRegistry();
  const loadedPlugins: string[] = [];
  if (!options.registry) {
    const pluginLoader = createPluginLoader(registry);
    const loaded = pluginLoader.load(builtinNodesPlugin);
    loadedPlugins.push(loaded.name);
  }

  const storage = options.storage ?? new LocalJsonStorage();

  const app = Fastify({ logger: options.logger ?? false });

  await app.register(cors, {
    origin: options.corsOrigins ?? ['http://localhost:5173', 'http://localhost:3000'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  });

  registerErrorHandler(app);

  await nodeRoutes(app, registry);
  await pipelineRoutes(app, storage, registry);

  app.get('/api/health', async () => ({
    status: 'ok',
    version: SERVER_VERSION,
    nodeTypes: registry.size,
    plugins: loadedPlugins,
  }));

  return { app, registry, storage };
}
