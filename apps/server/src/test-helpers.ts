/**
 * @module @beamflow/server/test-helpers
 *
 * Test-only utilities. Not used by production code.
 */

import type { SerializedWorkflow } from '@beamflow/shared';
import type { IStorage, SaveResult } from './storage.js';

/**
 * In-memory {@link IStorage} for route tests — no filesystem, fully isolated
 * per instance. Mirrors {@link LocalJsonStorage} semantics (get → null when
 * absent, delete → boolean, save overwrites by `metadata.id`). The scope key is
 * the caller's org id.
 */
export class MemoryStorage implements IStorage {
  private readonly store = new Map<string, { workflow: SerializedWorkflow; orgId?: string; version: number }>();

  async list(orgId?: string): Promise<SerializedWorkflow[]> {
    return [...this.store.values()]
      .filter((entry) => !orgId || entry.orgId === orgId)
      .map((entry) => entry.workflow);
  }

  async get(id: string, orgId?: string): Promise<SerializedWorkflow | null> {
    const entry = this.store.get(id);
    if (!entry) return null;
    if (orgId && entry.orgId !== orgId) return null;
    // Reflect the stored version on the returned metadata, like the real DB.
    return { ...entry.workflow, metadata: { ...entry.workflow.metadata, version: entry.version } };
  }

  async save(
    workflow: SerializedWorkflow,
    orgId?: string,
    _ownerId?: string,
    expectedVersion?: number,
  ): Promise<SaveResult> {
    const existing = this.store.get(workflow.metadata.id);
    if (existing) {
      // Same optimistic-concurrency guard as the real DB: reject a stale base.
      if (expectedVersion !== undefined && existing.version !== expectedVersion) {
        return { ok: false, currentVersion: existing.version };
      }
      const version = existing.version + 1;
      this.store.set(workflow.metadata.id, {
        workflow: structuredClone({ ...workflow, metadata: { ...workflow.metadata, version } }),
        orgId,
        version,
      });
      return { ok: true, version };
    }
    const version = workflow.metadata.version ?? 1;
    this.store.set(workflow.metadata.id, {
      workflow: structuredClone(workflow),
      orgId,
      version,
    });
    return { ok: true, version };
  }

  async delete(id: string, orgId?: string): Promise<boolean> {
    const entry = this.store.get(id);
    if (!entry) return false;
    if (orgId && entry.orgId !== orgId) return false;
    return this.store.delete(id);
  }
}
