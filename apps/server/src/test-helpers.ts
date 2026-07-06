/**
 * @module @beamflow/server/test-helpers
 *
 * Test-only utilities. Not used by production code.
 */

import type { SerializedWorkflow } from '@beamflow/shared';
import type { IStorage } from './storage.js';

/**
 * In-memory {@link IStorage} for route tests — no filesystem, fully isolated
 * per instance. Mirrors {@link LocalJsonStorage} semantics (get → null when
 * absent, delete → boolean, save overwrites by `metadata.id`).
 */
export class MemoryStorage implements IStorage {
  private readonly store = new Map<string, { workflow: SerializedWorkflow; userId?: string }>();

  async list(userId?: string): Promise<SerializedWorkflow[]> {
    return [...this.store.values()]
      .filter((entry) => !userId || entry.userId === userId)
      .map((entry) => entry.workflow);
  }

  async get(id: string, userId?: string): Promise<SerializedWorkflow | null> {
    const entry = this.store.get(id);
    if (!entry) return null;
    if (userId && entry.userId !== userId) return null;
    return entry.workflow;
  }

  async save(workflow: SerializedWorkflow, userId?: string): Promise<void> {
    this.store.set(workflow.metadata.id, {
      workflow: structuredClone(workflow),
      userId,
    });
  }

  async delete(id: string, userId?: string): Promise<boolean> {
    const entry = this.store.get(id);
    if (!entry) return false;
    if (userId && entry.userId !== userId) return false;
    return this.store.delete(id);
  }
}
