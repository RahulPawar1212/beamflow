import { db, isPostgres } from '../client.js';
import { sqliteUsers, pgUsers } from '../schema.js';
import { eq } from 'drizzle-orm';

const usersTable = isPostgres ? pgUsers : sqliteUsers;

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  createdAt: string;
}

export const usersRepo = {
  async findByEmail(email: string): Promise<User | null> {
    const results = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, email.toLowerCase().trim()))
      .limit(1);
    return (results[0] as User) || null;
  },

  async findById(id: string): Promise<User | null> {
    const results = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, id))
      .limit(1);
    return (results[0] as User) || null;
  },

  async create(user: User): Promise<void> {
    await db.insert(usersTable as any).values({
      id: user.id,
      email: user.email.toLowerCase().trim(),
      passwordHash: user.passwordHash,
      name: user.name,
      createdAt: user.createdAt,
    });
  },
};
