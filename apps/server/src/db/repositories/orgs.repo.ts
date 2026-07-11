import { db, isPostgres } from '../client.js';
import {
  sqliteOrganizations, pgOrganizations,
  sqliteMemberships, pgMemberships,
  sqliteUsers, pgUsers,
  sqliteProjects, pgProjects,
  sqliteWorkflows, pgWorkflows,
} from '../schema.js';
import { eq, and, isNull, asc } from 'drizzle-orm';
import { generateId, timestamp } from '@beamflow/shared';
import type { IOrganization, IMembership } from '@beamflow/shared';

const orgsTable = isPostgres ? pgOrganizations : sqliteOrganizations;
const membershipsTable = isPostgres ? pgMemberships : sqliteMemberships;
const usersTable = isPostgres ? pgUsers : sqliteUsers;
const projectsTable = isPostgres ? pgProjects : sqliteProjects;
const workflowsTable = isPostgres ? pgWorkflows : sqliteWorkflows;

export const orgsRepo = {
  async get(id: string): Promise<IOrganization | null> {
    const rows = await db.select().from(orgsTable).where(eq(orgsTable.id, id)).limit(1);
    return (rows[0] as IOrganization) || null;
  },

  async create(name: string): Promise<IOrganization> {
    const now = timestamp();
    const org: IOrganization = { id: generateId('org'), name, createdAt: now, updatedAt: now };
    await db.insert(orgsTable as any).values(org);
    return org;
  },

  /** The user's membership row, if any (used to resolve their active org). */
  async membershipForUser(userId: string): Promise<IMembership | null> {
    const rows = await db
      .select()
      .from(membershipsTable)
      .where(eq(membershipsTable.userId, userId))
      .limit(1);
    return (rows[0] as IMembership) || null;
  },

  /** Add a user to an org (idempotent — no duplicate if already a member). */
  async addMember(orgId: string, userId: string, role: IMembership['role'] = 'member'): Promise<void> {
    const existing = await db
      .select({ id: membershipsTable.id })
      .from(membershipsTable)
      .where(and(eq(membershipsTable.orgId, orgId), eq(membershipsTable.userId, userId)))
      .limit(1);
    if (existing.length > 0) return;
    await db.insert(membershipsTable as any).values({
      id: generateId('mbr'),
      orgId,
      userId,
      role,
      createdAt: timestamp(),
    });
  },
};

/**
 * Idempotent startup backfill for the org model. Establishes a single shared
 * "Default Organization", makes every existing user a member of it (the earliest
 * user by created_at becomes the owner), and re-keys every project and workflow
 * to it. Safe to run on every boot: it early-returns once an org exists AND no
 * project/workflow has a NULL org_id.
 *
 * This is the one-org-now form of the multi-tenant model — the schema already
 * supports many orgs, so onboarding a second org later is data, not migration.
 */
export async function ensureDefaultOrg(): Promise<void> {
  // 1. Ensure exactly one default org exists.
  const existingOrgs = await db.select().from(orgsTable).limit(1);
  let org: IOrganization;
  if (existingOrgs.length > 0) {
    org = existingOrgs[0] as IOrganization;
  } else {
    // No org yet: nothing to do if there are also no users/rows to attach.
    org = await orgsRepo.create('Default Organization');
  }

  // 2. Every user becomes a member. Earliest-created user is the org owner.
  const users = await db.select().from(usersTable).orderBy(asc(usersTable.createdAt));
  for (let i = 0; i < users.length; i++) {
    const u = users[i] as any;
    await orgsRepo.addMember(org.id, u.id, i === 0 ? 'owner' : 'member');
  }

  // 3. Re-key any project/workflow with a NULL org_id to the default org.
  await db
    .update(projectsTable as any)
    .set({ orgId: org.id })
    .where(isNull(projectsTable.orgId));
  await db
    .update(workflowsTable as any)
    .set({ orgId: org.id })
    .where(isNull(workflowsTable.orgId));
}
