import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ExecutionStatus } from '@beamflow/shared';
import type { SerializedWorkflow } from '@beamflow/shared';

// Mock the execution engine so /execute needs no Python runtime.
vi.mock('@beamflow/execution', () => ({
  executePipeline: vi.fn(async () => ({
    id: 'exec_test',
    status: ExecutionStatus.Completed,
    startedAt: '2024-01-01T00:00:00.000Z',
    completedAt: '2024-01-01T00:00:01.000Z',
    logs: ['[BeamFlow] done'],
    errors: [],
    exitCode: 0,
  })),
}));

import { buildApp } from '../app.js';
import { MemoryStorage } from '../test-helpers.js';

/** A minimal valid CSV-source → CSV-output pipeline for codegen/execute. */
function sourceToSinkWorkflow(id: string): SerializedWorkflow {
  const now = '2024-01-01T00:00:00.000Z';
  return {
    schemaVersion: '1.0.0',
    metadata: { id, name: 'Pipe', description: '', createdAt: now, updatedAt: now },
    nodes: [
      { id: 'src', type: 'beamflow:csv-source', settings: { filePath: '/in.csv' }, position: { x: 0, y: 0 } },
      { id: 'out', type: 'beamflow:csv-output', settings: { filePath: '/out.csv' }, position: { x: 200, y: 0 } },
    ],
    connections: [
      { id: 'e1', sourceNodeId: 'src', sourcePortId: 'out', targetNodeId: 'out', targetPortId: 'in' },
    ],
  };
}

describe('pipeline routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    ({ app } = await buildApp({ storage: new MemoryStorage() }));
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.clearAllMocks();
  });

  describe('CRUD lifecycle', () => {
    it('creates → gets → lists → updates → deletes a pipeline', async () => {
      // Create
      const created = await app.inject({
        method: 'POST',
        url: '/api/pipelines',
        payload: { name: 'My Pipeline' },
      });
      expect(created.statusCode).toBe(201);
      const id = created.json().metadata.id;
      expect(created.json().metadata.name).toBe('My Pipeline');

      // Get
      const got = await app.inject({ method: 'GET', url: `/api/pipelines/${id}` });
      expect(got.statusCode).toBe(200);
      const workflow = got.json() as SerializedWorkflow;
      expect(workflow.metadata.id).toBe(id);

      // List
      const list = await app.inject({ method: 'GET', url: '/api/pipelines' });
      expect(list.json().pipelines).toHaveLength(1);
      expect(list.json().pipelines[0]).toMatchObject({ id, nodeCount: 0, connectionCount: 0 });

      // Update
      const updated = await app.inject({
        method: 'PUT',
        url: `/api/pipelines/${id}`,
        payload: { ...workflow, metadata: { ...workflow.metadata, name: 'Renamed' } },
      });
      expect(updated.statusCode).toBe(200);
      expect(updated.json().metadata.name).toBe('Renamed');
      // Server forces the id and refreshes updatedAt.
      expect(updated.json().metadata.id).toBe(id);

      // Delete
      const del = await app.inject({ method: 'DELETE', url: `/api/pipelines/${id}` });
      expect(del.statusCode).toBe(204);
      const gone = await app.inject({ method: 'GET', url: `/api/pipelines/${id}` });
      expect(gone.statusCode).toBe(404);
    });

    it('returns 404 for get/update/delete of a missing pipeline', async () => {
      expect((await app.inject({ method: 'GET', url: '/api/pipelines/missing' })).statusCode).toBe(404);
      expect((await app.inject({ method: 'DELETE', url: '/api/pipelines/missing' })).statusCode).toBe(404);
      const put = await app.inject({
        method: 'PUT',
        url: '/api/pipelines/missing',
        payload: sourceToSinkWorkflow('missing'),
      });
      expect(put.statusCode).toBe(404);
    });
  });

  describe('POST /api/pipelines/:id/generate', () => {
    it('generates Python Beam code for a valid pipeline', async () => {
      // Create an empty pipeline, then PUT the concrete source→sink graph.
      const created = await app.inject({ method: 'POST', url: '/api/pipelines', payload: {} });
      const id = created.json().metadata.id;
      const wf = sourceToSinkWorkflow(id);
      await app.inject({ method: 'PUT', url: `/api/pipelines/${id}`, payload: wf });

      const res = await app.inject({ method: 'POST', url: `/api/pipelines/${id}/generate` });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.language).toBe('python');
      expect(body.code).toContain('import apache_beam');
      expect(Array.isArray(body.requirements)).toBe(true);
    });

    it('returns 404 when generating for a missing pipeline', async () => {
      const res = await app.inject({ method: 'POST', url: '/api/pipelines/missing/generate' });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('POST /api/pipelines/:id/execute', () => {
    it('executes (mocked) and caches the result for polling', async () => {
      const created = await app.inject({ method: 'POST', url: '/api/pipelines', payload: {} });
      const id = created.json().metadata.id;
      const wf = sourceToSinkWorkflow(id);
      await app.inject({ method: 'PUT', url: `/api/pipelines/${id}`, payload: wf });

      const exec = await app.inject({ method: 'POST', url: `/api/pipelines/${id}/execute` });
      expect(exec.statusCode).toBe(200);
      const result = exec.json();
      expect(result.status).toBe(ExecutionStatus.Completed);
      expect(result.id).toBe('exec_test');

      // The result is cached and retrievable by exec id.
      const polled = await app.inject({ method: 'GET', url: `/api/pipelines/${id}/executions/exec_test` });
      expect(polled.statusCode).toBe(200);
      expect(polled.json().id).toBe('exec_test');
    });

    it('returns 404 for an unknown execution id', async () => {
      const created = await app.inject({ method: 'POST', url: '/api/pipelines', payload: {} });
      const id = created.json().metadata.id;
      const res = await app.inject({ method: 'GET', url: `/api/pipelines/${id}/executions/nope` });
      expect(res.statusCode).toBe(404);
    });
  });
});
