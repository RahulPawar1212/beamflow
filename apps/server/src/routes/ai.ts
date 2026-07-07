import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { GoogleGenAI, Type, Schema } from '@google/genai';
import type { NodeRegistry } from '@beamflow/core';
import { db, isPostgres } from '../db/client.js';
import { sqliteUsers, pgUsers } from '../db/schema.js';
import { eq } from 'drizzle-orm';

interface GenerateFlowRequest {
  prompt: string;
}

/**
 * Serializes the node registry into a lightweight JSON schema for the AI prompt.
 */
function serializeNodeRegistry(registry: NodeRegistry): any[] {
  const nodes: any[] = [];
  for (const nodeDef of registry.getAll()) {
    if (!nodeDef) continue;

    nodes.push({
      type: nodeDef.type,
      name: nodeDef.name,
      description: nodeDef.description,
      category: nodeDef.category,
      inputs: nodeDef.ports?.filter((p: any) => p.type === 'input').map((p: any) => p.id) || [],
      outputs: nodeDef.ports?.filter((p: any) => p.type === 'output').map((p: any) => p.id) || [],
    });
  }
  return nodes;
}

export async function aiRoutes(app: FastifyInstance, registry: NodeRegistry) {
  app.post<{ Body: GenerateFlowRequest }>('/api/ai/generate', {
    preValidation: [app.authenticate],
  }, async (request, reply) => {
    try {
      const { prompt } = request.body;
      if (!prompt) {
        return reply.status(400).send({ error: 'Prompt is required' });
      }

      const userId = (request.user as any).id;
      let user;
      if (isPostgres) {
        user = await db.select().from(pgUsers).where(eq(pgUsers.id, userId)).get();
      } else {
        user = await db.select().from(sqliteUsers).where(eq(sqliteUsers.id, userId)).get();
      }

      const apiKey = user?.geminiApiKey || process.env.GEMINI_API_KEY;

      if (!apiKey) {
        return reply.status(400).send({ error: 'GEMINI_API_KEY is not configured. Please add it in your Settings.' });
      }

      const ai = new GoogleGenAI({ apiKey });

      const availableNodes = serializeNodeRegistry(registry);

      const systemInstruction = `You are an expert data pipeline workflow generator. The user will describe a workflow. You must translate this into a directed acyclic graph (DAG) of nodes.
CRITICAL: You may ONLY use the nodes provided in the 'AVAILABLE_NODES' list below. Do NOT invent new node types, inputs, or outputs. If a user asks for functionality that cannot be achieved with the provided nodes, use the closest possible nodes or omit that part.

AVAILABLE_NODES:
${JSON.stringify(availableNodes, null, 2)}
`;

      const responseSchema: Schema = {
        type: Type.OBJECT,
        properties: {
          nodes: {
            type: Type.ARRAY,
            description: "List of nodes in the generated workflow graph.",
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING, description: "Unique node ID (e.g., node_1)" },
                type: { type: Type.STRING, description: "The type of the node, MUST be one of the types from AVAILABLE_NODES" },
                configured_data: {
                  type: Type.OBJECT,
                  description: "Optional settings for the node (e.g., { filePath: '...' })",
                }
              },
              required: ["id", "type"]
            }
          },
          edges: {
            type: Type.ARRAY,
            description: "List of connections between nodes.",
            items: {
              type: Type.OBJECT,
              properties: {
                source: { type: Type.STRING, description: "Source node ID" },
                target: { type: Type.STRING, description: "Target node ID" },
                sourceHandle: { type: Type.STRING, description: "Output port ID of the source node" },
                targetHandle: { type: Type.STRING, description: "Input port ID of the target node" }
              },
              required: ["source", "target"]
            }
          }
        },
        required: ["nodes", "edges"]
      };

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          responseSchema: responseSchema,
        }
      });

      if (!response.text) {
          throw new Error('Failed to generate flow');
      }

      const generatedGraph = JSON.parse(response.text);

      // Perform basic validation before sending to frontend
      const validTypes = new Set(availableNodes.map(n => n.type));
      const validatedNodes = generatedGraph.nodes.filter((n: any) => validTypes.has(n.type));
      const validNodeIds = new Set(validatedNodes.map((n: any) => n.id));
      const validatedEdges = generatedGraph.edges.filter((e: any) => 
          validNodeIds.has(e.source) && validNodeIds.has(e.target)
      );

      return {
        nodes: validatedNodes,
        edges: validatedEdges,
      };
    } catch (error) {
      app.log.error(error);
      return reply.status(500).send({ error: 'Failed to generate flow with AI.' });
    }
  });
}
