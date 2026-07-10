/**
 * @module @beamflow/server/routes/pipelines
 *
 * Pipeline CRUD, code generation, and execution routes.
 */

import type { FastifyInstance } from 'fastify';
import * as fs from 'fs';
import * as path from 'path';
import * as util from 'util';
import { pipeline } from 'stream';
import type { NodeRegistry } from '@beamflow/core';
import { DAG, deserializeWorkflow, serializeWorkflow } from '@beamflow/graph';
import { buildIR, optimizeIR, validateIR } from '@beamflow/ir';
import type { SubflowResolver } from '@beamflow/ir';
import { generatePythonBeam } from '@beamflow/beam-generator';
import { executePipeline, LocalFeatherStorage, PreviewCacheManager, PreviewManager } from '@beamflow/execution';
import { generateId, timestamp, SCHEMA_VERSION, resolveSubflowOutputs } from '@beamflow/shared';
import type { SerializedWorkflow, PreviewRowsResponse } from '@beamflow/shared';
import type { IStorage } from '../storage.js';
import { projectsRepo } from '../db/repositories/projects.repo.js';
import { workflowsRepo } from '../db/repositories/workflows.repo.js';
import { notFound, badRequest, ApiError } from '../errors.js';

/**
 * Parse raw database driver errors into user-friendly messages.
 * Strips ODBC driver chain prefixes and pattern-matches common errors.
 */
function humanizeDbError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);

  // Strip ODBC driver chain: [Microsoft][ODBC Driver 18 for SQL Server][SQL Server]
  const stripped = raw.replace(/\[Microsoft\]\[.*?\]/gi, '').trim();

  // Pattern-match common SQL Server / PostgreSQL errors
  const patterns: Array<{ re: RegExp; msg: (m: RegExpMatchArray) => string }> = [
    {
      re: /Invalid object name '([^']+)'/i,
      msg: (m) => `Table or view "${m[1]}" was not found. Check the table name and database schema.`,
    },
    {
      re: /Invalid column name '([^']+)'/i,
      msg: (m) => `Column "${m[1]}" does not exist in the query result.`,
    },
    {
      re: /Login failed for user '([^']+)'/i,
      msg: (m) => `Authentication failed for user "${m[1]}". Check your username and password.`,
    },
    {
      re: /Cannot open database "([^"]+)"/i,
      msg: (m) => `Database "${m[1]}" does not exist or is inaccessible. Verify the database name.`,
    },
    {
      re: /relation "([^"]+)" does not exist/i,
      msg: (m) => `Table or view "${m[1]}" was not found. Check the table name and schema.`,
    },
    {
      re: /column "([^"]+)" does not exist/i,
      msg: (m) => `Column "${m[1]}" does not exist in the query result.`,
    },
    {
      re: /password authentication failed for user "([^"]+)"/i,
      msg: (m) => `Authentication failed for user "${m[1]}". Check your username and password.`,
    },
    {
      re: /database "([^"]+)" does not exist/i,
      msg: (m) => `Database "${m[1]}" does not exist. Verify the database name.`,
    },
    {
      re: /ECONNREFUSED/i,
      msg: () => `Connection refused. The database server is not reachable at the specified host and port.`,
    },
    {
      re: /ETIMEOUT|ETIMEDOUT|connect TIMEOUT/i,
      msg: () => `Connection timed out. Verify the host address and port, and check firewall settings.`,
    },
    {
      re: /ENOTFOUND/i,
      msg: () => `Server not found. The hostname could not be resolved. Check the server address.`,
    },
    {
      re: /Incorrect syntax near (.+)/i,
      msg: (m) => `SQL syntax error near ${m[1].trim()}. Review your query for typos.`,
    },
    {
      re: /syntax error at or near "([^"]+)"/i,
      msg: (m) => `SQL syntax error near "${m[1]}". Review your query for typos.`,
    },
    {
      re: /Trusted_Connection|SSPI/i,
      msg: () => `Windows Authentication failed. Ensure the server supports integrated security and the ODBC driver is installed.`,
    },
    {
      re: /SSL|certificate/i,
      msg: () => `SSL/TLS connection error. The server may require an encrypted connection or a trusted certificate.`,
    },
  ];

  for (const { re, msg } of patterns) {
    const match = raw.match(re);
    if (match) return msg(match);
  }

  // Fallback: return the stripped (de-ODBC'd) message
  return stripped || raw;
}

/** In-memory execution result cache. */
const executionResults = new Map<string, unknown>();

export async function pipelineRoutes(
  app: FastifyInstance,
  storage: IStorage,
  registry: NodeRegistry,
 ): Promise<void> {
  const previewStorage = new LocalFeatherStorage();
  const previewCache = new PreviewCacheManager(previewStorage);
  const previewManager = new PreviewManager(previewCache, previewStorage, registry);

  // Wrap in a plugin instance that enforces authentication and encapsulates hooks
  app.register(async (appWithAuth) => {
    appWithAuth.addHook('preHandler', app.authenticate);

    // ─── CRUD ─────────────────────────────────────────────────────────

    /** GET /api/pipelines — List saved pipelines.
     *  ?subflowsOnly=true → the user-global subflow library (with usedByCount).
     *  ?projectId=… scopes regular workflows; ?includeSubflows mixes subflows in. */
    appWithAuth.get<{ Querystring: { includeSubflows?: string; projectId?: string; subflowsOnly?: string } }>('/api/pipelines', async (req, reply) => {
      const userId = (req.user as any).id;
      const subflowsOnly = req.query.subflowsOnly === 'true';

      if (subflowsOnly) {
        // The shared library: all the user's subflows, each with how many
        // workflows reference it (for the picker's "used by N" + delete guard).
        const subflows = await workflowsRepo.listSubflows(userId);
        const summaries = await Promise.all(subflows.map(async (w) => ({
          id: w.metadata.id,
          name: w.metadata.name,
          description: w.metadata.description,
          isSubflow: true,
          projectId: w.metadata.projectId,
          createdAt: w.metadata.createdAt,
          updatedAt: w.metadata.updatedAt,
          nodeCount: w.nodes.length,
          connectionCount: w.connections.length,
          usedByCount: (await workflowsRepo.countReferences(userId, w.metadata.id)).count,
        })));
        return reply.send({ pipelines: summaries });
      }

      const includeSubflows = req.query.includeSubflows === 'true';
      const projectId = req.query.projectId || undefined;
      const workflows = await storage.list(userId, { includeSubflows, projectId });
      const summaries = workflows.map((w) => ({
        id: w.metadata.id,
        name: w.metadata.name,
        description: w.metadata.description,
        isSubflow: w.metadata.isSubflow,
        projectId: w.metadata.projectId,
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
    appWithAuth.post<{ Body: { name?: string; description?: string; isSubflow?: boolean; parameters?: any[]; projectId?: string; nodes?: any[]; connections?: any[] } }>(
      '/api/pipelines',
      async (req, reply) => {
        const userId = (req.user as any).id;
        const id = generateId('pipeline');
        const now = timestamp();
        const isSubflow = (req.body as Record<string, any>)?.isSubflow || false;

        // Subflows are a USER-GLOBAL shared library — reusable across all projects —
        // so they are NOT tied to a project (projectId stays null). Regular
        // workflows are scoped to the requested project, or the user's default.
        let projectId: string | undefined;
        if (!isSubflow) {
          projectId = (req.body as Record<string, any>)?.projectId as string | undefined;
          if (!projectId) {
            projectId = (await projectsRepo.ensureDefaultProject(userId)).id;
          }
        }

        const workflow: SerializedWorkflow = {
          schemaVersion: SCHEMA_VERSION,
          metadata: {
            id,
            name: (req.body as Record<string, any>)?.name || 'Untitled Pipeline',
            description: (req.body as Record<string, any>)?.description || '',
            isSubflow,
            parameters: (req.body as Record<string, any>)?.parameters || [],
            projectId,
            createdAt: now,
            updatedAt: now,
          },
          nodes: (req.body as Record<string, any>)?.nodes || [],
          connections: (req.body as Record<string, any>)?.connections || [],
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
        // Invalidate all previews since we don't have diffing yet
        const nodeIds = workflow.nodes.map(n => n.id);
        await previewCache.invalidatePreviews(req.params.id, nodeIds);

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
        await previewStorage.deleteAll(req.params.id);
        return reply.status(204).send();
      },
    );

    /** GET /api/pipelines/:id/references — how many workflows use this subflow. */
    appWithAuth.get<{ Params: { id: string } }>(
      '/api/pipelines/:id/references',
      async (req, reply) => {
        const userId = (req.user as any).id;
        const { count, names } = await workflowsRepo.countReferences(userId, req.params.id);
        return reply.send({ count, names });
      },
    );

    // ─── Preview Engine ────────────────────────────────────────────────

    /** POST /api/pipelines/:id/nodes/:nodeId/preview — Trigger a preview generation */
    appWithAuth.post<{ Params: { id: string; nodeId: string } }>(
      '/api/pipelines/:id/nodes/:nodeId/preview',
      async (req, reply) => {
        const userId = (req.user as any).id;
        const workflow = await storage.get(req.params.id, userId);
        if (!workflow) {
          throw notFound('Pipeline not found or unauthorized.');
        }

        // Fire and forget — run in background. If subflow expansion fails (e.g. a
        // referenced subflow was deleted), record it as a failed preview so the
        // panel shows the clear, node-named message instead of hanging.
        flattenSubflowsForPreview(workflow, userId).then(expandedWorkflow => {
          previewManager.triggerPreview(expandedWorkflow, req.params.nodeId, 1000).catch(console.error);
        }).catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          previewCache
            .updateMetadata(req.params.id, req.params.nodeId, { status: 'failed', errorMessage: message })
            .catch(console.error);
        });

        return reply.status(202).send({ message: 'Preview generation started.' });
      }
    );

    /** DELETE /api/pipelines/:id/nodes/:nodeId/preview — Cancel a running preview */
    appWithAuth.delete<{ Params: { id: string; nodeId: string } }>(
      '/api/pipelines/:id/nodes/:nodeId/preview',
      async (req, reply) => {
        previewManager.cancelPreview(req.params.id, req.params.nodeId);
        return reply.status(204).send();
      }
    );

    /** GET /api/pipelines/:id/nodes/:nodeId/preview — Retrieve paginated preview data */
    appWithAuth.get<{ Params: { id: string; nodeId: string }, Querystring: { page?: string, pageSize?: string } }>(
      '/api/pipelines/:id/nodes/:nodeId/preview',
      async (req, reply) => {
        const userId = (req.user as any).id;
        // Basic auth check
        const workflow = await storage.get(req.params.id, userId);
        if (!workflow) {
          throw notFound('Pipeline not found or unauthorized.');
        }

        const page = parseInt(req.query.page || '1', 10);
        const pageSize = parseInt(req.query.pageSize || '100', 10);

        const response = await previewCache.getPreviewPage(req.params.id, req.params.nodeId, page, pageSize);
        if (!response) {
          throw notFound('No preview available for this node.');
        }

        return reply.send(response);
      }
    );

    // ─── Code Generation ──────────────────────────────────────────────

    /**
     * Recursively expands subflows by inlining their nodes and connections.
     *
     * Used ONLY by the preview trigger — preview's truncated-DAG/target-step
     * resolution assumes a flat id space, same reasoning as the editor's
     * design-time schema propagation. Code generation and execution use
     * `resolveSubflowTree` + `buildIR`'s recursive composite-step compilation
     * instead, so subflows compile to real nested `beam.PTransform` classes.
     */
    async function flattenSubflowsForPreview(
      workflow: SerializedWorkflow,
      userId: string,
      depth = 0
    ): Promise<SerializedWorkflow> {
      if (depth > 10) throw new Error('Max subflow nesting depth exceeded (circular dependency?).');

      let expandedNodes = [...workflow.nodes];
      let expandedConnections = [...workflow.connections];

      let hasSubflows = true;
      while (hasSubflows) {
        hasSubflows = false;
        const subflowNodeIndex = expandedNodes.findIndex(n => n.type === 'system:subflow');
        if (subflowNodeIndex === -1) break;
        hasSubflows = true;

        const originalSubflowNode = expandedNodes[subflowNodeIndex];
        // DO NOT splice it out! We keep it as a proxy for previewability.
        // Change type to system:subflow-output so it acts as a pass-through in execution.
        const subflowNode = { ...originalSubflowNode, type: 'system:subflow-output' };
        expandedNodes[subflowNodeIndex] = subflowNode;

        // A human-friendly node reference for error messages (label falls back to id).
        const nodeRef = (originalSubflowNode as any).label
          ? `"${(originalSubflowNode as any).label}" (${subflowNode.id})`
          : subflowNode.id;

        const subflowId = subflowNode.settings?.subflowId;
        if (!subflowId) {
          throw badRequest(
            `Subflow node ${nodeRef} has no subflow selected. Open the node and pick a subflow.`,
            [{ severity: 'error', nodeId: subflowNode.id, message: 'No subflow selected for this Subflow node.' }],
          );
        }

        const subflowWf = await storage.get(subflowId as string, userId);
        if (!subflowWf) {
          // The referenced subflow was deleted (or isn't accessible). Surface a
          // clear, node-named validation error (400) instead of a bare 500 —
          // the user needs to know WHICH node to fix.
          throw badRequest(
            `Subflow node ${nodeRef} references a subflow that no longer exists. ` +
              `Pick a different subflow or remove the node.`,
            [{ severity: 'error', nodeId: subflowNode.id, message: `Referenced subflow ${subflowId} not found (deleted?).` }],
          );
        }

        const fullyExpandedSubflow = await flattenSubflowsForPreview(subflowWf, userId, depth + 1);

        const prefix = `sub_${subflowNode.id}_`;
        const mappedNodes = fullyExpandedSubflow.nodes.map(n => {
          // Substitute parameters!
          const mappedSettings = { ...n.settings };
          if (fullyExpandedSubflow.metadata?.parameters) {
            for (const param of fullyExpandedSubflow.metadata.parameters) {
              if (param.targetNodeId === n.id && subflowNode.settings && param.id in subflowNode.settings) {
                mappedSettings[param.targetSettingKey] = subflowNode.settings[param.id];
              }
            }
          }
          return {
            ...n,
            id: prefix + n.id,
            settings: mappedSettings,
          };
        });
        const mappedConnections = fullyExpandedSubflow.connections.map(c => ({
          ...c,
          id: prefix + c.id,
          sourceNodeId: prefix + c.sourceNodeId,
          targetNodeId: prefix + c.targetNodeId,
        }));

        const inputNodes = mappedNodes.filter(n => n.type === 'system:subflow-input');
        const outputNodes = mappedNodes.filter(n => n.type === 'system:subflow-output');

        const activeSubNodes = mappedNodes.filter(n => n.type !== 'system:subflow-input' && n.type !== 'system:subflow-output');
        expandedNodes.push(...activeSubNodes);

        const internalInputEdges = mappedConnections.filter(c => inputNodes.some(inNode => inNode.id === c.sourceNodeId));
        const internalOutputEdges = mappedConnections.filter(c => outputNodes.some(outNode => outNode.id === c.targetNodeId));

        const activeSubConnections = mappedConnections.filter(c => 
          !inputNodes.some(inNode => inNode.id === c.sourceNodeId) &&
          !outputNodes.some(outNode => outNode.id === c.targetNodeId)
        );
        expandedConnections.push(...activeSubConnections);

        // Find parent edges connected to this subflow node
        const parentInEdges = expandedConnections.filter(c => c.targetNodeId === subflowNode.id);
        const parentOutEdges = expandedConnections.filter(c => c.sourceNodeId === subflowNode.id);

        // Remove parent edges from expandedConnections since we rewire them
        expandedConnections = expandedConnections.filter(c => c.targetNodeId !== subflowNode.id && c.sourceNodeId !== subflowNode.id);

        // Build name → internal input node id map for per-port matching. The parent
        // edge's targetPortId carries the boundary port name (set by the editor's
        // grouping). Older single-IO subflows have no name match → fall back to input 0.
        const inputIdByName = new Map<string, string>();
        for (const inNode of inputNodes) {
          const name = (inNode.settings?.inputName as string) ?? '';
          if (name) inputIdByName.set(name, inNode.id);
        }

        // Rewire parent inputs to the matching subflow-input's downstream internal edges.
        for (const pIn of parentInEdges) {
          if (inputNodes.length === 0) continue;
          const matchedInputId =
            (pIn.targetPortId && inputIdByName.get(pIn.targetPortId)) || inputNodes[0].id;
          // Only fan into internal edges that originate at the matched input node.
          const edgesForInput = internalInputEdges.filter(
            (e) => e.sourceNodeId === matchedInputId,
          );
          for (const internalEdge of edgesForInput) {
            expandedConnections.push({
              id: `rewired_${pIn.id}_${internalEdge.id}`,
              sourceNodeId: pIn.sourceNodeId,
              sourcePortId: pIn.sourcePortId,
              targetNodeId: internalEdge.targetNodeId,
              targetPortId: internalEdge.targetPortId,
            });
          }
        }

        // Resolve which internal nodes feed the subflow's output boundary. This
        // uses the shared classifier so the boundary is auto-derived when there's
        // no explicit output node but exactly one terminal, and a clear node-named
        // error is thrown for ambiguous / orphaned cases (rather than silently
        // dropping a branch). The proxy (retyped to system:subflow-output) has a
        // single required 'in' port, so every resolved output routes to 'in'.
        const outputResolution = resolveSubflowOutputs(
          activeSubNodes.map((n) => ({ id: n.id, label: (n as any).label })),
          outputNodes.map((n) => ({ id: n.id })),
          mappedConnections.map((c) => ({ from: c.sourceNodeId, to: c.targetNodeId })),
        );
        if (outputResolution.error) {
          throw badRequest(outputResolution.error.message, [
            { severity: 'error', nodeId: outputResolution.error.nodeId, message: outputResolution.error.message },
          ]);
        }
        for (const routing of outputResolution.outputs) {
          expandedConnections.push({
            id: `rewired_to_proxy_${routing.sourceId}`,
            sourceNodeId: routing.sourceId,
            sourcePortId: 'out',
            targetNodeId: subflowNode.id,
            targetPortId: 'in',
          });
        }

        // Restore parent out edges, since subflowNode still exists
        expandedConnections.push(...parentOutEdges);
      }

      return {
        ...workflow,
        nodes: expandedNodes,
        connections: expandedConnections,
      };
    }

    /**
     * Recursively pre-fetch every subflow document referenced (directly or
     * transitively) by a workflow, into a flat id -> document map, WITHOUT
     * flattening/inlining anything. Used by /generate and /execute so
     * `buildIR` can recursively compile `system:subflow` nodes into nested
     * composite IRSteps (real PTransform classes) instead of inlined code.
     *
     * All user-facing validation (no subflow selected, subflow not found,
     * ambiguous/orphaned output boundary) happens HERE, as badRequest (400)
     * errors with node ids — mirroring flattenSubflowsForPreview's semantics
     * — so buildIR itself only ever throws "should not happen" errors for a
     * resolver that already did its job.
     */
    async function resolveSubflowTree(
      workflow: SerializedWorkflow,
      userId: string,
      depth = 0,
      seen: Map<string, SerializedWorkflow> = new Map(),
    ): Promise<Map<string, SerializedWorkflow>> {
      if (depth > 10) {
        throw badRequest('Max subflow nesting depth exceeded (circular dependency?).');
      }

      for (const node of workflow.nodes) {
        if (node.type !== 'system:subflow') continue;

        const nodeRef = (node as any).label ? `"${(node as any).label}" (${node.id})` : node.id;
        const subflowId = node.settings?.subflowId as string | undefined;
        if (!subflowId) {
          throw badRequest(
            `Subflow node ${nodeRef} has no subflow selected. Open the node and pick a subflow.`,
            [{ severity: 'error', nodeId: node.id, message: 'No subflow selected for this Subflow node.' }],
          );
        }

        if (seen.has(subflowId)) continue; // already resolved (dedup repeated references)

        const subflowWf = await storage.get(subflowId, userId);
        if (!subflowWf) {
          throw badRequest(
            `Subflow node ${nodeRef} references a subflow that no longer exists. ` +
              `Pick a different subflow or remove the node.`,
            [{ severity: 'error', nodeId: node.id, message: `Referenced subflow ${subflowId} not found (deleted?).` }],
          );
        }

        seen.set(subflowId, subflowWf);

        // Pre-validate the output boundary now (same classifier buildIR will
        // use), so ambiguity surfaces as a clean 400 before IR building.
        const activeNodes = subflowWf.nodes.filter(
          (n) => n.type !== 'system:subflow-input' && n.type !== 'system:subflow-output',
        );
        const outputNodes = subflowWf.nodes.filter((n) => n.type === 'system:subflow-output');
        const edgesLite = subflowWf.connections.map((c) => ({ from: c.sourceNodeId, to: c.targetNodeId }));
        const outputResolution = resolveSubflowOutputs(
          activeNodes.map((n) => ({ id: n.id, label: (n as any).label })),
          outputNodes.map((n) => ({ id: n.id })),
          edgesLite,
        );
        if (outputResolution.error) {
          throw badRequest(outputResolution.error.message, [
            { severity: 'error', nodeId: outputResolution.error.nodeId, message: outputResolution.error.message },
          ]);
        }

        // Recurse into the subflow's own nodes (nested subflows).
        await resolveSubflowTree(subflowWf, userId, depth + 1, seen);
      }

      return seen;
    }

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
          // 0. Recursively pre-resolve every referenced subflow document
          //    (no flattening) so buildIR can compile each system:subflow
          //    node into a nested composite IRStep — a real PTransform class.
          const subflowDocs = await resolveSubflowTree(workflow, userId);
          const resolveSubflow: SubflowResolver = (id) => {
            const doc = subflowDocs.get(id);
            return doc ? { workflow: doc } : undefined;
          };

          // 1. Deserialize to DAG (un-flattened — still has system:subflow nodes)
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
            resolveSubflow,
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
          // Generate code first — same recursive subflow resolution as /generate,
          // so subflows compile to real nested PTransform classes.
          const subflowDocs = await resolveSubflowTree(workflow, userId);
          const resolveSubflow: SubflowResolver = (id) => {
            const doc = subflowDocs.get(id);
            return doc ? { workflow: doc } : undefined;
          };
          const { dag, metadata } = deserializeWorkflow(workflow);
          const ir = buildIR(dag, registry, { name: metadata.name, resolveSubflow });
          const optimizedIR = optimizeIR(ir);
          const generated = generatePythonBeam(optimizedIR);

          const controller = new AbortController();
          req.raw.on('close', () => {
            if (req.raw.destroyed || req.raw.aborted) {
              controller.abort();
            }
          });

          // Execute
          const result = await executePipeline(generated, { signal: controller.signal });

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

    /** POST /api/pipelines/preview-sql — Helper to inspect SQL Query columns and types. */
    appWithAuth.post<{ Body: { connectionString: string; sqlQuery: string } }>(
      '/api/pipelines/preview-sql',
      async (req, reply) => {
        const { connectionString, sqlQuery } = req.body;
        if (!connectionString) {
          throw badRequest('connectionString is required.');
        }
        if (!sqlQuery) {
          throw badRequest('sqlQuery is required.');
        }

        try {
          let columns: Array<{ name: string; type: string }> = [];

          if (connectionString.startsWith('postgres://') || connectionString.startsWith('postgresql://')) {
            // Postgres connection
            const postgres = (await import('postgres')).default;
            const sql = postgres(connectionString, { max: 1, timeout: 5000 });
            try {
              // Wrap in a subquery to run metadata analysis via LIMIT 0
              const res = await sql.unsafe(`SELECT * FROM (${sqlQuery}) AS t LIMIT 0`);
              columns = res.columns.map((c: any) => {
                let inferredType = 'string';
                const oid = c.type;
                if ([20, 21, 23, 1560].includes(oid)) inferredType = 'integer';
                else if ([700, 701, 1700].includes(oid)) inferredType = 'double';
                else if (oid === 16) inferredType = 'boolean';
                else if (oid === 1082) inferredType = 'date';
                else if ([1114, 1184].includes(oid)) inferredType = 'datetime';
                else if (oid === 1083) inferredType = 'time';
                return { name: c.name, type: inferredType };
              });
            } finally {
              await sql.end();
            }
          } else if (connectionString.startsWith('file:') || connectionString.includes('.db') || connectionString === ':memory:') {
            // SQLite connection
            const { createClient } = await import('@libsql/client');
            const client = createClient({ url: connectionString });
            try {
              // Run LIMIT 1 to do type inference on sample values if available, or just get column names
              const res = await client.execute(`SELECT * FROM (${sqlQuery}) LIMIT 1`);
              const firstRow = res.rows[0];
              columns = res.columns.map((colName, index) => {
                let inferredType = 'string';
                if (firstRow) {
                  const val = firstRow[index] ?? (firstRow as any)[colName];
                  if (typeof val === 'number') {
                    inferredType = Number.isInteger(val) ? 'integer' : 'double';
                  } else if (typeof val === 'boolean') {
                    inferredType = 'boolean';
                  } else if (val instanceof Date) {
                    inferredType = 'datetime';
                  } else if (typeof val === 'string') {
                    if (/^\d{4}-\d{2}-\d{2}$/.test(val)) inferredType = 'date';
                    else if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/.test(val)) inferredType = 'datetime';
                  }
                }
                return { name: colName, type: inferredType };
              });
            } finally {
              client.close();
            }
          } else if (connectionString.startsWith('mssql://') || connectionString.startsWith('sqlserver://')) {
            // MSSQL connection
            const url = new URL(connectionString.replace(/^sqlserver:\/\//i, 'mssql://'));
            const isWindowsAuth = url.searchParams.get('integratedSecurity') === 'true';

            const config: any = {
              server: url.hostname,
              port: url.port ? parseInt(url.port, 10) : 1433,
              database: url.pathname.replace(/^\//, ''),
              options: {
                encrypt: false,
                trustServerCertificate: true
              }
            };

            if (url.username) {
              config.user = decodeURIComponent(url.username);
            }
            if (url.password) {
              config.password = decodeURIComponent(url.password);
            }

            let mssql;
            if (isWindowsAuth) {
              mssql = (await import('mssql/msnodesqlv8')).default;
              const serverName = url.hostname;
              const portName = url.port ? `,${url.port}` : '';
              const dbName = url.pathname.replace(/^\//, '');
              config.connectionString = `Driver={ODBC Driver 18 for SQL Server};Server=${serverName}${portName};Database=${dbName};Trusted_Connection=yes;Encrypt=no;TrustServerCertificate=yes;`;
            } else {
              mssql = (await import('mssql')).default;
            }

            const pool = await mssql.connect(config);
            try {
              const res = await pool.request().query(`SELECT TOP 0 * FROM (${sqlQuery}) AS t`);
              columns = Object.keys(res.recordset.columns).map((colName) => {
                const colDef = res.recordset.columns[colName];
                let inferredType = 'string';
                const typeObj: any = colDef?.type;
                const typeName = (typeof typeObj === 'function' 
                  ? typeObj.name 
                  : (typeObj?.name || typeObj?.constructor?.name || '')).toLowerCase();
                if (['int', 'bigint', 'smallint', 'tinyint'].includes(typeName)) {
                  inferredType = 'integer';
                } else if (['float', 'real', 'decimal', 'numeric', 'money'].includes(typeName)) {
                  inferredType = 'double';
                } else if (['bit'].includes(typeName)) {
                  inferredType = 'boolean';
                } else if (['date'].includes(typeName)) {
                  inferredType = 'date';
                } else if (['datetime', 'datetime2', 'smalldatetime', 'datetimeoffset'].includes(typeName)) {
                  inferredType = 'datetime';
                } else if (['time'].includes(typeName)) {
                  inferredType = 'time';
                }
                return { name: colName, type: inferredType };
              });
            } finally {
              await pool.close();
            }
          } else {
            throw badRequest('Unsupported database type. Connection string must start with postgres://, postgresql://, file:, or mssql://');
          }

          return reply.send({ columns });
        } catch (error) {
          if (error instanceof ApiError) throw error;
          throw new ApiError(500, humanizeDbError(error));
        }
      },
    );

    /** POST /api/pipelines/test-connection — Verify a database connection string. */
    appWithAuth.post<{ Body: { connectionString: string } }>(
      '/api/pipelines/test-connection',
      async (req, reply) => {
        const { connectionString } = req.body;
        if (!connectionString) {
          throw badRequest('connectionString is required.');
        }

        try {
          if (connectionString.startsWith('postgres://') || connectionString.startsWith('postgresql://')) {
            const postgres = (await import('postgres')).default;
            const sql = postgres(connectionString, { max: 1, timeout: 3000 });
            try {
              await sql`SELECT 1`;
            } finally {
              await sql.end();
            }
          } else if (connectionString.startsWith('file:') || connectionString.includes('.db') || connectionString === ':memory:') {
            const { createClient } = await import('@libsql/client');
            const client = createClient({ url: connectionString });
            try {
              await client.execute('SELECT 1');
            } finally {
              client.close();
            }
          } else if (connectionString.startsWith('mssql://') || connectionString.startsWith('sqlserver://')) {
            const url = new URL(connectionString.replace(/^sqlserver:\/\//i, 'mssql://'));
            const isWindowsAuth = url.searchParams.get('integratedSecurity') === 'true';

            const config: any = {
              server: url.hostname,
              port: url.port ? parseInt(url.port, 10) : 1433,
              database: url.pathname.replace(/^\//, ''),
              options: {
                encrypt: false,
                trustServerCertificate: true
              }
            };

            if (url.username) {
              config.user = decodeURIComponent(url.username);
            }
            if (url.password) {
              config.password = decodeURIComponent(url.password);
            }

            let mssql;
            if (isWindowsAuth) {
              mssql = (await import('mssql/msnodesqlv8')).default;
              const serverName = url.hostname;
              const portName = url.port ? `,${url.port}` : '';
              const dbName = url.pathname.replace(/^\//, '');
              config.connectionString = `Driver={ODBC Driver 18 for SQL Server};Server=${serverName}${portName};Database=${dbName};Trusted_Connection=yes;Encrypt=no;TrustServerCertificate=yes;`;
            } else {
              mssql = (await import('mssql')).default;
            }

            const pool = await mssql.connect(config);
            try {
              await pool.request().query('SELECT 1');
            } finally {
              await pool.close();
            }
          } else {
            throw badRequest('Unsupported database connection provider. Connection string must start with postgres://, postgresql://, file:, or mssql://');
          }

          return reply.send({ success: true, message: 'Connection established successfully!' });
        } catch (error) {
          return reply.send({
            success: false,
            error: humanizeDbError(error)
          });
        }
      }
    );

    /** POST /api/pipelines/upload — Upload a file (e.g., CSV) and get the absolute path on the server. */
    appWithAuth.post(
      '/api/pipelines/upload',
      async (req, reply) => {
        const data = await req.file();
        if (!data) {
          throw badRequest('No file uploaded');
        }

        const projectRoot = process.cwd(); // Root of the beamflow project
        const uploadDir = path.join(projectRoot, '.beamflow', 'uploads');
        await fs.promises.mkdir(uploadDir, { recursive: true });

        const filename = `${Date.now()}-${data.filename}`;
        const filePath = path.join(uploadDir, filename);

        const pump = util.promisify(pipeline);
        await pump(data.file, fs.createWriteStream(filePath));

        return reply.send({ path: filePath });
      }
    );
  });
}
