import type { FastifyInstance } from 'fastify';
import { variablesRepo } from '../db/repositories/variables.repo.js';
import { badRequest } from '../errors.js';
import { getOrgId } from '../auth-context.js';

export async function variableRoutes(app: FastifyInstance): Promise<void> {
  // Wrap in a plugin instance that enforces authentication
  app.register(async (appWithAuth) => {
    appWithAuth.addHook('preHandler', app.authenticate);

    /** GET /api/pipelines/:id/variables — List variables for a pipeline */
    appWithAuth.get<{ Params: { id: string } }>(
      '/api/pipelines/:id/variables',
      async (req, reply) => {
        const variables = await variablesRepo.list(req.params.id, getOrgId(req));
        return reply.send({ variables });
      }
    );

    /** POST /api/pipelines/:id/variables — Create or update variable */
    appWithAuth.post<{ Params: { id: string }; Body: { environment?: string; name?: string; value?: string; isSecret?: boolean } }>(
      '/api/pipelines/:id/variables',
      async (req, reply) => {
        const { environment, name, value, isSecret } = req.body;

        if (!name || value === undefined) {
          throw badRequest('Variable name and value are required.');
        }

        await variablesRepo.set({
          workflowId: req.params.id,
          environment: environment || 'default',
          name,
          value,
          isSecret: !!isSecret,
        }, getOrgId(req));

        return reply.status(201).send({ status: 'ok' });
      }
    );

    /** DELETE /api/pipelines/:id/variables/:name — Delete a variable */
    appWithAuth.delete<{ Params: { id: string; name: string }; Querystring: { environment?: string } }>(
      '/api/pipelines/:id/variables/:name',
      async (req, reply) => {
        const environment = req.query.environment || 'default';
        const deleted = await variablesRepo.delete(req.params.id, environment, req.params.name, getOrgId(req));

        if (!deleted) {
          throw badRequest('Variable not found or unauthorized.');
        }

        return reply.status(204).send();
      }
    );
  });
}
