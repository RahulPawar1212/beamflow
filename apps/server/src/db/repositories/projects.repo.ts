import { db, isPostgres } from '../client.js';
import {
  sqliteProjects, pgProjects,
  sqliteWorkflows, pgWorkflows,
  sqliteWorkflowVersions, pgWorkflowVersions,
  sqliteVariables, pgVariables,
} from '../schema.js';
import { eq, and, isNull, inArray } from 'drizzle-orm';
import { generateId, timestamp } from '@beamflow/shared';
import type { IProject } from '@beamflow/shared';

const projectsTable = isPostgres ? pgProjects : sqliteProjects;
const workflowsTable = isPostgres ? pgWorkflows : sqliteWorkflows;
const versionsTable = isPostgres ? pgWorkflowVersions : sqliteWorkflowVersions;
const variablesTable = isPostgres ? pgVariables : sqliteVariables;

// Access is scoped by ORG: any member sees and manages the org's projects.
// `ownerId` is retained on each row as creator/provenance only.
export const projectsRepo = {
  async list(orgId: string): Promise<IProject[]> {
    const results = await db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.orgId, orgId));
    return results as IProject[];
  },

  async get(id: string, orgId: string): Promise<IProject | null> {
    const results = await db
      .select()
      .from(projectsTable)
      .where(and(eq(projectsTable.id, id), eq(projectsTable.orgId, orgId)))
      .limit(1);
    return (results[0] as IProject) || null;
  },

  async create(
    data: { name: string; description?: string },
    orgId: string,
    ownerId: string,
  ): Promise<IProject> {
    const now = timestamp();
    const project: IProject = {
      id: generateId('project'),
      orgId,
      ownerId,
      name: data.name,
      description: data.description || '',
      createdAt: now,
      updatedAt: now,
    };
    await db.insert(projectsTable as any).values(project);
    return project;
  },

  async update(
    id: string,
    orgId: string,
    data: { name?: string; description?: string },
  ): Promise<IProject | null> {
    const existing = await this.get(id, orgId);
    if (!existing) return null;
    const updated = {
      name: data.name ?? existing.name,
      description: data.description ?? existing.description ?? '',
      updatedAt: timestamp(),
    };
    await db
      .update(projectsTable as any)
      .set(updated)
      .where(and(eq(projectsTable.id, id), eq(projectsTable.orgId, orgId)));
    return { ...existing, ...updated };
  },

  async delete(id: string, orgId: string): Promise<boolean> {
    const existing = await this.get(id, orgId);
    if (!existing) return false;

    // Delete children explicitly rather than relying on SQLite ON DELETE CASCADE:
    // libSQL's local-file driver doesn't reliably honor `PRAGMA foreign_keys = ON`
    // across statements, so the DB-level cascade silently fails. Doing it in the
    // app is portable across SQLite and Postgres. Order matters: leaf rows
    // (versions, variables) → workflows → project.
    //
    // IMPORTANT: subflows are a shared library — they must SURVIVE a project
    // delete (other projects' workflows may reference them). Only regular
    // workflows (is_subflow=0) are deleted with the project.
    // (Phase 5 revisits whether subflows should become project-scoped.)
    const childWorkflows = await db
      .select({ id: workflowsTable.id })
      .from(workflowsTable)
      .where(and(
        eq(workflowsTable.projectId, id),
        eq(workflowsTable.orgId, orgId),
        eq(workflowsTable.isSubflow, 0),
      ));
    const workflowIds = childWorkflows.map((w: any) => w.id);

    if (workflowIds.length > 0) {
      await db.delete(versionsTable as any).where(inArray(versionsTable.workflowId, workflowIds));
      await db.delete(variablesTable as any).where(inArray(variablesTable.workflowId, workflowIds));
      await db
        .delete(workflowsTable as any)
        .where(and(
          eq(workflowsTable.projectId, id),
          eq(workflowsTable.orgId, orgId),
          eq(workflowsTable.isSubflow, 0),
        ));
    }

    // Detach any subflow that happened to carry this projectId, so the DB-level
    // FK cascade (Postgres) can't take it with the project either.
    await db
      .update(workflowsTable as any)
      .set({ projectId: null })
      .where(and(
        eq(workflowsTable.projectId, id),
        eq(workflowsTable.orgId, orgId),
        eq(workflowsTable.isSubflow, 1),
      ));

    await db
      .delete(projectsTable as any)
      .where(and(eq(projectsTable.id, id), eq(projectsTable.orgId, orgId)));
    return true;
  },

  /**
   * Return the org's default project, creating it if it has none.
   * Used when a workflow is saved without an explicit project.
   */
  async ensureDefaultProject(orgId: string, ownerId: string): Promise<IProject> {
    const existing = await this.list(orgId);
    if (existing.length > 0) return existing[0];
    return this.create({ name: 'Default Project', description: 'Auto-created default project.' }, orgId, ownerId);
  },
};

/**
 * Idempotent startup backfill: give every ORG with no project a "Default Project"
 * and file any project-less workflow into its org's default project. Safe to run
 * on every boot — a no-op once each org has a project and no NULL project_id remains.
 *
 * Must run AFTER ensureDefaultOrg (which sets org_id on every workflow), since it
 * groups orphan workflows by org.
 */
export async function ensureDefaultProjects(): Promise<void> {
  // Find REGULAR workflows with no project; assign each org's default project.
  // Subflows are intentionally project-less (shared library) — never backfill them,
  // or they'd get re-attached to a project on every boot.
  const orphanWorkflows = await db
    .select()
    .from(workflowsTable)
    .where(and(isNull(workflowsTable.projectId), eq(workflowsTable.isSubflow, 0)));

  if (orphanWorkflows.length === 0) return;

  // Group by org. Use each workflow's own ownerId as the created-project's
  // provenance owner (any member's id is fine for a shared default project).
  const byOrg = new Map<string, string>(); // orgId -> a representative ownerId
  for (const w of orphanWorkflows as any[]) {
    if (w.orgId && !byOrg.has(w.orgId)) byOrg.set(w.orgId, w.ownerId);
  }

  for (const [orgId, ownerId] of byOrg) {
    const project = await projectsRepo.ensureDefaultProject(orgId, ownerId);
    await db
      .update(workflowsTable as any)
      .set({ projectId: project.id })
      .where(and(
        eq(workflowsTable.orgId, orgId),
        isNull(workflowsTable.projectId),
        eq(workflowsTable.isSubflow, 0),
      ));
  }
}
