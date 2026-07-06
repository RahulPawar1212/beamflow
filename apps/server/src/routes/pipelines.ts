/**
 * @module @beamflow/server/routes/pipelines
 *
 * Pipeline CRUD, code generation, and execution routes.
 */

import type { FastifyInstance } from 'fastify';
import * as fs from 'fs';
import type { NodeRegistry } from '@beamflow/core';
import { DAG, deserializeWorkflow, serializeWorkflow } from '@beamflow/graph';
import { buildIR, optimizeIR, validateIR } from '@beamflow/ir';
import { generatePythonBeam } from '@beamflow/beam-generator';
import { executePipeline } from '@beamflow/execution';
import { generateId, timestamp, SCHEMA_VERSION } from '@beamflow/shared';
import type { SerializedWorkflow } from '@beamflow/shared';
import type { IStorage } from '../storage.js';
import { notFound, badRequest, ApiError } from '../errors.js';

/** In-memory execution result cache. */
const executionResults = new Map<string, unknown>();

export async function pipelineRoutes(
  app: FastifyInstance,
  storage: IStorage,
  registry: NodeRegistry,
 ): Promise<void> {
  // Wrap in a plugin instance that enforces authentication and encapsulates hooks
  app.register(async (appWithAuth) => {
    appWithAuth.addHook('preHandler', app.authenticate);

    // ─── CRUD ─────────────────────────────────────────────────────────

    /** GET /api/pipelines — List all saved pipelines. */
    appWithAuth.get('/api/pipelines', async (req, reply) => {
      const userId = (req.user as any).id;
      const workflows = await storage.list(userId);
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
    appWithAuth.get<{ Params: { id: string } }>(
      '/api/pipelines/:id',
      async (req, reply) => {
        const userId = (req.user as any).id;
        const workflow = await storage.get(req.params.id, userId);
        if (!workflow) {
          throw notFound('Pipeline not found or unauthorized.');
        }
        return reply.send(workflow);
      },
    );

    /** POST /api/pipelines — Create a new pipeline. */
    appWithAuth.post<{ Body: { name?: string; description?: string } }>(
      '/api/pipelines',
      async (req, reply) => {
        const userId = (req.user as any).id;
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

        await storage.save(workflow, userId);
        return reply.status(201).send(workflow);
      },
    );

    /** PUT /api/pipelines/:id — Update pipeline. */
    appWithAuth.put<{ Params: { id: string }; Body: SerializedWorkflow }>(
      '/api/pipelines/:id',
      async (req, reply) => {
        const userId = (req.user as any).id;
        const existing = await storage.get(req.params.id, userId);
        if (!existing) {
          throw notFound('Pipeline not found or unauthorized.');
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

        await storage.save(toSave, userId);
        return reply.send(toSave);
      },
    );

    /** DELETE /api/pipelines/:id — Delete pipeline. */
    appWithAuth.delete<{ Params: { id: string } }>(
      '/api/pipelines/:id',
      async (req, reply) => {
        const userId = (req.user as any).id;
        const deleted = await storage.delete(req.params.id, userId);
        if (!deleted) {
          throw notFound('Pipeline not found or unauthorized.');
        }
        return reply.status(204).send();
      },
    );

    // ─── Code Generation ──────────────────────────────────────────────

    /** POST /api/pipelines/:id/generate — Generate Beam code from pipeline. */
    appWithAuth.post<{ Params: { id: string } }>(
      '/api/pipelines/:id/generate',
      async (req, reply) => {
        const userId = (req.user as any).id;
        const workflow = await storage.get(req.params.id, userId);
        if (!workflow) {
          throw notFound('Pipeline not found or unauthorized.');
        }

        try {
          // 1. Deserialize to DAG
          const { dag, metadata } = deserializeWorkflow(workflow);

          // 2. Validate graph
          const graphIssues = dag.validate(registry);
          const errors = graphIssues.filter((i) => i.severity === 'error');
          if (errors.length > 0) {
            throw badRequest('Validation failed.', graphIssues);
          }

          // 3. Build IR
          const ir = buildIR(dag, registry, {
            name: metadata.name,
          });

          // 4. Validate IR
          const irErrors = validateIR(ir);
          if (irErrors.length > 0) {
            throw badRequest('IR validation failed.', irErrors);
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
          // Preserve intentional client errors (validation); everything else is
          // an unexpected server fault → 500 via the error handler.
          if (error instanceof ApiError) throw error;
          throw new ApiError(500, error instanceof Error ? error.message : String(error));
        }
      },
    );

    // ─── Execution ────────────────────────────────────────────────────

    /** POST /api/pipelines/:id/execute — Execute generated pipeline. */
    appWithAuth.post<{ Params: { id: string } }>(
      '/api/pipelines/:id/execute',
      async (req, reply) => {
        const userId = (req.user as any).id;
        const workflow = await storage.get(req.params.id, userId);
        if (!workflow) {
          throw notFound('Pipeline not found or unauthorized.');
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
          if (error instanceof ApiError) throw error;
          throw new ApiError(500, error instanceof Error ? error.message : String(error));
        }
      },
    );

    /** GET /api/pipelines/:id/executions/:execId — Get execution status. */
    appWithAuth.get<{ Params: { id: string; execId: string } }>(
      '/api/pipelines/:id/executions/:execId',
      async (req, reply) => {
        const userId = (req.user as any).id;
        // Access check
        const workflow = await storage.get(req.params.id, userId);
        if (!workflow) {
          throw notFound('Pipeline not found or unauthorized.');
        }

        const result = executionResults.get(req.params.execId);
        if (!result) {
          throw notFound('Execution not found.');
        }
        return reply.send(result);
      },
    );

    /** POST /api/pipelines/preview-csv — Helper to preview a local CSV file. */
    appWithAuth.post<{ Body: { filePath: string; delimiter?: string } }>(
      '/api/pipelines/preview-csv',
      async (req, reply) => {
        const { filePath, delimiter = ',' } = req.body;
        if (!filePath) {
          throw badRequest('filePath is required.');
        }

        try {
          if (!fs.existsSync(filePath)) {
            throw notFound(`File not found: ${filePath}`);
          }

          // Read the first few lines (e.g. 5 lines) of the file
          const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
          let data = '';
          for await (const chunk of stream) {
            data += chunk;
            // Stop after 64KB (plenty of room for a few headers and rows)
            if (data.length > 65536) {
              stream.destroy();
              break;
            }
          }

          const lines = data.split(/\r?\n/).filter((l) => l.trim() !== '');
          if (lines.length === 0) {
            return reply.send({ headers: [], sampleRows: [] });
          }

          // Simple CSV parsing (split by delimiter, ignoring quotes for design-time simplicity)
          const parseLine = (line: string) => {
            return line.split(delimiter).map((val) => {
              // Strip quotes if present
              let clean = val.trim();
              if (clean.startsWith('"') && clean.endsWith('"')) {
                clean = clean.substring(1, clean.length - 1);
              } else if (clean.startsWith("'") && clean.endsWith("'")) {
                clean = clean.substring(1, clean.length - 1);
              }
              return clean;
            });
          };

          const headers = parseLine(lines[0]);
          const sampleRows = lines.slice(1, 6).map((line) => parseLine(line));

          return reply.send({ headers, sampleRows });
        } catch (error) {
          if (error instanceof ApiError) throw error;
          throw new ApiError(500, error instanceof Error ? error.message : String(error));
        }
      },
    );
  });
}
