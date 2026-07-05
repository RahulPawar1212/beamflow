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
  private readonly store = new Map<string, SerializedWorkflow>();

  async list(): Promise<SerializedWorkflow[]> {
    return [...this.store.values()];
  }

  async get(id: string): Promise<SerializedWorkflow | null> {
    return this.store.get(id) ?? null;
  }

  async save(workflow: SerializedWorkflow): Promise<void> {
    // Clone so callers can't mutate stored state by reference.
    this.store.set(workflow.metadata.id, structuredClone(workflow));
  }

  async delete(id: string): Promise<boolean> {
    return this.store.delete(id);
  }
}
