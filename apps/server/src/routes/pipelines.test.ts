import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ExecutionStatus } from '@beamflow/shared';
import type { SerializedWorkflow } from '@beamflow/shared';

// Mock the execution engine so /execute needs no Python runtime.
vi.mock('@beamflow/execution', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@beamflow/execution')>();
  return {
    ...actual,
    executePipeline: vi.fn(async () => ({
      id: 'exec_test',
      status: ExecutionStatus.Completed,
      startedAt: '2024-01-01T00:00:00.000Z',
      completedAt: '2024-01-01T00:00:01.000Z',
      logs: ['[BeamFlow] done'],
      errors: [],
      exitCode: 0,
    })),
    // Dummy implementations for tests to avoid filesystem side-effects
    LocalFeatherStorage: class LocalFeatherStorage {
      getFeatherFilePath() { return 'dummy.feather'; }
      async deleteAll() {}
    },
    PreviewCacheManager: class PreviewCacheManager {
      async updateMetadata() {}
      async getPreviewPage() { return { data: [], totalRows: 0, page: 1, pageSize: 100, status: 'ready' }; }
      // The PUT /pipelines/:id route invalidates previews on save; without this
      // the mock threw (undefined is not a function) → 500 → the workflow never
      // saved → later generate saw an empty graph → 400. Both stale failures.
      async invalidatePreviews() {}
    },
    PreviewManager: class PreviewManager {
      async triggerPreview() {}
    }
  };
});

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
  let token: string;

  beforeEach(async () => {
    ({ app } = await buildApp({
      storage: new MemoryStorage(),
    }));
    await app.ready();

    // Create a mock user session with a unique email to avoid 409 collisions
    const email = `user_${Math.random().toString(36).substring(2, 8)}@example.com`;
    const userReg = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email,
        password: 'password123',
        name: 'John Doe',
      },
    });
    token = userReg.json().token;
  });

  afterEach(async () => {
    await app.close();
    vi.clearAllMocks();
  });

  describe('Authentication protection', () => {
    it('returns 401 for unauthenticated calls', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/pipelines' });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('CRUD lifecycle', () => {
    it('creates → gets → lists → updates → deletes a pipeline', async () => {
      // Create
      const created = await app.inject({
        method: 'POST',
        url: '/api/pipelines',
        headers: { Authorization: `Bearer ${token}` },
        payload: { name: 'My Pipeline' },
      });
      expect(created.statusCode).toBe(201);
      const id = created.json().metadata.id;
      expect(created.json().metadata.name).toBe('My Pipeline');

      // Get
      const got = await app.inject({
        method: 'GET',
        url: `/api/pipelines/${id}`,
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(got.statusCode).toBe(200);
      const workflow = got.json() as SerializedWorkflow;
      expect(workflow.metadata.id).toBe(id);

      // List
      const list = await app.inject({
        method: 'GET',
        url: '/api/pipelines',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(list.json().pipelines).toHaveLength(1);
      expect(list.json().pipelines[0]).toMatchObject({ id, nodeCount: 0, connectionCount: 0 });

      // Update
      const updated = await app.inject({
        method: 'PUT',
        url: `/api/pipelines/${id}`,
        headers: { Authorization: `Bearer ${token}` },
        payload: { ...workflow, metadata: { ...workflow.metadata, name: 'Renamed' } },
      });
      expect(updated.statusCode).toBe(200);
      expect(updated.json().metadata.name).toBe('Renamed');
      expect(updated.json().metadata.id).toBe(id);

      // Delete
      const del = await app.inject({
        method: 'DELETE',
        url: `/api/pipelines/${id}`,
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(del.statusCode).toBe(204);
      
      const gone = await app.inject({
        method: 'GET',
        url: `/api/pipelines/${id}`,
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(gone.statusCode).toBe(404);
    });

    it('returns 404 for get/update/delete of a missing pipeline', async () => {
      expect((await app.inject({
        method: 'GET',
        url: '/api/pipelines/missing',
        headers: { Authorization: `Bearer ${token}` },
      })).statusCode).toBe(404);

      expect((await app.inject({
        method: 'DELETE',
        url: '/api/pipelines/missing',
        headers: { Authorization: `Bearer ${token}` },
      })).statusCode).toBe(404);

      const put = await app.inject({
        method: 'PUT',
        url: '/api/pipelines/missing',
        headers: { Authorization: `Bearer ${token}` },
        payload: sourceToSinkWorkflow('missing'),
      });
      expect(put.statusCode).toBe(404);
    });
  });

  describe('POST /api/pipelines/:id/generate', () => {
    it('generates Python Beam code for a valid pipeline', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/api/pipelines',
        headers: { Authorization: `Bearer ${token}` },
        payload: {},
      });
      const id = created.json().metadata.id;
      const wf = sourceToSinkWorkflow(id);
      
      await app.inject({
        method: 'PUT',
        url: `/api/pipelines/${id}`,
        headers: { Authorization: `Bearer ${token}` },
        payload: wf,
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/pipelines/${id}/generate`,
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.language).toBe('python');
      expect(body.code).toContain('import apache_beam');
      expect(Array.isArray(body.requirements)).toBe(true);
    });

    it('returns 404 when generating for a missing pipeline', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/pipelines/missing/generate',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it('compiles a subflow-containing pipeline to a nested PTransform class instead of inlining it', async () => {
      const now = '2024-01-01T00:00:00.000Z';

      // 1. Create the subflow document (isSubflow: true), a simple
      //    Input -> Filter -> Output chain exposing the filter's value.
      const subflowCreate = await app.inject({
        method: 'POST',
        url: '/api/pipelines',
        headers: { Authorization: `Bearer ${token}` },
        payload: {
          name: 'Age Filter Subflow',
          isSubflow: true,
          parameters: [
            { id: 'param_1', name: 'Min Age', type: 'string', targetNodeId: 'inner_filter', targetSettingKey: 'value' },
          ],
          nodes: [
            { id: 'inner_input', type: 'system:subflow-input', settings: { inputName: 'Input 1' }, position: { x: 0, y: 0 } },
            { id: 'inner_filter', type: 'beamflow:filter', settings: { field: 'age', operator: '>', value: '18' }, position: { x: 100, y: 0 } },
            { id: 'inner_output', type: 'system:subflow-output', settings: { outputName: 'Output 1' }, position: { x: 200, y: 0 } },
          ],
          connections: [
            { id: 'ie1', sourceNodeId: 'inner_input', sourcePortId: 'out', targetNodeId: 'inner_filter', targetPortId: 'in' },
            { id: 'ie2', sourceNodeId: 'inner_filter', sourcePortId: 'out', targetNodeId: 'inner_output', targetPortId: 'in' },
          ],
        },
      });
      expect(subflowCreate.statusCode).toBe(201);
      const subflowId = subflowCreate.json().metadata.id;

      // 2. Create the parent pipeline referencing the subflow via a
      //    system:subflow proxy, overriding the exposed parameter.
      const created = await app.inject({
        method: 'POST',
        url: '/api/pipelines',
        headers: { Authorization: `Bearer ${token}` },
        payload: {},
      });
      const id = created.json().metadata.id;
      const parentWorkflow: SerializedWorkflow = {
        schemaVersion: '1.0.0',
        metadata: { id, name: 'Parent', description: '', createdAt: now, updatedAt: now },
        nodes: [
          { id: 'src', type: 'beamflow:csv-source', settings: { filePath: '/in.csv' }, position: { x: 0, y: 0 } },
          { id: 'proxy', type: 'system:subflow', settings: { subflowId, param_1: '21' }, position: { x: 100, y: 0 } },
          { id: 'out', type: 'beamflow:csv-output', settings: { filePath: '/out.csv' }, position: { x: 200, y: 0 } },
        ],
        connections: [
          { id: 'e1', sourceNodeId: 'src', sourcePortId: 'out', targetNodeId: 'proxy', targetPortId: 'in' },
          { id: 'e2', sourceNodeId: 'proxy', sourcePortId: 'out', targetNodeId: 'out', targetPortId: 'in' },
        ],
      };

      await app.inject({
        method: 'PUT',
        url: `/api/pipelines/${id}`,
        headers: { Authorization: `Bearer ${token}` },
        payload: parentWorkflow,
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/pipelines/${id}/generate`,
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();

      // The subflow compiles to its OWN PTransform class (not inlined flat
      // statements), instantiated once at the proxy's use site.
      expect(body.code).toMatch(/class \w*Age_Filter_Subflow\w*\(beam\.PTransform\):/);
      expect(body.code).toContain('def expand(self, pcoll):');
      expect(body.code).toMatch(/>>\s*\w*Age_Filter_Subflow\w*\(/);
    });

    it('generates code for a self-contained subflow (own CSV Source inside, no upstream edge into the proxy)', async () => {
      // Regression: system:subflow's "in" port defaulted to required=true,
      // which was harmless while subflows were always flattened before
      // dag.validate() ran. Once /generate stopped flattening (validating
      // the real un-expanded DAG), a subflow with no upstream feed — reading
      // its own data internally instead of via a system:subflow-input
      // boundary — failed graph validation with a false-positive
      // "Required input port \"Input\" is not connected."
      const now = '2024-01-01T00:00:00.000Z';
      const subflowCreate = await app.inject({
        method: 'POST',
        url: '/api/pipelines',
        headers: { Authorization: `Bearer ${token}` },
        payload: {
          name: 'Self Contained Subflow',
          isSubflow: true,
          nodes: [
            { id: 'inner_src', type: 'beamflow:csv-source', settings: { filePath: '/inner.csv' }, position: { x: 0, y: 0 } },
            { id: 'inner_filter', type: 'beamflow:filter', settings: { field: 'age', operator: '>', value: '18' }, position: { x: 100, y: 0 } },
          ],
          connections: [
            { id: 'ie1', sourceNodeId: 'inner_src', sourcePortId: 'out', targetNodeId: 'inner_filter', targetPortId: 'in' },
          ],
        },
      });
      expect(subflowCreate.statusCode).toBe(201);
      const subflowId = subflowCreate.json().metadata.id;

      const created = await app.inject({
        method: 'POST',
        url: '/api/pipelines',
        headers: { Authorization: `Bearer ${token}` },
        payload: {},
      });
      const id = created.json().metadata.id;
      const parentWorkflow: SerializedWorkflow = {
        schemaVersion: '1.0.0',
        metadata: { id, name: 'Parent', description: '', createdAt: now, updatedAt: now },
        nodes: [
          // No upstream node feeds the proxy — it reads its own CSV Source internally.
          { id: 'proxy', type: 'system:subflow', settings: { subflowId }, position: { x: 0, y: 0 } },
          { id: 'out', type: 'beamflow:csv-output', settings: { filePath: '/out.csv' }, position: { x: 100, y: 0 } },
        ],
        connections: [
          { id: 'e1', sourceNodeId: 'proxy', sourcePortId: 'out', targetNodeId: 'out', targetPortId: 'in' },
        ],
      };
      await app.inject({
        method: 'PUT',
        url: `/api/pipelines/${id}`,
        headers: { Authorization: `Bearer ${token}` },
        payload: parentWorkflow,
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/pipelines/${id}/generate`,
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
    });

    it('returns 400 with a node-named error when the referenced subflow does not exist', async () => {
      const now = '2024-01-01T00:00:00.000Z';
      const created = await app.inject({
        method: 'POST',
        url: '/api/pipelines',
        headers: { Authorization: `Bearer ${token}` },
        payload: {},
      });
      const id = created.json().metadata.id;
      const workflow: SerializedWorkflow = {
        schemaVersion: '1.0.0',
        metadata: { id, name: 'Parent', description: '', createdAt: now, updatedAt: now },
        nodes: [
          { id: 'proxy', type: 'system:subflow', settings: { subflowId: 'sf_does_not_exist' }, position: { x: 0, y: 0 } },
        ],
        connections: [],
      };
      await app.inject({
        method: 'PUT',
        url: `/api/pipelines/${id}`,
        headers: { Authorization: `Bearer ${token}` },
        payload: workflow,
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/pipelines/${id}/generate`,
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().message || JSON.stringify(res.json())).toContain('no longer exists');
    });
  });

  describe('POST /api/pipelines/:id/execute', () => {
    it('executes (mocked) and caches the result for polling', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/api/pipelines',
        headers: { Authorization: `Bearer ${token}` },
        payload: {},
      });
      const id = created.json().metadata.id;
      const wf = sourceToSinkWorkflow(id);
      
      await app.inject({
        method: 'PUT',
        url: `/api/pipelines/${id}`,
        headers: { Authorization: `Bearer ${token}` },
        payload: wf,
      });

      const exec = await app.inject({
        method: 'POST',
        url: `/api/pipelines/${id}/execute`,
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(exec.statusCode).toBe(200);
      const result = exec.json();
      expect(result.status).toBe(ExecutionStatus.Completed);
      expect(result.id).toBe('exec_test');

      const polled = await app.inject({
        method: 'GET',
        url: `/api/pipelines/${id}/executions/exec_test`,
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(polled.statusCode).toBe(200);
      expect(polled.json().id).toBe('exec_test');
    });

    it('returns 404 for an unknown execution id', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/api/pipelines',
        headers: { Authorization: `Bearer ${token}` },
        payload: {},
      });
      const id = created.json().metadata.id;
      const res = await app.inject({
        method: 'GET',
        url: `/api/pipelines/${id}/executions/nope`,
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(404);
    });
  });
});
