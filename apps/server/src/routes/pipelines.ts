/**
 * @module @beamflow/server/routes/pipelines
 *
 * Pipeline CRUD, code generation, and execution routes.
 */

import type { FastifyInstance } from 'fastify';
import type { NodeRegistry } from '@beamflow/core';
import { DAG, deserializeWorkflow, serializeWorkflow } from '@beamflow/graph';
import { buildIR, optimizeIR, validateIR } from '@beamflow/ir';
import { generatePythonBeam } from '@beamflow/beam-generator';
import { executePipeline } from '@beamflow/execution';
import { generateId, timestamp, SCHEMA_VERSION } from '@beamflow/shared';
import type { SerializedWorkflow } from '@beamflow/shared';
import type { IStorage } from '../storage.js';

/** In-memory execution result cache. */
const executionResults = new Map<string, unknown>();

export async function pipelineRoutes(
  app: FastifyInstance,
  storage: IStorage,
  registry: NodeRegistry,
): Promise<void> {
  // ─── CRUD ─────────────────────────────────────────────────────────

  /** GET /api/pipelines — List all saved pipelines. */
  app.get('/api/pipelines', async (_req, reply) => {
    const workflows = await storage.list();
    const summaries = workflows.map((w) => ({
      id: w.metadata.id,
      name: w.metadata.name,
      description: w.metadata.description,
      createdAt: w.metadata.createdAt,
      updatedAt: w.metadata.updatedAt,
      nodeCount: w.nodes.length,
      connectionCount: w.connections.length,
    }));
    return reply.send({ pipelines: summaries });
  });

  /** GET /api/pipelines/:id — Get single pipeline. */
  app.get<{ Params: { id: string } }>(
    '/api/pipelines/:id',
    async (req, reply) => {
      const workflow = await storage.get(req.params.id);
      if (!workflow) {
        return reply.status(404).send({ error: 'Pipeline not found.' });
      }
      return reply.send(workflow);
    },
  );

  /** POST /api/pipelines — Create a new pipeline. */
  app.post<{ Body: { name?: string; description?: string } }>(
    '/api/pipelines',
    async (req, reply) => {
      const id = generateId('pipeline');
      const now = timestamp();

      const workflow: SerializedWorkflow = {
        schemaVersion: SCHEMA_VERSION,
        metadata: {
          id,
          name: (req.body as Record<string, string>)?.name || 'Untitled Pipeline',
          description: (req.body as Record<string, string>)?.description || '',
          createdAt: now,
          updatedAt: now,
        },
        nodes: [],
        connections: [],
      };

      await storage.save(workflow);
      return reply.status(201).send(workflow);
    },
  );

  /** PUT /api/pipelines/:id — Update pipeline. */
  app.put<{ Params: { id: string }; Body: SerializedWorkflow }>(
    '/api/pipelines/:id',
    async (req, reply) => {
      const existing = await storage.get(req.params.id);
      if (!existing) {
        return reply.status(404).send({ error: 'Pipeline not found.' });
      }

      const workflow = req.body as SerializedWorkflow;
      // Ensure ID consistency
      const toSave: SerializedWorkflow = {
        ...workflow,
        metadata: {
          ...workflow.metadata,
          id: req.params.id,
          updatedAt: timestamp(),
        },
      };

      await storage.save(toSave);
      return reply.send(toSave);
    },
  );

  /** DELETE /api/pipelines/:id — Delete pipeline. */
  app.delete<{ Params: { id: string } }>(
    '/api/pipelines/:id',
    async (req, reply) => {
      const deleted = await storage.delete(req.params.id);
      if (!deleted) {
        return reply.status(404).send({ error: 'Pipeline not found.' });
      }
      return reply.status(204).send();
    },
  );

  // ─── Code Generation ──────────────────────────────────────────────

  /** POST /api/pipelines/:id/generate — Generate Beam code from pipeline. */
  app.post<{ Params: { id: string } }>(
    '/api/pipelines/:id/generate',
    async (req, reply) => {
      const workflow = await storage.get(req.params.id);
      if (!workflow) {
        return reply.status(404).send({ error: 'Pipeline not found.' });
      }

      try {
        // 1. Deserialize to DAG
        const { dag, metadata } = deserializeWorkflow(workflow);

        // 2. Validate graph
        const graphIssues = dag.validate(registry);
        const errors = graphIssues.filter((i) => i.severity === 'error');
        if (errors.length > 0) {
          return reply.status(400).send({
            error: 'Validation failed.',
            issues: graphIssues,
          });
        }

        // 3. Build IR
        const ir = buildIR(dag, registry, {
          name: metadata.name,
        });

        // 4. Validate IR
        const irErrors = validateIR(ir);
        if (irErrors.length > 0) {
          return reply.status(400).send({
            error: 'IR validation failed.',
            issues: irErrors,
          });
        }

        // 5. Optimize IR
        const optimizedIR = optimizeIR(ir);

        // 6. Generate Python code
        const generated = generatePythonBeam(optimizedIR);

        return reply.send({
          code: generated.code,
          filename: generated.filename,
          language: generated.language,
          requirements: generated.requirements,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        return reply.status(500).send({ error: message });
      }
    },
  );

  // ─── Execution ────────────────────────────────────────────────────

  /** POST /api/pipelines/:id/execute — Execute generated pipeline. */
  app.post<{ Params: { id: string } }>(
    '/api/pipelines/:id/execute',
    async (req, reply) => {
      const workflow = await storage.get(req.params.id);
      if (!workflow) {
        return reply.status(404).send({ error: 'Pipeline not found.' });
      }

      try {
        // Generate code first
        const { dag, metadata } = deserializeWorkflow(workflow);
        const ir = buildIR(dag, registry, { name: metadata.name });
        const optimizedIR = optimizeIR(ir);
        const generated = generatePythonBeam(optimizedIR);

        // Execute
        const result = await executePipeline(generated);

        // Cache result
        executionResults.set(result.id, result);

        return reply.send(result);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        return reply.status(500).send({ error: message });
      }
    },
  );

  /** GET /api/pipelines/:id/executions/:execId — Get execution status. */
  app.get<{ Params: { id: string; execId: string } }>(
    '/api/pipelines/:id/executions/:execId',
    async (req, reply) => {
      const result = executionResults.get(req.params.execId);
      if (!result) {
        return reply.status(404).send({ error: 'Execution not found.' });
      }
      return reply.send(result);
    },
  );
}
