import { db, isPostgres } from '../client.js';
import { sqliteWorkflows, pgWorkflows } from '../schema.js';
import { eq, and } from 'drizzle-orm';
import type { SerializedWorkflow } from '@beamflow/shared';

const workflowsTable = isPostgres ? pgWorkflows : sqliteWorkflows;

export const workflowsRepo = {
  async list(ownerId: string): Promise<SerializedWorkflow[]> {
    const results = await db
      .select()
      .from(workflowsTable)
      .where(eq(workflowsTable.ownerId, ownerId));
    
    return results.map((row: any) => JSON.parse(row.settingsJson));
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
      name: workflow.metadata.name,
      description: workflow.metadata.description || '',
      settingsJson: JSON.stringify(workflow),
      createdAt: now,
      updatedAt: now,
    });
  },

  async update(workflow: SerializedWorkflow, ownerId: string): Promise<void> {
    const now = workflow.metadata.updatedAt;
    await db
      .update(workflowsTable as any)
      .set({
        name: workflow.metadata.name,
        description: workflow.metadata.description || '',
        settingsJson: JSON.stringify(workflow),
        updatedAt: now,
      })
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
