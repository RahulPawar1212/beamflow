import { DAG, deserializeWorkflow } from '@beamflow/graph';
import type { SerializedWorkflow } from '@beamflow/shared';
import type { NodeRegistry } from '@beamflow/core';
import { executePipeline, type ExecutionConfig } from '../executor.js';
import { generatePreviewPipeline } from './generator.js';
import type { PreviewCacheManager } from './cache.js';
import type { PreviewStorage } from './storage.js';

export class PreviewManager {
  private controllers = new Map<string, AbortController>();

  constructor(
    private readonly cache: PreviewCacheManager,
    private readonly storage: PreviewStorage,
    private readonly registry: NodeRegistry
  ) {}

  /**
   * Generates and executes a preview for a specific node.
   * Runs in the background (does not block waiting for execution to finish).
   */
  async triggerPreview(workflow: SerializedWorkflow, nodeId: string, limit: number = 1000): Promise<void> {
    const workflowId = workflow.metadata.id;
    const taskKey = `${workflowId}:${nodeId}`;

    // Cancel any existing preview for this node
    this.cancelPreview(workflowId, nodeId);
    
    const controller = new AbortController();
    this.controllers.set(taskKey, controller);

    // Set status to running immediately
    await this.cache.updateMetadata(workflowId, nodeId, {
      workflowId,
      nodeId,
      status: 'running',
      errorMessage: undefined,
      createdAt: new Date().toISOString()
    });

    try {
      // 1. Deserialize workflow to DAG
      const { dag } = deserializeWorkflow(workflow);

      // 2. Determine file path for feather sink
      const featherPath = this.storage.getFeatherFilePath(workflowId, nodeId);

      // 3. Generate preview pipeline
      const pipeline = generatePreviewPipeline(dag, nodeId, this.registry, featherPath, limit);

      // 4. Execute the pipeline
      const config: ExecutionConfig = {
        // Use a temp dir for execution, but feather is written to workspace
        timeoutMs: 300_000, // 5 minutes for preview (allows pip install to finish)
        signal: controller.signal
      };

      const result = await executePipeline(pipeline, config);

      // Only process result if it wasn't superseded by another preview run
      if (this.controllers.get(taskKey) !== controller) return;
      this.controllers.delete(taskKey);

      if (result.status === 'completed') {
        await this.cache.updateMetadata(workflowId, nodeId, {
          workflowId,
          nodeId,
          status: 'ready',
          filePath: featherPath,
          createdAt: new Date().toISOString()
        });
      } else if (result.status === 'cancelled') {
        await this.cache.updateMetadata(workflowId, nodeId, {
          workflowId,
          nodeId,
          status: 'failed',
          errorMessage: 'Preview cancelled by user',
          createdAt: new Date().toISOString()
        });
      } else {
        await this.cache.updateMetadata(workflowId, nodeId, {
          workflowId,
          nodeId,
          status: 'failed',
          errorMessage: result.errors.join('\n') || 'Unknown execution error',
          createdAt: new Date().toISOString()
        });
      }
    } catch (err: any) {
      if (this.controllers.get(taskKey) !== controller) return;
      this.controllers.delete(taskKey);

      await this.cache.updateMetadata(workflowId, nodeId, {
        workflowId,
        nodeId,
        status: 'failed',
        errorMessage: err.message || String(err),
        createdAt: new Date().toISOString()
      });
    }
  }

  /**
   * Cancels a running preview.
   */
  cancelPreview(workflowId: string, nodeId: string): void {
    const taskKey = `${workflowId}:${nodeId}`;
    const controller = this.controllers.get(taskKey);
    if (controller) {
      controller.abort();
      this.controllers.delete(taskKey);
    }
  }
}
