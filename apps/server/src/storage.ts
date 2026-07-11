/**
 * @module @beamflow/server/storage
 *
 * Storage abstraction layer.
 * MVP uses local JSON files; designed so PostgreSQL/Cloud Storage
 * adapters can be swapped in later.
 */

import { mkdir, readFile, writeFile, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { SerializedWorkflow } from '@beamflow/shared';

/**
 * Result of a version-guarded save. `ok:false` means the caller's base version
 * was stale (a concurrent write landed first) and nothing was overwritten.
 */
export type SaveResult =
  | { ok: true; version: number }
  | { ok: false; currentVersion: number | null };

/**
 * Storage interface — implement this for different backends.
 *
 * The scope argument (`orgId`) is the ORGANIZATION the caller is acting in —
 * every read/write is filtered by it. `ownerId` on save is the acting user, kept
 * only as provenance on newly created rows (not an access gate).
 *
 * `save`'s `expectedVersion` is the optimistic-concurrency token: when provided
 * for an existing row, the write only lands if the stored version still matches;
 * otherwise it returns `{ ok:false }` without clobbering. Omitted (or for a brand
 * new row) → unconditional write.
 */
export interface IStorage {
  list(orgId?: string, options?: { includeSubflows?: boolean; projectId?: string }): Promise<SerializedWorkflow[]>;
  get(id: string, orgId?: string): Promise<SerializedWorkflow | null>;
  save(workflow: SerializedWorkflow, orgId?: string, ownerId?: string, expectedVersion?: number): Promise<SaveResult>;
  delete(id: string, orgId?: string): Promise<boolean>;
}

/**
 * Local JSON file storage.
 * Each pipeline is a single .json file in ~/.beamflow/pipelines/
 */
export class LocalJsonStorage implements IStorage {
  private readonly baseDir: string;
  private initialized = false;

  constructor(baseDir?: string) {
    this.baseDir = baseDir || join(homedir(), '.beamflow', 'pipelines');
  }

  private async ensureDir(): Promise<void> {
    if (this.initialized) return;
    await mkdir(this.baseDir, { recursive: true });
    this.initialized = true;
  }

  private filePath(id: string): string {
    // Sanitize ID for use as filename
    const safe = id.replace(/[^a-zA-Z0-9_-]/g, '_');
    return join(this.baseDir, `${safe}.json`);
  }

  async list(_userId?: string): Promise<SerializedWorkflow[]> {
    await this.ensureDir();
    try {
      const files = await readdir(this.baseDir);
      const jsonFiles = files.filter((f) => f.endsWith('.json'));

      const workflows: SerializedWorkflow[] = [];
      for (const file of jsonFiles) {
        try {
          const content = await readFile(join(this.baseDir, file), 'utf-8');
          workflows.push(JSON.parse(content));
        } catch {
          // Skip corrupt files
          console.warn(`[Storage] Skipping corrupt file: ${file}`);
        }
      }

      return workflows;
    } catch {
      return [];
    }
  }

  async get(id: string, _userId?: string): Promise<SerializedWorkflow | null> {
    await this.ensureDir();
    try {
      const content = await readFile(this.filePath(id), 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  async save(workflow: SerializedWorkflow, _orgId?: string, _ownerId?: string, _expectedVersion?: number): Promise<SaveResult> {
    // Dev-only local storage: no concurrency model — unconditional write.
    await this.ensureDir();
    const content = JSON.stringify(workflow, null, 2);
    await writeFile(this.filePath(workflow.metadata.id), content, 'utf-8');
    return { ok: true, version: workflow.metadata.version ?? 1 };
  }

  async delete(id: string, _userId?: string): Promise<boolean> {
    await this.ensureDir();
    try {
      await unlink(this.filePath(id));
      return true;
    } catch {
      return false;
    }
  }
}

import { workflowsRepo } from './db/repositories/workflows.repo.js';

/**
 * LibSQL/PostgreSQL database storage.
 */
export class DrizzleStorage implements IStorage {
  async list(orgId?: string, options?: { includeSubflows?: boolean; projectId?: string }): Promise<SerializedWorkflow[]> {
    if (!orgId) return [];
    return workflowsRepo.list(orgId, options);
  }

  async get(id: string, orgId?: string): Promise<SerializedWorkflow | null> {
    if (!orgId) return null;
    return workflowsRepo.get(id, orgId);
  }

  async save(workflow: SerializedWorkflow, orgId?: string, ownerId?: string, expectedVersion?: number): Promise<SaveResult> {
    if (!orgId) {
      throw new Error('Organization ID is required to save workflow to database');
    }
    const existing = await workflowsRepo.get(workflow.metadata.id, orgId);
    if (existing) {
      // Version-guarded: returns { ok:false } without overwriting on a stale base.
      return workflowsRepo.update(workflow, orgId, expectedVersion);
    }
    // ownerId is provenance on the new row; fall back to '' if unknown.
    await workflowsRepo.create(workflow, orgId, ownerId ?? '');
    return { ok: true, version: workflow.metadata.version ?? 1 };
  }

  async delete(id: string, orgId?: string): Promise<boolean> {
    if (!orgId) return false;
    return workflowsRepo.delete(id, orgId);
  }
}

