/**
 * @module @beamflow/server/routes/nodes
 *
 * Node registry API routes.
 * Serves node definitions to the frontend for the palette and property panel.
 */

import type { FastifyInstance } from 'fastify';
import type { NodeRegistry } from '@beamflow/core';
import type { NodeCategory, INodeInstance, IConnection } from '@beamflow/shared';
import { DAG } from '@beamflow/graph';
import { buildIR } from '@beamflow/ir';

export async function nodeRoutes(
  app: FastifyInstance,
  registry: NodeRegistry,
): Promise<void> {
  /**
   * GET /api/nodes — List all registered node definitions.
   * Used by the palette to show available nodes.
   */
  app.get('/api/nodes', async (_req, reply) => {
    const definitions = registry.getAll().map((def) => ({
      type: def.type,
      name: def.name,
      description: def.description,
      category: def.category,
      icon: def.icon,
      version: def.version,
      tags: def.tags || [],
      ports: def.ports,
      settings: def.settings,
    }));

    return reply.send({ nodes: definitions });
  });

  /**
   * GET /api/nodes/:type — Get a single node definition with full schema.
   */
  app.get<{ Params: { type: string } }>(
    '/api/nodes/:type',
    async (req, reply) => {
      const definition = registry.get(req.params.type);
      if (!definition) {
        return reply.status(404).send({
          error: `Node type "${req.params.type}" not found.`,
        });
      }

      return reply.send({
        type: definition.type,
        name: definition.name,
        description: definition.description,
        category: definition.category,
        icon: definition.icon,
        version: definition.version,
        tags: definition.tags || [],
        ports: definition.ports,
        settings: definition.settings,
        documentation: definition.documentation,
      });
    },
  );

  /**
   * GET /api/nodes/category/:category — Get nodes by category.
   */
  app.get<{ Params: { category: string } }>(
    '/api/nodes/category/:category',
    async (req, reply) => {
      const definitions = registry
        .getByCategory(req.params.category as NodeCategory)
        .map((def) => ({
          type: def.type,
          name: def.name,
          description: def.description,
          category: def.category,
          icon: def.icon,
          version: def.version,
        }));

      return reply.send({ nodes: definitions });
    },
  );

  /**
   * POST /api/compile-subgraph — Compile a selected subgraph into an ordered
   * list of inline IR steps, so the editor can bake a composite custom node.
   *
   * Body: { nodes: INodeInstance[], connections: IConnection[] }
   * Returns: { steps: Array<{ operation, stepType, params, imports, label, inputRefs }> }
   *
   * The first step receives the composite's single external input; each later
   * step's inputRefs are indices into the returned array (linear or branching
   * within the group). External I/O validation (exactly one in/out) is done by
   * the caller; here we just translate to IR in topological order.
   */
  app.post<{
    Body: { nodes: INodeInstance[]; connections: IConnection[] };
  }>('/api/compile-subgraph', async (req, reply) => {
    const { nodes, connections } = req.body || { nodes: [], connections: [] };
    if (!Array.isArray(nodes) || nodes.length === 0) {
      return reply.status(400).send({ error: 'No nodes provided.' });
    }

    try {
      const dag = new DAG();
      for (const node of nodes) dag.addNode(node);
      // Only keep edges fully internal to the subgraph.
      const nodeIds = new Set(nodes.map((n) => n.id));
      for (const conn of connections) {
        if (nodeIds.has(conn.sourceNodeId) && nodeIds.has(conn.targetNodeId)) {
          dag.addEdge(conn);
        }
      }

      const ir = buildIR(dag, registry, { name: 'composite' });

      // Map internal step ids → array index for inputRefs rewriting.
      const indexOf = new Map<string, number>();
      ir.steps.forEach((s, i) => indexOf.set(s.id, i));

      const steps = ir.steps.map((s) => {
        const refs = s.inputs
          .map((id) => indexOf.get(id))
          .filter((i): i is number => i !== undefined);
        return {
          operation: s.operation,
          stepType: s.type,
          params: s.params,
          imports: s.imports,
          label: s.label,
          // First step (no internal inputs) gets the external input at build time.
          inputRefs: refs.length > 0 ? refs : undefined,
        };
      });

      return reply.send({ steps });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send({ error: message });
    }
  });
}
