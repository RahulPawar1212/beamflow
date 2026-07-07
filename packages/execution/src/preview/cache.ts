import { tableFromIPC } from 'apache-arrow';
import type { PreviewStorage } from './storage.js';
import type { PreviewMetadata, PreviewRowsResponse } from '@beamflow/shared';

export class PreviewCacheManager {
  constructor(private readonly storage: PreviewStorage) {}

  /**
   * Retrieves the paginated data for a given preview.
   * If the cache is invalid or missing, it will return null.
   */
  async getPreviewPage(
    workflowId: string,
    nodeId: string,
    page: number = 1,
    pageSize: number = 100
  ): Promise<PreviewRowsResponse | null> {
    const metadata = await this.storage.loadMetadata(workflowId, nodeId) as PreviewMetadata | null;
    if (!metadata) {
      return null; // No preview available
    }

    if (metadata.status === 'running' || metadata.status === 'failed') {
      return {
        metadata,
        rows: [],
        page,
        pageSize,
        totalPages: 0,
      };
    }

    // It's ready or stale, try to load data
    const buffer = await this.storage.loadFeather(workflowId, nodeId);
    if (!buffer) {
      return null;
    }

    let table;
    try {
      table = tableFromIPC(buffer);
    } catch (err) {
      console.error('Failed to read IPC buffer:', err);
      return null;
    }

    const totalRows = table.numRows;
    const totalPages = Math.ceil(totalRows / pageSize);
    const safePage = Math.max(1, Math.min(page, totalPages || 1));
    const startIdx = (safePage - 1) * pageSize;
    const endIdx = Math.min(startIdx + pageSize, totalRows);

    const rows: Record<string, any>[] = [];
    
    // using manual slice to avoid loading all into plain objects if large
    for (let i = startIdx; i < endIdx; i++) {
      const row = table.get(i);
      if (row) {
        const obj = row.toJSON();
        // apache-arrow converts INT64 to BigInt, which JSON.stringify cannot handle.
        // Convert BigInts to regular JS numbers (or strings if unsafe)
        for (const key of Object.keys(obj)) {
          if (typeof obj[key] === 'bigint') {
            const val = obj[key] as bigint;
            if (val > Number.MAX_SAFE_INTEGER || val < Number.MIN_SAFE_INTEGER) {
              obj[key] = val.toString();
            } else {
              obj[key] = Number(val);
            }
          }
        }
        rows.push(obj);
      }
    }

    return {
      metadata,
      rows,
      page: safePage,
      pageSize,
      totalPages,
    };
  }

  /**
   * Called to update or create the metadata for a node preview.
   */
  async updateMetadata(workflowId: string, nodeId: string, metadata: Partial<PreviewMetadata>): Promise<PreviewMetadata> {
    const existing = await this.storage.loadMetadata(workflowId, nodeId) || {};
    const updated = { ...existing, ...metadata } as PreviewMetadata;
    await this.storage.saveMetadata(workflowId, nodeId, updated);
    return updated;
  }

  /**
   * Triggers invalidation of downstream nodes.
   * In a real implementation with a proper DAG dependency graph, you would traverse
   * from `nodeId` downwards. Since this requires the DAG, we'll pass the list of 
   * descendant node IDs to invalidate.
   */
  async invalidatePreviews(workflowId: string, nodeIds: string[]): Promise<void> {
    for (const id of nodeIds) {
      const metadata = await this.storage.loadMetadata(workflowId, id);
      if (metadata && metadata.status === 'ready') {
        metadata.status = 'stale';
        await this.storage.saveMetadata(workflowId, id, metadata);
      }
    }
  }

  /**
   * Delete preview for a node
   */
  async deletePreview(workflowId: string, nodeId: string): Promise<void> {
    await this.storage.delete(workflowId, nodeId);
  }
}
