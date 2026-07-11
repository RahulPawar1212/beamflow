import { db, isPostgres } from '../client.js';
import { sqliteWorkflows, pgWorkflows } from '../schema.js';
import { eq, and } from 'drizzle-orm';
import type { SerializedWorkflow } from '@beamflow/shared';

const workflowsTable = isPostgres ? pgWorkflows : sqliteWorkflows;

// Access is scoped by ORG: any member of the org can read/write the org's
// workflows. `ownerId` is retained on each row as creator/provenance only — it
// is no longer an access gate. Every query below filters by `orgId`.
export const workflowsRepo = {
  async list(orgId: string, options?: { includeSubflows?: boolean; projectId?: string }): Promise<SerializedWorkflow[]> {
    const conditions = [eq(workflowsTable.orgId, orgId)];
    if (!options?.includeSubflows) {
      conditions.push(eq(workflowsTable.isSubflow, 0));
    }
    // projectId scopes REGULAR workflows only. Subflows are a shared library
    // (not tied to a project), so a projectId filter must not hide them.
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

  /** All of the org's subflows (the shared library) — never project-scoped. */
  async listSubflows(orgId: string): Promise<SerializedWorkflow[]> {
    const results = await db
      .select()
      .from(workflowsTable)
      .where(and(eq(workflowsTable.orgId, orgId), eq(workflowsTable.isSubflow, 1)));
    return results.map((row: any) => JSON.parse(row.settingsJson));
  },

  /**
   * Count how many of the org's workflows reference a given subflow (via a
   * `system:subflow` node whose settings.subflowId === subflowId). References
   * are embedded in each workflow's settings_json, so this scans parsed rows.
   */
  async countReferences(orgId: string, subflowId: string): Promise<{ count: number; names: string[] }> {
    const rows = await db
      .select()
      .from(workflowsTable)
      .where(eq(workflowsTable.orgId, orgId));
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

  async get(id: string, orgId: string): Promise<SerializedWorkflow | null> {
    const results = await db
      .select()
      .from(workflowsTable)
      .where(
        and(
          eq(workflowsTable.id, id),
          eq(workflowsTable.orgId, orgId)
        )
      )
      .limit(1);

    if (results.length === 0) return null;
    return JSON.parse((results[0] as any).settingsJson);
  },

  async create(workflow: SerializedWorkflow, orgId: string, ownerId: string): Promise<void> {
    const now = workflow.metadata.createdAt;
    await db.insert(workflowsTable as any).values({
      id: workflow.metadata.id,
      orgId,
      ownerId,
      projectId: workflow.metadata.projectId ?? null,
      name: workflow.metadata.name,
      description: workflow.metadata.description || '',
      settingsJson: JSON.stringify(workflow),
      isSubflow: workflow.metadata.isSubflow ? 1 : 0,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
  },

  /**
   * Version-guarded update — the optimistic-concurrency write.
   *
   * `expectedVersion` is the version the caller loaded. The write only lands if
   * the stored row is still at that version; otherwise a teammate saved in the
   * meantime and we return `{ ok: false, currentVersion }` (the caller turns that
   * into a 409) WITHOUT clobbering their work. On success the row's version is
   * bumped by 1 and the new value returned.
   *
   * `expectedVersion` undefined skips the guard (unconditional write) — used only
   * by internal callers that don't participate in concurrency (e.g. legacy saves).
   */
  async update(
    workflow: SerializedWorkflow,
    orgId: string,
    expectedVersion?: number,
  ): Promise<{ ok: true; version: number } | { ok: false; currentVersion: number | null }> {
    const now = workflow.metadata.updatedAt;

    // isSubflow is IDENTITY, fixed once at create() and never mutable by an
    // ordinary update — regardless of which route or caller reaches here, or
    // what the caller's workflow object claims. Re-read the row we're actually
    // about to overwrite and pin isSubflow to its existing value. This is the
    // single choke point for every workflow write, so this is the one place
    // that guarantees identity can't drift (a route-level check alone can be
    // bypassed by a new/changed call site).
    const rows = await db
      .select()
      .from(workflowsTable)
      .where(and(eq(workflowsTable.id, workflow.metadata.id), eq(workflowsTable.orgId, orgId)))
      .limit(1);
    const existingRow = rows[0] as any | undefined;
    const existing: SerializedWorkflow | null = existingRow ? JSON.parse(existingRow.settingsJson) : null;
    const storedVersion: number | null = existingRow?.version ?? null;

    // Concurrency guard: if the caller loaded an older version than what's stored,
    // reject rather than overwrite. (storedVersion null → row is gone; also a conflict.)
    if (expectedVersion !== undefined && storedVersion !== expectedVersion) {
      return { ok: false, currentVersion: storedVersion };
    }

    const isSubflow = existing ? (existing.metadata.isSubflow ? 1 : 0) : (workflow.metadata.isSubflow ? 1 : 0);
    const nextVersion = (storedVersion ?? 0) + 1;
    const persistedWorkflow: SerializedWorkflow = {
      ...workflow,
      metadata: { ...workflow.metadata, isSubflow: !!isSubflow, version: nextVersion },
    };

    const setValues: Record<string, unknown> = {
      name: workflow.metadata.name,
      description: workflow.metadata.description || '',
      settingsJson: JSON.stringify(persistedWorkflow),
      isSubflow,
      version: nextVersion,
      updatedAt: now,
    };
    // Only touch project_id when the caller supplied one (allows moving a workflow
    // between projects without clobbering it on ordinary saves).
    if (workflow.metadata.projectId !== undefined) {
      setValues.projectId = workflow.metadata.projectId;
    }

    // Conditional write: the version predicate makes the check-and-bump atomic —
    // two concurrent saves at the same base version can't both land, even if they
    // both passed the read-check above (whoever writes second matches 0 rows).
    const conditions = [
      eq(workflowsTable.id, workflow.metadata.id),
      eq(workflowsTable.orgId, orgId),
    ];
    if (expectedVersion !== undefined && storedVersion !== null) {
      conditions.push(eq(workflowsTable.version, expectedVersion));
    }
    await db
      .update(workflowsTable as any)
      .set(setValues)
      .where(and(...conditions));

    // Confirm the write landed at the version we intended (guards the race where a
    // concurrent writer slipped in between the read and this UPDATE).
    const after = await db
      .select({ version: workflowsTable.version })
      .from(workflowsTable)
      .where(and(eq(workflowsTable.id, workflow.metadata.id), eq(workflowsTable.orgId, orgId)))
      .limit(1);
    const landedVersion = (after[0] as any)?.version ?? null;
    if (expectedVersion !== undefined && landedVersion !== nextVersion) {
      return { ok: false, currentVersion: landedVersion };
    }
    return { ok: true, version: nextVersion };
  },

  async delete(id: string, orgId: string): Promise<boolean> {
    // Check if it exists and belongs to the org
    const existing = await this.get(id, orgId);
    if (!existing) return false;

    await db
      .delete(workflowsTable as any)
      .where(
        and(
          eq(workflowsTable.id, id),
          eq(workflowsTable.orgId, orgId)
        )
      );
    return true;
  }
};
