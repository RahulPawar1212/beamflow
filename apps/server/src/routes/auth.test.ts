import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { MemoryStorage } from '../test-helpers.js';
import { usersRepo } from '../db/repositories/users.repo.js';

describe('auth routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    ({ app } = await buildApp({
      storage: new MemoryStorage(),
    }));
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('POST /api/auth/register', () => {
    it('registers a user successfully and returns a token', async () => {
      const email = `newuser_${Math.random().toString(36).substring(2, 8)}@example.com`;
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          email,
          password: 'password123',
          name: 'Jane Doe',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.token).toBeDefined();
      expect(body.user.email).toBe(email);
      expect(body.user.name).toBe('Jane Doe');
      expect(body.user.id).toBeDefined();

      // Ensure user was added to DB
      const userInDb = await usersRepo.findByEmail(email);
      expect(userInDb).toBeDefined();
      expect(userInDb!.name).toBe('Jane Doe');
    });

    it('rejects incomplete fields', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          email: 'partial@example.com',
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it('prevents registering duplicate email', async () => {
      const email = `dupe_${Math.random().toString(36).substring(2, 8)}@example.com`;
      // First registration
      await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          email,
          password: 'password123',
          name: 'First User',
        },
      });

      // Second registration
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          email: email.toUpperCase(), // check case insensitivity
          password: 'password123',
          name: 'Second User',
        },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().error).toMatch(/exists/i);
    });
  });

  describe('POST /api/auth/login', () => {
    let email: string;

    beforeEach(async () => {
      email = `loginuser_${Math.random().toString(36).substring(2, 8)}@example.com`;
      await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          email,
          password: 'password123',
          name: 'Login User',
        },
      });
    });

    it('logs in successfully with valid credentials', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          email,
          password: 'password123',
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().token).toBeDefined();
      expect(res.json().user.email).toBe(email);
    });

    it('fails with incorrect password', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          email,
          password: 'wrongpassword',
        },
      });

      expect(res.statusCode).toBe(401);
    });

    it('fails with unregistered email', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          email: 'ghost@example.com',
          password: 'password123',
        },
      });

      expect(res.statusCode).toBe(401);
    });
  });

  describe('GET /api/auth/me', () => {
    it('returns 401 without token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns profile session with valid token', async () => {
      const email = `me_${Math.random().toString(36).substring(2, 8)}@example.com`;
      const reg = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          email,
          password: 'password123',
          name: 'Me User',
        },
      });
      const token = reg.json().token;

      const res = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().user.email).toBe(email);
      expect(res.json().user.name).toBe('Me User');
    });
  });
});
