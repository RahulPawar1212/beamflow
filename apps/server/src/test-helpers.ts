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
 * absent, delete → boolean, save overwrites by `metadata.id`). The scope key is
 * the caller's org id.
 */
export class MemoryStorage implements IStorage {
  private readonly store = new Map<string, { workflow: SerializedWorkflow; orgId?: string }>();

  async list(orgId?: string): Promise<SerializedWorkflow[]> {
    return [...this.store.values()]
      .filter((entry) => !orgId || entry.orgId === orgId)
      .map((entry) => entry.workflow);
  }

  async get(id: string, orgId?: string): Promise<SerializedWorkflow | null> {
    const entry = this.store.get(id);
    if (!entry) return null;
    if (orgId && entry.orgId !== orgId) return null;
    return entry.workflow;
  }

  async save(workflow: SerializedWorkflow, orgId?: string): Promise<void> {
    this.store.set(workflow.metadata.id, {
      workflow: structuredClone(workflow),
      orgId,
    });
  }

  async delete(id: string, orgId?: string): Promise<boolean> {
    const entry = this.store.get(id);
    if (!entry) return false;
    if (orgId && entry.orgId !== orgId) return false;
    return this.store.delete(id);
  }
}
