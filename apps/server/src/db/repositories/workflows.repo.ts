import { db, isPostgres } from '../client.js';
import { sqliteWorkflows, pgWorkflows } from '../schema.js';
import { eq, and } from 'drizzle-orm';
import type { SerializedWorkflow } from '@beamflow/shared';

const workflowsTable = isPostgres ? pgWorkflows : sqliteWorkflows;

export const workflowsRepo = {
  async list(ownerId: string, options?: { includeSubflows?: boolean; projectId?: string }): Promise<SerializedWorkflow[]> {
    const conditions = [eq(workflowsTable.ownerId, ownerId)];
    if (!options?.includeSubflows) {
      conditions.push(eq(workflowsTable.isSubflow, 0));
    }
    // projectId scopes REGULAR workflows only. Subflows are a user-global shared
    // library (not tied to a project), so a projectId filter must not hide them.
    if (options?.projectId) {
      conditions.push(eq(workflowsTable.isSubflow, 0));
      conditions.push(eq(workflowsTable.projectId, options.projectId));
    }

    const results = await db
      .select()
      .from(workflowsTable)
      .where(and(...conditions));

    return results.map((row: any) => JSON.parse(row.settingsJson));
  },

  /** All of the user's subflows (the shared library) — never project-scoped. */
  async listSubflows(ownerId: string): Promise<SerializedWorkflow[]> {
    const results = await db
      .select()
      .from(workflowsTable)
      .where(and(eq(workflowsTable.ownerId, ownerId), eq(workflowsTable.isSubflow, 1)));
    return results.map((row: any) => JSON.parse(row.settingsJson));
  },

  /**
   * Count how many of the owner's workflows reference a given subflow (via a
   * `system:subflow` node whose settings.subflowId === subflowId). References
   * are embedded in each workflow's settings_json, so this scans parsed rows.
   */
  async countReferences(ownerId: string, subflowId: string): Promise<{ count: number; names: string[] }> {
    const rows = await db
      .select()
      .from(workflowsTable)
      .where(eq(workflowsTable.ownerId, ownerId));
    const names: string[] = [];
    for (const row of rows as any[]) {
      if (row.id === subflowId) continue; // don't count itself
      let wf: SerializedWorkflow;
      try { wf = JSON.parse(row.settingsJson); } catch { continue; }
      const refs = wf.nodes?.some(
        (n: any) => n.type === 'system:subflow' && n.settings?.subflowId === subflowId,
      );
      if (refs) names.push(wf.metadata?.name ?? row.name);
    }
    return { count: names.length, names };
  },

  async get(id: string, ownerId: string): Promise<SerializedWorkflow | null> {
    const results = await db
      .select()
      .from(workflowsTable)
      .where(
        and(
          eq(workflowsTable.id, id),
          eq(workflowsTable.ownerId, ownerId)
        )
      )
      .limit(1);
    
    if (results.length === 0) return null;
    return JSON.parse((results[0] as any).settingsJson);
  },

  async create(workflow: SerializedWorkflow, ownerId: string): Promise<void> {
    const now = workflow.metadata.createdAt;
    await db.insert(workflowsTable as any).values({
      id: workflow.metadata.id,
      ownerId,
      projectId: workflow.metadata.projectId ?? null,
      name: workflow.metadata.name,
      description: workflow.metadata.description || '',
      settingsJson: JSON.stringify(workflow),
      isSubflow: workflow.metadata.isSubflow ? 1 : 0,
      createdAt: now,
      updatedAt: now,
    });
  },

  async update(workflow: SerializedWorkflow, ownerId: string): Promise<void> {
    const now = workflow.metadata.updatedAt;
    const setValues: Record<string, unknown> = {
      name: workflow.metadata.name,
      description: workflow.metadata.description || '',
      settingsJson: JSON.stringify(workflow),
      isSubflow: workflow.metadata.isSubflow ? 1 : 0,
      updatedAt: now,
    };
    // Only touch project_id when the caller supplied one (allows moving a workflow
    // between projects without clobbering it on ordinary saves).
    if (workflow.metadata.projectId !== undefined) {
      setValues.projectId = workflow.metadata.projectId;
    }
    await db
      .update(workflowsTable as any)
      .set(setValues)
      .where(
        and(
          eq(workflowsTable.id, workflow.metadata.id),
          eq(workflowsTable.ownerId, ownerId)
        )
      );
  },

  async delete(id: string, ownerId: string): Promise<boolean> {
    // Check if it exists and belongs to the user
    const existing = await this.get(id, ownerId);
    if (!existing) return false;

    await db
      .delete(workflowsTable as any)
      .where(
        and(
          eq(workflowsTable.id, id),
          eq(workflowsTable.ownerId, ownerId)
        )
      );
    return true;
  }
};
