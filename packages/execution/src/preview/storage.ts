import { mkdir, rm, readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Storage interface for preview data.
 * Abstracted to allow future implementations (GCS, S3, Azure).
 */
export interface PreviewStorage {
  /**
   * Save a buffer (Arrow IPC/Feather format) for a specific preview.
   */
  saveFeather(workflowId: string, nodeId: string, data: Uint8Array): Promise<string>;

  /**
   * Load the preview data buffer.
   */
  loadFeather(workflowId: string, nodeId: string): Promise<Uint8Array | null>;

  /**
   * Delete a preview from storage.
   */
  delete(workflowId: string, nodeId: string): Promise<void>;

  /**
   * Delete all previews for a workflow.
   */
  deleteAll(workflowId: string): Promise<void>;

  /**
   * Save metadata JSON.
   */
  saveMetadata(workflowId: string, nodeId: string, metadata: any): Promise<void>;

  /**
   * Load metadata JSON.
   */
  loadMetadata(workflowId: string, nodeId: string): Promise<any | null>;

  /**
   * Get absolute filepath for a feather file (used by python local runner MVP).
   */
  getFeatherFilePath(workflowId: string, nodeId: string): string;
}

/**
 * Local implementation of PreviewStorage for MVP.
 */
export class LocalFeatherStorage implements PreviewStorage {
  constructor(private readonly basePath: string = join(process.cwd(), '.beamflow', 'previews')) {}

  private getWorkflowDir(workflowId: string): string {
    return join(this.basePath, `workflow_${workflowId}`);
  }

  public getFeatherFilePath(workflowId: string, nodeId: string): string {
    return join(this.getWorkflowDir(workflowId), `node_${nodeId}.feather`);
  }

  private getMetadataFilePath(workflowId: string, nodeId: string): string {
    return join(this.getWorkflowDir(workflowId), `node_${nodeId}_meta.json`);
  }

  async saveFeather(workflowId: string, nodeId: string, data: Uint8Array): Promise<string> {
    const dir = this.getWorkflowDir(workflowId);
    await mkdir(dir, { recursive: true });
    const filepath = this.getFeatherFilePath(workflowId, nodeId);
    await writeFile(filepath, data);
    return filepath;
  }

  async loadFeather(workflowId: string, nodeId: string): Promise<Uint8Array | null> {
    try {
      const filepath = this.getFeatherFilePath(workflowId, nodeId);
      return await readFile(filepath);
    } catch {
      return null;
    }
  }

  async delete(workflowId: string, nodeId: string): Promise<void> {
    try {
      await rm(this.getFeatherFilePath(workflowId, nodeId), { force: true });
      await rm(this.getMetadataFilePath(workflowId, nodeId), { force: true });
    } catch {
      // ignore
    }
  }

  async deleteAll(workflowId: string): Promise<void> {
    try {
      await rm(this.getWorkflowDir(workflowId), { recursive: true, force: true });
    } catch {
      // ignore
    }
  }

  async saveMetadata(workflowId: string, nodeId: string, metadata: any): Promise<void> {
    const dir = this.getWorkflowDir(workflowId);
    await mkdir(dir, { recursive: true });
    const filepath = this.getMetadataFilePath(workflowId, nodeId);
    await writeFile(filepath, JSON.stringify(metadata, null, 2), 'utf8');
  }

  async loadMetadata(workflowId: string, nodeId: string): Promise<any | null> {
    try {
      const filepath = this.getMetadataFilePath(workflowId, nodeId);
      const data = await readFile(filepath, 'utf8');
      return JSON.parse(data);
    } catch {
      return null;
    }
  }
}
