import { db, isPostgres } from '../client.js';
import { sqliteWorkflowVersions, pgWorkflowVersions, sqliteWorkflows, pgWorkflows } from '../schema.js';
import { eq, and, desc } from 'drizzle-orm';
import type { SerializedWorkflow } from '@beamflow/shared';

const versionsTable = isPostgres ? pgWorkflowVersions : sqliteWorkflowVersions;
const workflowsTable = isPostgres ? pgWorkflows : sqliteWorkflows;

export interface WorkflowVersion {
  id: string;
  workflowId: string;
  version: number;
  snapshot: SerializedWorkflow;
  createdAt: string;
  label: string | null;
}

export const versionsRepo = {
  async list(workflowId: string, orgId: string): Promise<Omit<WorkflowVersion, 'snapshot'>[]> {
    const workflows = await db
      .select({ id: workflowsTable.id })
      .from(workflowsTable)
      .where(and(eq(workflowsTable.id, workflowId), eq(workflowsTable.orgId, orgId)))
      .limit(1);
    
    if (workflows.length === 0) return [];

    const results = await db
      .select({
        id: versionsTable.id,
        workflowId: versionsTable.workflowId,
        version: versionsTable.version,
        createdAt: versionsTable.createdAt,
        label: versionsTable.label,
      })
      .from(versionsTable)
      .where(eq(versionsTable.workflowId, workflowId))
      .orderBy(desc(versionsTable.version));

    return results;
  },

  async get(id: string, workflowId: string, orgId: string): Promise<WorkflowVersion | null> {
    const workflows = await db
      .select({ id: workflowsTable.id })
      .from(workflowsTable)
      .where(and(eq(workflowsTable.id, workflowId), eq(workflowsTable.orgId, orgId)))
      .limit(1);
    
    if (workflows.length === 0) return null;

    const results = await db
      .select()
      .from(versionsTable)
      .where(and(eq(versionsTable.id, id), eq(versionsTable.workflowId, workflowId)))
      .limit(1);
    
    if (results.length === 0) return null;
    const row = results[0] as any;
    return {
      id: row.id,
      workflowId: row.workflowId,
      version: row.version,
      snapshot: JSON.parse(row.snapshotJson),
      createdAt: row.createdAt,
      label: row.label,
    };
  },

  async create(workflowId: string, snapshot: SerializedWorkflow, label: string | null, orgId: string): Promise<WorkflowVersion> {
    const workflows = await db
      .select({ id: workflowsTable.id })
      .from(workflowsTable)
      .where(and(eq(workflowsTable.id, workflowId), eq(workflowsTable.orgId, orgId)))
      .limit(1);
    
    if (workflows.length === 0) {
      throw new Error('Unauthorized or workflow not found');
    }

    const versions = await db
      .select({ version: versionsTable.version })
      .from(versionsTable)
      .where(eq(versionsTable.workflowId, workflowId))
      .orderBy(desc(versionsTable.version))
      .limit(1);
    
    const nextVersion = versions.length > 0 ? versions[0].version + 1 : 1;
    const id = `ver_${Math.random().toString(36).substring(2, 10)}`;
    const now = new Date().toISOString();

    await db.insert(versionsTable as any).values({
      id,
      workflowId,
      version: nextVersion,
      snapshotJson: JSON.stringify(snapshot),
      createdAt: now,
      label,
    });

    return {
      id,
      workflowId,
      version: nextVersion,
      snapshot,
      createdAt: now,
      label,
    };
  }
};
