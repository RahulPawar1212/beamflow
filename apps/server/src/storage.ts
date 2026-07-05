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
  list(): Promise<SerializedWorkflow[]>;
  get(id: string): Promise<SerializedWorkflow | null>;
  save(workflow: SerializedWorkflow): Promise<void>;
  delete(id: string): Promise<boolean>;
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

  async list(): Promise<SerializedWorkflow[]> {
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

  async get(id: string): Promise<SerializedWorkflow | null> {
    await this.ensureDir();
    try {
      const content = await readFile(this.filePath(id), 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  async save(workflow: SerializedWorkflow): Promise<void> {
    await this.ensureDir();
    const content = JSON.stringify(workflow, null, 2);
    await writeFile(this.filePath(workflow.metadata.id), content, 'utf-8');
  }

  async delete(id: string): Promise<boolean> {
    await this.ensureDir();
    try {
      await unlink(this.filePath(id));
      return true;
    } catch {
      return false;
    }
  }
}
