import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import { usersRepo } from '../db/repositories/users.repo.js';
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

      // Generate JWT
      const token = app.jwt.sign({ id: user.id, email: user.email, name: user.name });

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

      // Generate JWT
      const token = app.jwt.sign({ id: user.id, email: user.email, name: user.name });

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
