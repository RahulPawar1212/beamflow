import type { FastifyInstance } from 'fastify';
import { db, isPostgres } from '../db/client.js';
import { sqliteUsers, pgUsers } from '../db/schema.js';
import { eq } from 'drizzle-orm';

export async function userRoutes(app: FastifyInstance): Promise<void> {
  // Get current user profile
  app.get('/api/users/me', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const userId = (req.user as any).id;
    let user;

    if (isPostgres) {
      user = await db.select().from(pgUsers).where(eq(pgUsers.id, userId)).get();
    } else {
      user = await db.select().from(sqliteUsers).where(eq(sqliteUsers.id, userId)).get();
    }

    if (!user) {
      return reply.code(404).send({ error: 'User not found' });
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      geminiApiKey: user.geminiApiKey || null,
      createdAt: user.createdAt,
    };
  });

  // Update current user profile
  app.put('/api/users/me', {
    preHandler: [app.authenticate],
    schema: {
      body: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          geminiApiKey: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const userId = (req.user as any).id;
    const { name, geminiApiKey } = req.body as { name?: string; geminiApiKey?: string };
    
    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (geminiApiKey !== undefined) updateData.geminiApiKey = geminiApiKey;

    if (Object.keys(updateData).length === 0) {
      return reply.send({ success: true });
    }

    if (isPostgres) {
      await db.update(pgUsers).set(updateData).where(eq(pgUsers.id, userId));
    } else {
      await db.update(sqliteUsers).set(updateData).where(eq(sqliteUsers.id, userId));
    }

    return { success: true };
  });
}
