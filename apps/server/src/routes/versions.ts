import type { FastifyInstance } from 'fastify';
import { versionsRepo } from '../db/repositories/versions.repo.js';
import { workflowsRepo } from '../db/repositories/workflows.repo.js';
import { badRequest, notFound } from '../errors.js';
import { getOrgId } from '../auth-context.js';

export async function versionRoutes(app: FastifyInstance): Promise<void> {
  // Wrap in a plugin instance that enforces authentication
  app.register(async (appWithAuth) => {
    appWithAuth.addHook('preHandler', app.authenticate);

    /** GET /api/pipelines/:id/versions — List version history */
    appWithAuth.get<{ Params: { id: string } }>(
      '/api/pipelines/:id/versions',
      async (req, reply) => {
        const versions = await versionsRepo.list(req.params.id, getOrgId(req));
        return reply.send({ versions });
      }
    );

    /** GET /api/pipelines/:id/versions/:vid — Get a specific version snapshot */
    appWithAuth.get<{ Params: { id: string; vid: string } }>(
      '/api/pipelines/:id/versions/:vid',
      async (req, reply) => {
        const version = await versionsRepo.get(req.params.vid, req.params.id, getOrgId(req));
        if (!version) {
          throw notFound('Version not found.');
        }
        return reply.send(version);
      }
    );

    /** POST /api/pipelines/:id/versions — Snapshot current pipeline state */
    appWithAuth.post<{ Params: { id: string }; Body: { label?: string } }>(
      '/api/pipelines/:id/versions',
      async (req, reply) => {
        const orgId = getOrgId(req);
        const label = req.body?.label || null;

        // Get current pipeline state
        const workflow = await workflowsRepo.get(req.params.id, orgId);
        if (!workflow) {
          throw notFound('Pipeline not found.');
        }

        const newVersion = await versionsRepo.create(req.params.id, workflow, label, orgId);
        return reply.status(201).send(newVersion);
      }
    );
  });
}
