import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { MemoryStorage } from '../test-helpers.js';

describe('node routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    ({ app } = await buildApp({ storage: new MemoryStorage() }));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /api/nodes', () => {
    it('returns all 6 built-in node definitions', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/nodes' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.nodes).toHaveLength(6);
      const types = body.nodes.map((n: { type: string }) => n.type);
      expect(types).toContain('beamflow:csv-source');
      expect(types).toContain('beamflow:filter');
      // Presentational fields present; functions omitted.
      expect(body.nodes[0]).toHaveProperty('ports');
      expect(body.nodes[0]).not.toHaveProperty('toIR');
    });
  });

  describe('GET /api/nodes/:type', () => {
    it('returns a single node definition', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/nodes/beamflow:csv-source' });
      expect(res.statusCode).toBe(200);
      expect(res.json().type).toBe('beamflow:csv-source');
    });

    it('returns 404 with an { error } envelope for an unknown type', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/nodes/beamflow:nope' });
      expect(res.statusCode).toBe(404);
      expect(res.json().error).toMatch(/not found/i);
    });
  });

  describe('POST /api/compile-subgraph', () => {
    it('compiles a linear subgraph into ordered IR steps', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/compile-subgraph',
        payload: {
          nodes: [
            { id: 'n1', type: 'beamflow:map', settings: { expression: 'element' }, position: { x: 0, y: 0 } },
          ],
          connections: [],
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body.steps)).toBe(true);
      expect(body.steps[0].operation).toBe('Map');
    });

    it('returns 400 when no nodes are provided', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/compile-subgraph',
        payload: { nodes: [], connections: [] },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/no nodes/i);
    });
  });

  describe('GET /api/health', () => {
    it('reports ok with the registered node count', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/health' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe('ok');
      expect(body.nodeTypes).toBe(6);
    });
  });
});
