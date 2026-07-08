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

/** Storage interface — implement this for different backends. */
export interface IStorage {
  list(userId?: string, options?: { includeSubflows?: boolean }): Promise<SerializedWorkflow[]>;
  get(id: string, userId?: string): Promise<SerializedWorkflow | null>;
  save(workflow: SerializedWorkflow, userId?: string): Promise<void>;
  delete(id: string, userId?: string): Promise<boolean>;
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

  async save(workflow: SerializedWorkflow, _userId?: string): Promise<void> {
    await this.ensureDir();
    const content = JSON.stringify(workflow, null, 2);
    await writeFile(this.filePath(workflow.metadata.id), content, 'utf-8');
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
  async list(userId?: string, options?: { includeSubflows?: boolean }): Promise<SerializedWorkflow[]> {
    if (!userId) return [];
    return workflowsRepo.list(userId, options);
  }

  async get(id: string, userId?: string): Promise<SerializedWorkflow | null> {
    if (!userId) return null;
    return workflowsRepo.get(id, userId);
  }

  async save(workflow: SerializedWorkflow, userId?: string): Promise<void> {
    if (!userId) {
      throw new Error('User ID is required to save workflow to database');
    }
    const existing = await workflowsRepo.get(workflow.metadata.id, userId);
    if (existing) {
      await workflowsRepo.update(workflow, userId);
    } else {
      await workflowsRepo.create(workflow, userId);
    }
  }

  async delete(id: string, userId?: string): Promise<boolean> {
    if (!userId) return false;
    return workflowsRepo.delete(id, userId);
  }
}

