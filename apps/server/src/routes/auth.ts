import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import { usersRepo } from '../db/repositories/users.repo.js';
import { orgsRepo, ensureDefaultOrg } from '../db/repositories/orgs.repo.js';
import { ApiError, badRequest } from '../errors.js';

export async function authRoutes(app: FastifyInstance): Promise<void> {
  /** POST /api/auth/register — Register a new user */
  app.post<{ Body: { email?: string; password?: string; name?: string } }>(
    '/api/auth/register',
    async (req, reply) => {
      const { email, password, name } = req.body;

      if (!email || !password || !name) {
        throw badRequest('Email, password, and name are required.');
      }

      if (password.length < 6) {
        throw badRequest('Password must be at least 6 characters long.');
      }

      // Check for duplicate user
      const existing = await usersRepo.findByEmail(email);
      if (existing) {
        throw new ApiError(409, 'A user with this email already exists.');
      }

      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(password, salt);
      const id = `usr_${nanoid(8)}`;

      const user = {
        id,
        email: email.toLowerCase().trim(),
        passwordHash,
        name,
        createdAt: new Date().toISOString(),
      };

      await usersRepo.create(user);

      // Auto-join the shared Default Organization. ensureDefaultOrg is idempotent
      // and guarantees the org exists (creating it if this is the very first user);
      // it also adds every existing user, so the new user gets a membership too.
      await ensureDefaultOrg();
      const membership = await orgsRepo.membershipForUser(user.id);
      const orgId = membership?.orgId;

      // Generate JWT — carries the active org so every request is org-scoped.
      const token = app.jwt.sign({ id: user.id, email: user.email, name: user.name, orgId });

      return reply.status(201).send({
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
        },
      });
    },
  );

  /** POST /api/auth/login — Sign in */
  app.post<{ Body: { email?: string; password?: string } }>(
    '/api/auth/login',
    async (req, reply) => {
      const { email, password } = req.body;

      if (!email || !password) {
        throw badRequest('Email and password are required.');
      }

      const user = await usersRepo.findByEmail(email);
      if (!user) {
        throw new ApiError(401, 'Invalid email or password.');
      }

      const isMatch = await bcrypt.compare(password, user.passwordHash);
      if (!isMatch) {
        throw new ApiError(401, 'Invalid email or password.');
      }

      // Resolve the user's active org. Older accounts created before the org
      // model may lack a membership — ensureDefaultOrg backfills one.
      let membership = await orgsRepo.membershipForUser(user.id);
      if (!membership) {
        await ensureDefaultOrg();
        membership = await orgsRepo.membershipForUser(user.id);
      }
      const orgId = membership?.orgId;

      // Generate JWT — carries the active org so every request is org-scoped.
      const token = app.jwt.sign({ id: user.id, email: user.email, name: user.name, orgId });

      return reply.send({
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
        },
      });
    },
  );

  /** GET /api/auth/me — Get current user session */
  app.get(
    '/api/auth/me',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const payload = req.user as { id: string; email: string; name: string };
      const user = await usersRepo.findById(payload.id);

      if (!user) {
        throw new ApiError(404, 'User not found.');
      }

      return reply.send({
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
        },
      });
    },
  );
}
