import { DAG, deserializeWorkflow } from '@beamflow/graph';
import type { SerializedWorkflow } from '@beamflow/shared';
import type { NodeRegistry } from '@beamflow/core';
import { executePipeline, type ExecutionConfig } from '../executor.js';
import { generatePreviewPipeline } from './generator.js';
import type { PreviewCacheManager } from './cache.js';
import type { PreviewStorage } from './storage.js';

export class PreviewManager {
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
        timeoutMs: 120_000 // 2 minutes for preview
      };

      const result = await executePipeline(pipeline, config);

      if (result.status === 'completed') {
        // On success, we don't know row count unless we read it. The cache manager can read it on demand or we can just leave it 0 until loaded.
        // Actually, for a better UX, we could read it right now to update rowCount.
        await this.cache.updateMetadata(workflowId, nodeId, {
          status: 'ready',
          filePath: featherPath
        });
      } else {
        await this.cache.updateMetadata(workflowId, nodeId, {
          status: 'failed',
          errorMessage: result.errors.join('\n') || 'Execution failed'
        });
      }
    } catch (err: any) {
      await this.cache.updateMetadata(workflowId, nodeId, {
        status: 'failed',
        errorMessage: err.message
      });
    }
  }
}
