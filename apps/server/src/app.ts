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
import jwt from '@fastify/jwt';
import { createRegistry, createPluginLoader } from '@beamflow/core';
import type { NodeRegistry } from '@beamflow/core';
import { builtinNodesPlugin } from '@beamflow/nodes';
import { nodeRoutes } from './routes/nodes.js';
import { pipelineRoutes } from './routes/pipelines.js';
import { authRoutes } from './routes/auth.js';
import { variableRoutes } from './routes/variables.js';
import { versionRoutes } from './routes/versions.js';
import { DrizzleStorage, type IStorage } from './storage.js';
import { registerErrorHandler } from './errors.js';
import { runMigrations } from './db/migrate.js';

// Augment FastifyInstance type to include authenticate
declare module 'fastify' {
  interface FastifyInstance {
    authenticate: any;
  }
}

/** Server version, surfaced at `GET /api/health`. */
export const SERVER_VERSION = '0.1.0';

export interface BuildAppOptions {
  /** Storage backend. Defaults to database {@link DrizzleStorage}. */
  storage?: IStorage;
  /** Pre-populated registry. Defaults to a fresh registry + built-in nodes. */
  registry?: NodeRegistry;
  /** CORS origins. Defaults to the local dev origins. */
  corsOrigins?: string[];
  /** Fastify logger config. Defaults to `false` (quiet) — set `true` in prod. */
  logger?: boolean | { level: string };
  /** Set to true to skip running migrations (e.g. in some unit tests). */
  skipMigrations?: boolean;
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
  // Run database migrations before starting/setting up unless skipped
  if (!options.skipMigrations) {
    await runMigrations().catch((err) => {
      console.error('[buildApp] Error running migrations on startup:', err);
    });
  }

  // Registry + built-in nodes (unless a registry was supplied).
  const registry = options.registry ?? createRegistry();
  const loadedPlugins: string[] = [];
  if (!options.registry) {
    const pluginLoader = createPluginLoader(registry);
    const loaded = pluginLoader.load(builtinNodesPlugin);
    loadedPlugins.push(loaded.name);
  }

  const storage = options.storage ?? new DrizzleStorage();

  const app = Fastify({ logger: options.logger ?? false });

  await app.register(cors, {
    origin: options.corsOrigins ?? ['http://localhost:5173', 'http://localhost:3000'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // JWT Registration
  await app.register(jwt, {
    secret: process.env.JWT_SECRET || 'supersecretkey_change_me_in_production_12345!',
  });

  // Decorate fastify with authenticate hook
  app.decorate('authenticate', async (request: any, reply: any) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      reply.status(401).send({ error: 'Unauthorized or invalid token.' });
    }
  });

  registerErrorHandler(app);

  // Wire Routes
  await authRoutes(app);
  await variableRoutes(app);
  await versionRoutes(app);
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

