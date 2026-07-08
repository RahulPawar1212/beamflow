import type { FastifyInstance } from 'fastify';
import { projectsRepo } from '../db/repositories/projects.repo.js';
import { badRequest, notFound } from '../errors.js';

export async function projectRoutes(app: FastifyInstance): Promise<void> {
  // Wrap in a plugin instance that enforces authentication
  app.register(async (appWithAuth) => {
    appWithAuth.addHook('preHandler', app.authenticate);

    /** GET /api/projects — List the user's projects. */
    appWithAuth.get('/api/projects', async (req, reply) => {
      const userId = (req.user as any).id;
      const projects = await projectsRepo.list(userId);
      return reply.send({ projects });
    });

    /** POST /api/projects — Create a project. */
    appWithAuth.post<{ Body: { name?: string; description?: string } }>(
      '/api/projects',
      async (req, reply) => {
        const userId = (req.user as any).id;
        const name = req.body?.name?.trim();
        if (!name) {
          throw badRequest('Project name is required.');
        }
        const project = await projectsRepo.create(
          { name, description: req.body?.description },
          userId,
        );
        return reply.status(201).send(project);
      },
    );

    /** PUT /api/projects/:id — Rename / update a project. */
    appWithAuth.put<{ Params: { id: string }; Body: { name?: string; description?: string } }>(
      '/api/projects/:id',
      async (req, reply) => {
        const userId = (req.user as any).id;
        const updated = await projectsRepo.update(req.params.id, userId, {
          name: req.body?.name?.trim(),
          description: req.body?.description,
        });
        if (!updated) {
          throw notFound('Project not found or unauthorized.');
        }
        return reply.send(updated);
      },
    );

    /** DELETE /api/projects/:id — Delete a project and all its workflows (cascade). */
    appWithAuth.delete<{ Params: { id: string } }>(
      '/api/projects/:id',
      async (req, reply) => {
        const userId = (req.user as any).id;
        const deleted = await projectsRepo.delete(req.params.id, userId);
        if (!deleted) {
          throw notFound('Project not found or unauthorized.');
        }
        return reply.status(204).send();
      },
    );
  });
}
