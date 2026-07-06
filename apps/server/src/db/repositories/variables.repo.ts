import { db, isPostgres } from '../client.js';
import { sqliteVariables, pgVariables, sqliteWorkflows, pgWorkflows } from '../schema.js';
import { eq, and } from 'drizzle-orm';

const variablesTable = isPostgres ? pgVariables : sqliteVariables;
const workflowsTable = isPostgres ? pgWorkflows : sqliteWorkflows;

export interface PipelineVariable {
  id: string;
  workflowId: string;
  environment: string;
  name: string;
  value: string;
  isSecret: boolean;
}

export const variablesRepo = {
  async list(workflowId: string, ownerId: string): Promise<PipelineVariable[]> {
    const workflows = await db
      .select({ id: workflowsTable.id })
      .from(workflowsTable)
      .where(and(eq(workflowsTable.id, workflowId), eq(workflowsTable.ownerId, ownerId)))
      .limit(1);
    
    if (workflows.length === 0) return [];

    const results = await db
      .select()
      .from(variablesTable)
      .where(eq(variablesTable.workflowId, workflowId));

    return results.map((row: any) => ({
      id: row.id,
      workflowId: row.workflowId,
      environment: row.environment,
      name: row.name,
      value: row.value,
      isSecret: row.isSecret === 1 || row.isSecret === true,
    }));
  },

  async set(variable: Omit<PipelineVariable, 'id'> & { id?: string }, ownerId: string): Promise<void> {
    const workflows = await db
      .select({ id: workflowsTable.id })
      .from(workflowsTable)
      .where(and(eq(workflowsTable.id, variable.workflowId), eq(workflowsTable.ownerId, ownerId)))
      .limit(1);
    
    if (workflows.length === 0) {
      throw new Error('Unauthorized or workflow not found');
    }

    const existing = await db
      .select()
      .from(variablesTable)
      .where(
        and(
          eq(variablesTable.workflowId, variable.workflowId),
          eq(variablesTable.environment, variable.environment),
          eq(variablesTable.name, variable.name)
        )
      )
      .limit(1);

    const isSecretVal = variable.isSecret ? 1 : 0;

    if (existing.length > 0) {
      await db
        .update(variablesTable as any)
        .set({
          value: variable.value,
          isSecret: isSecretVal,
        })
        .where(eq(variablesTable.id, existing[0].id));
    } else {
      const id = variable.id ?? `var_${Math.random().toString(36).substring(2, 10)}`;
      await db.insert(variablesTable as any).values({
        id,
        workflowId: variable.workflowId,
        environment: variable.environment,
        name: variable.name,
        value: variable.value,
        isSecret: isSecretVal,
      });
    }
  },

  async delete(workflowId: string, environment: string, name: string, ownerId: string): Promise<boolean> {
    const workflows = await db
      .select({ id: workflowsTable.id })
      .from(workflowsTable)
      .where(and(eq(workflowsTable.id, workflowId), eq(workflowsTable.ownerId, ownerId)))
      .limit(1);
    
    if (workflows.length === 0) return false;

    await db
      .delete(variablesTable as any)
      .where(
        and(
          eq(variablesTable.workflowId, workflowId),
          eq(variablesTable.environment, environment),
          eq(variablesTable.name, name)
        )
      );
    return true;
  }
};
