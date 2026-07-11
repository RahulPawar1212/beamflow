import type { FastifyInstance } from 'fastify';
import { projectsRepo } from '../db/repositories/projects.repo.js';
import { badRequest, notFound, ApiError } from '../errors.js';
import { getOrgId, getUserId } from '../auth-context.js';

export async function projectRoutes(app: FastifyInstance): Promise<void> {
  // Wrap in a plugin instance that enforces authentication
  app.register(async (appWithAuth) => {
    appWithAuth.addHook('preHandler', app.authenticate);

    /** GET /api/projects — List the org's projects. */
    appWithAuth.get('/api/projects', async (req, reply) => {
      const projects = await projectsRepo.list(getOrgId(req));
      return reply.send({ projects });
    });

    /** POST /api/projects — Create a project in the caller's org. */
    appWithAuth.post<{ Body: { name?: string; description?: string } }>(
      '/api/projects',
      async (req, reply) => {
        const name = req.body?.name?.trim();
        if (!name) {
          throw badRequest('Project name is required.');
        }
        const orgId = getOrgId(req);
        // Project names are unique per org.
        if (await projectsRepo.nameExists(orgId, name)) {
          throw new ApiError(409, `A project named "${name}" already exists in this organization.`);
        }
        const project = await projectsRepo.create(
          { name, description: req.body?.description },
          orgId,
          getUserId(req),
        );
        return reply.status(201).send(project);
      },
    );

    /** PUT /api/projects/:id — Rename / update a project. */
    appWithAuth.put<{ Params: { id: string }; Body: { name?: string; description?: string } }>(
      '/api/projects/:id',
      async (req, reply) => {
        const orgId = getOrgId(req);
        const newName = req.body?.name?.trim();
        // Renaming to a name another project already uses is a conflict.
        if (newName && (await projectsRepo.nameExists(orgId, newName, req.params.id))) {
          throw new ApiError(409, `A project named "${newName}" already exists in this organization.`);
        }
        const updated = await projectsRepo.update(req.params.id, orgId, {
          name: newName,
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
        const deleted = await projectsRepo.delete(req.params.id, getOrgId(req));
        if (!deleted) {
          throw notFound('Project not found or unauthorized.');
        }
        return reply.status(204).send();
      },
    );
  });
}
