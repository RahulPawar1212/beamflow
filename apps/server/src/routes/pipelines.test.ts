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

    it('PUT cannot flip isSubflow — identity is locked at creation, ignoring the request body', async () => {
      // A plain workflow (isSubflow defaults to false).
      const created = await app.inject({
        method: 'POST',
        url: '/api/pipelines',
        headers: { Authorization: `Bearer ${token}` },
        payload: { name: 'Plain Workflow' },
      });
      const id = created.json().metadata.id;
      expect(created.json().metadata.isSubflow).toBe(false);

      // A buggy/stale client sends isSubflow: true on an ordinary save (e.g. the
      // editor navigated through a subflow and its in-memory identity leaked).
      const workflow = created.json() as SerializedWorkflow;
      const updated = await app.inject({
        method: 'PUT',
        url: `/api/pipelines/${id}`,
        headers: { Authorization: `Bearer ${token}` },
        payload: { ...workflow, metadata: { ...workflow.metadata, isSubflow: true } },
      });
      expect(updated.statusCode).toBe(200);
      expect(updated.json().metadata.isSubflow).toBe(false);

      // Persisted record is unaffected too, not just the response body.
      const got = await app.inject({
        method: 'GET',
        url: `/api/pipelines/${id}`,
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(got.json().metadata.isSubflow).toBe(false);
    });

    it('POST rejects isSubflow: true when the graph has no subflow boundary nodes (drifted-client guard)', async () => {
      // The exact corruption seen in the field: a client whose in-memory
      // isSubflow drifted to true duplicates an ordinary workflow. Creation is
      // the only write where identity is taken from the request, so this is
      // where a workflow-shaped "subflow" must be refused — otherwise the
      // update lock makes the bogus identity permanent.
      const res = await app.inject({
        method: 'POST',
        url: '/api/pipelines',
        headers: { Authorization: `Bearer ${token}` },
        payload: {
          name: 'SQL data filter (Copy)',
          isSubflow: true,
          nodes: [
            { id: 'src', type: 'beamflow:csv-source', settings: {}, position: { x: 0, y: 0 } },
            { id: 'proxy', type: 'system:subflow', settings: { subflowId: 'sf_1' }, position: { x: 100, y: 0 } },
            { id: 'flt', type: 'beamflow:filter', settings: {}, position: { x: 200, y: 0 } },
            { id: 'out', type: 'beamflow:csv-output', settings: {}, position: { x: 300, y: 0 } },
          ],
          connections: [],
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().message || JSON.stringify(res.json())).toContain('subflow');
    });

    it('POST accepts a genuine subflow (has boundary nodes) and an ordinary workflow', async () => {
      const subflow = await app.inject({
        method: 'POST',
        url: '/api/pipelines',
        headers: { Authorization: `Bearer ${token}` },
        payload: {
          name: 'Genuine Subflow',
          isSubflow: true,
          nodes: [
            { id: 'flt', type: 'beamflow:filter', settings: {}, position: { x: 0, y: 0 } },
            { id: 'out', type: 'system:subflow-output', settings: { outputName: 'Output 1' }, position: { x: 100, y: 0 } },
          ],
        },
      });
      expect(subflow.statusCode).toBe(201);
      expect(subflow.json().metadata.isSubflow).toBe(true);

      // A workflow containing a subflow PROXY is still a workflow — the guard
      // must not misread proxies as boundary nodes.
      const workflow = await app.inject({
        method: 'POST',
        url: '/api/pipelines',
        headers: { Authorization: `Bearer ${token}` },
        payload: {
          name: 'Parent With Proxy',
          nodes: [
            { id: 'proxy', type: 'system:subflow', settings: { subflowId: 'sf_1' }, position: { x: 0, y: 0 } },
          ],
        },
      });
      expect(workflow.statusCode).toBe(201);
      expect(workflow.json().metadata.isSubflow).toBe(false);
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
      // Creation always carries a boundary node (the create guard requires it,
      // matching the editor which auto-adds one when grouping). The boundary-less
      // self-contained shape arises AFTERWARDS by the user deleting the output
      // node — identity is preserved through the update.
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
            { id: 'inner_out', type: 'system:subflow-output', settings: { outputName: 'Output 1' }, position: { x: 200, y: 0 } },
          ],
          connections: [
            { id: 'ie1', sourceNodeId: 'inner_src', sourcePortId: 'out', targetNodeId: 'inner_filter', targetPortId: 'in' },
            { id: 'ie2', sourceNodeId: 'inner_filter', sourcePortId: 'out', targetNodeId: 'inner_out', targetPortId: 'in' },
          ],
        },
      });
      expect(subflowCreate.statusCode).toBe(201);
      const subflowId = subflowCreate.json().metadata.id;

      // User deletes the boundary output node while editing the subflow — the
      // output becomes derived (terminal node) and identity must survive.
      const subflowDoc = subflowCreate.json() as SerializedWorkflow;
      const boundaryless = {
        ...subflowDoc,
        nodes: subflowDoc.nodes.filter((n) => n.id !== 'inner_out'),
        connections: subflowDoc.connections.filter((c) => c.id !== 'ie2'),
      };
      const subflowUpdate = await app.inject({
        method: 'PUT',
        url: `/api/pipelines/${subflowId}`,
        headers: { Authorization: `Bearer ${token}` },
        payload: boundaryless,
      });
      expect(subflowUpdate.statusCode).toBe(200);
      expect(subflowUpdate.json().metadata.isSubflow).toBe(true);

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

// The suite above uses MemoryStorage, which overwrites wholesale and so never
// exercises workflowsRepo.update — the real production path, and the actual
// choke point that must reject an isSubflow flip (a route-level guard alone
// isn't enough if a future call site writes through the repo directly).
// These tests use the default DrizzleStorage (in-memory SQLite in test env)
// to prove the guarantee holds all the way down.
describe('workflowsRepo identity guarantee (real DrizzleStorage)', () => {
  let app: FastifyInstance;
  let token: string;

  beforeEach(async () => {
    ({ app } = await buildApp({}));
    await app.ready();

    const email = `repo_id_${Math.random().toString(36).substring(2, 8)}@example.com`;
    const userReg = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email, password: 'password123', name: 'Repo Identity' },
    });
    token = userReg.json().token;
  });

  afterEach(async () => {
    await app.close();
  });

  it('a PUT with isSubflow: true cannot flip a real (DB-persisted) workflow into a subflow', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/pipelines',
      headers: { Authorization: `Bearer ${token}` },
      payload: { name: 'Real Plain Workflow' },
    });
    const id = created.json().metadata.id;
    expect(created.json().metadata.isSubflow).toBe(false);

    const workflow = created.json() as SerializedWorkflow;
    await app.inject({
      method: 'PUT',
      url: `/api/pipelines/${id}`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { ...workflow, metadata: { ...workflow.metadata, isSubflow: true } },
    });

    const got = await app.inject({
      method: 'GET',
      url: `/api/pipelines/${id}`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(got.json().metadata.isSubflow).toBe(false);

    // It also must not show up in the subflow-only listing.
    const subflows = await app.inject({
      method: 'GET',
      url: '/api/pipelines?subflowsOnly=true',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(subflows.json().pipelines.map((p: any) => p.id)).not.toContain(id);
  });

  it('a stale-version PUT is rejected 409 and does NOT overwrite the newer state', async () => {
    // Create at version 1.
    const created = await app.inject({
      method: 'POST',
      url: '/api/pipelines',
      headers: { Authorization: `Bearer ${token}` },
      payload: { name: 'Concurrent' },
    });
    const id = created.json().metadata.id;
    const base = created.json() as SerializedWorkflow;
    expect(base.metadata.version).toBe(1);

    // First save (from the loaded version 1) succeeds and bumps to 2.
    const firstSave = await app.inject({
      method: 'PUT',
      url: `/api/pipelines/${id}`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { ...base, metadata: { ...base.metadata, name: 'Saved by first editor' } },
    });
    expect(firstSave.statusCode).toBe(200);
    expect(firstSave.json().metadata.version).toBe(2);

    // Second editor still holds version 1 and tries to save — must be blocked.
    const staleSave = await app.inject({
      method: 'PUT',
      url: `/api/pipelines/${id}`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { ...base, metadata: { ...base.metadata, name: 'Saved by STALE editor', version: 1 } },
    });
    expect(staleSave.statusCode).toBe(409);
    expect(staleSave.json().currentVersion).toBe(2);

    // The stale save must NOT have overwritten the first editor's work.
    const got = await app.inject({
      method: 'GET',
      url: `/api/pipelines/${id}`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(got.json().metadata.name).toBe('Saved by first editor');
    expect(got.json().metadata.version).toBe(2);
  });

  it('a successful PUT writes a version-history snapshot', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/pipelines',
      headers: { Authorization: `Bearer ${token}` },
      payload: { name: 'Snapshotted' },
    });
    const id = created.json().metadata.id;
    const base = created.json() as SerializedWorkflow;

    await app.inject({
      method: 'PUT',
      url: `/api/pipelines/${id}`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { ...base, metadata: { ...base.metadata, name: 'Rev A' } },
    });
    await app.inject({
      method: 'PUT',
      url: `/api/pipelines/${id}`,
      headers: { Authorization: `Bearer ${token}` },
      // Re-read the now-current version before the second save.
      payload: await (async () => {
        const cur = await app.inject({
          method: 'GET', url: `/api/pipelines/${id}`, headers: { Authorization: `Bearer ${token}` },
        });
        const c = cur.json() as SerializedWorkflow;
        return { ...c, metadata: { ...c.metadata, name: 'Rev B' } };
      })(),
    });

    const versions = await app.inject({
      method: 'GET',
      url: `/api/pipelines/${id}/versions`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(versions.statusCode).toBe(200);
    // Two successful saves → two snapshots.
    expect(versions.json().versions.length).toBe(2);
  });

  it('a real subflow stays a subflow across repeated saves, even if the client sends isSubflow: false', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/pipelines',
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        name: 'Real Subflow',
        isSubflow: true,
        nodes: [
          { id: 'out', type: 'system:subflow-output', settings: { outputName: 'Output 1' }, position: { x: 0, y: 0 } },
        ],
      },
    });
    const id = created.json().metadata.id;
    expect(created.json().metadata.isSubflow).toBe(true);

    const workflow = created.json() as SerializedWorkflow;
    await app.inject({
      method: 'PUT',
      url: `/api/pipelines/${id}`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { ...workflow, metadata: { ...workflow.metadata, isSubflow: false } },
    });

    const got = await app.inject({
      method: 'GET',
      url: `/api/pipelines/${id}`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(got.json().metadata.isSubflow).toBe(true);
  });
});

// Org-scoped access: members of the same organization share its workflows and
// projects. Uses real DrizzleStorage so the default-org backfill + membership
// auto-join run for real. Two users registered against the same app instance
// land in the one Default Organization.
describe('org-scoped shared access (real DrizzleStorage)', () => {
  let app: FastifyInstance;
  let tokenA: string;
  let tokenB: string;

  beforeEach(async () => {
    ({ app } = await buildApp({}));
    await app.ready();

    const reg = async (tag: string) => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          email: `org_${tag}_${Math.random().toString(36).substring(2, 8)}@example.com`,
          password: 'password123',
          name: `User ${tag}`,
        },
      });
      return res.json().token as string;
    };
    tokenA = await reg('a');
    tokenB = await reg('b');
  });

  afterEach(async () => {
    await app.close();
  });

  it('user B sees a workflow user A created in their shared org', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/pipelines',
      headers: { Authorization: `Bearer ${tokenA}` },
      payload: { name: "A's Workflow" },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().metadata.id;

    // B can GET it directly...
    const gotByB = await app.inject({
      method: 'GET',
      url: `/api/pipelines/${id}`,
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    expect(gotByB.statusCode).toBe(200);
    expect(gotByB.json().metadata.name).toBe("A's Workflow");

    // ...and it shows up in B's list (both users share the org).
    const listByB = await app.inject({
      method: 'GET',
      url: '/api/pipelines',
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    expect(listByB.json().pipelines.map((p: any) => p.id)).toContain(id);
  });

  it('user B can edit and delete a workflow user A created (shared, not owner-gated)', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/pipelines',
      headers: { Authorization: `Bearer ${tokenA}` },
      payload: { name: 'Shared' },
    });
    const id = created.json().metadata.id;
    const workflow = created.json() as SerializedWorkflow;

    const edited = await app.inject({
      method: 'PUT',
      url: `/api/pipelines/${id}`,
      headers: { Authorization: `Bearer ${tokenB}` },
      payload: { ...workflow, metadata: { ...workflow.metadata, name: 'Edited by B' } },
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().metadata.name).toBe('Edited by B');

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/pipelines/${id}`,
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    expect(del.statusCode).toBe(204);
  });

  it('projects are shared across the org too', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { Authorization: `Bearer ${tokenA}` },
      payload: { name: 'Shared Project' },
    });
    expect(created.statusCode).toBe(201);
    const projectId = created.json().id;

    const listByB = await app.inject({
      method: 'GET',
      url: '/api/projects',
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    expect(listByB.json().projects.map((p: any) => p.id)).toContain(projectId);
  });

  it('a token with no orgId is rejected (401) — stale pre-org session', async () => {
    // Mint a token missing orgId, exactly like a session from before the org model.
    const staleToken = (app as any).jwt.sign({ id: 'usr_stale', email: 's@x.com', name: 'Stale' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/pipelines',
      headers: { Authorization: `Bearer ${staleToken}` },
    });
    expect(res.statusCode).toBe(401);
  });
});
