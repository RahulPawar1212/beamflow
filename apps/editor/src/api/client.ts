/**
 * API client for the BeamFlow backend.
 *
 * server uses) rather than hand-written duplicates, so client/server drift is
 * caught by the compiler. The `api` object's method names/signatures are stable
 * — call sites import the type aliases exported at the bottom of this file.
 */

import type { PreviewRowsResponse } from '@beamflow/shared';
import { trace } from '../lib/trace';

/**
 * Base URL for API calls. Defaults to the relative `/api` (proxied to the
 * server by Vite in dev); override with `VITE_API_BASE` for a prod build that
 * talks to an absolute server URL.
 */
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';

/**
 * Thrown on a 409 from a version-guarded save: a teammate saved the pipeline
 * after we loaded it. Carries the server's authoritative current state so the
 * UI can show what changed and offer to reload.
 */
export class ConflictError extends Error {
  readonly currentVersion: number | null;
  readonly current: SerializedWorkflowDTO | null;
  constructor(message: string, currentVersion: number | null, current: SerializedWorkflowDTO | null) {
    super(message);
    this.name = 'ConflictError';
    this.currentVersion = currentVersion;
    this.current = current;
  }
}

async function request<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (options?.body) {
    headers['Content-Type'] = 'application/json';
  }
  
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('bf_token') : null;
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const method = options?.method ?? 'GET';
  const traceToken = trace.api(method, path, options?.body ? { hasBody: true } : undefined);

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { ...headers, ...options?.headers },
  });
  trace.apiDone(method, path, res.status, traceToken);

  if (!res.ok) {
    if (res.status === 401) {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem('bf_token');
        localStorage.removeItem('bf_user');
      }
      // Simple and robust way to force re-render/re-login across the app:
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('bf-unauthorized'));
      }
    }
    const body = await res.json().catch(() => ({}));
    if (res.status === 409) {
      const b = body as { error?: string; currentVersion?: number | null; current?: SerializedWorkflowDTO | null };
      throw new ConflictError(
        b.error || 'This pipeline was changed by someone else.',
        b.currentVersion ?? null,
        b.current ?? null,
      );
    }
    throw new Error((body as Record<string, string>).error || `Request failed: ${res.status}`);
  }
  
  if (res.status === 204) return undefined as T;
  return res.json();
}

/** Encode a path segment (id / type) so special characters are URL-safe. */
const seg = (v: string) => encodeURIComponent(v);

export const api = {
  // Nodes
  getNodes: () => request<{ nodes: NodeDef[] }>('/nodes'),
  getNode: (type: string) => request<NodeDef>(`/nodes/${seg(type)}`),
  compileSubgraph: (body: { nodes: CompileNode[]; connections: CompileConnection[] }) =>
    request<{ steps: CompiledStep[] }>('/compile-subgraph', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  generateFlow: (prompt: string) =>
    request<{ nodes: any[]; edges: any[] }>('/ai/generate', {
      method: 'POST',
      body: JSON.stringify({ prompt }),
    }),

  // Auth
  register: (data: { email?: string; password?: string; name?: string }) =>
    request<{ token: string; user: { id: string; email: string; name: string } }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  login: (data: { email?: string; password?: string }) =>
    request<{ token: string; user: { id: string; email: string; name: string } }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  me: () => request<{ user: { id: string; email: string; name: string } }>('/auth/me'),
  getProfile: () => request<{ id: string; email: string; name: string; geminiApiKey: string | null; createdAt: string }>('/users/me'),
  updateProfile: (data: { name?: string; geminiApiKey?: string }) =>
    request<{ success: boolean }>('/users/me', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  // Projects
  listProjects: () => request<{ projects: ProjectDTO[] }>('/projects'),
  createProject: (data: { name: string; description?: string }) =>
    request<ProjectDTO>('/projects', { method: 'POST', body: JSON.stringify(data) }),
  updateProject: (id: string, data: { name?: string; description?: string }) =>
    request<ProjectDTO>(`/projects/${seg(id)}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteProject: (id: string) =>
    request<void>(`/projects/${seg(id)}`, { method: 'DELETE' }),

  // Pipelines
  listPipelines: (projectId?: string, includeSubflows?: boolean) => {
    const params = new URLSearchParams();
    if (projectId) params.set('projectId', projectId);
    if (includeSubflows) params.set('includeSubflows', 'true');
    const query = params.toString() ? `?${params.toString()}` : '';
    return request<{ pipelines: PipelineSummary[] }>(`/pipelines${query}`);
  },
  /** The user-global subflow library (all projects), each with usedByCount. */
  listSubflows: () =>
    request<{ pipelines: PipelineSummary[] }>('/pipelines?subflowsOnly=true'),
  /** How many workflows reference a given subflow (for the delete guard). */
  getReferences: (id: string) =>
    request<{ count: number; names: string[] }>(`/pipelines/${seg(id)}/references`),
  getPipeline: (id: string) => request<SerializedWorkflowDTO>(`/pipelines/${seg(id)}`, { cache: 'no-store' }),
  createPipeline: (data: { name?: string; description?: string; isSubflow?: boolean; parameters?: any[]; projectId?: string; nodes?: any[]; connections?: any[] }) =>
    request<SerializedWorkflowDTO>('/pipelines', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updatePipeline: (id: string, data: SerializedWorkflowDTO) =>
    request<SerializedWorkflowDTO>(`/pipelines/${seg(id)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  deletePipeline: (id: string) =>
    request<void>(`/pipelines/${seg(id)}`, { method: 'DELETE' }),

  // Variables
  getVariables: (pipelineId: string) =>
    request<{ variables: Array<{ id: string; name: string; value: string; isSecret: boolean; environment: string }> }>(
      `/pipelines/${seg(pipelineId)}/variables`
    ),
  saveVariables: (pipelineId: string, variables: Array<{ id: string; name: string; value: string; isSecret: boolean; environment: string }>) =>
    request<void>(`/pipelines/${seg(pipelineId)}/variables`, {
      method: 'PUT',
      body: JSON.stringify({ variables }),
    }),

  // Preview
  triggerPreview: (pipelineId: string, nodeId: string) =>
    request<{ message: string }>(`/pipelines/${seg(pipelineId)}/nodes/${seg(nodeId)}/preview`, {
      method: 'POST',
    }),
  /**
   * Build the preview target id for a node that lives *inside* an expanded subflow.
   * The server's `expandSubflows` re-ids internal nodes as `sub_<subflowInstanceId>_<origId>`
   * (and nests for deeper subflows). Passing this id to `triggerPreview`/`getPreview` targets
   * the internal node. `subflowInstanceIds` is the chain of proxy node ids from the outermost
   * parent inward; `internalNodeId` is the node's original id within the innermost subflow.
   *
   * NOTE: the canvas does not yet support selecting internal subflow nodes, so nothing calls
   * this today. It exists so a future "drill into subflow" feature can preview internal nodes
   * without re-deriving the server's prefixing scheme. Keep in sync with `expandSubflows`.
   */
  internalPreviewId: (subflowInstanceIds: string[], internalNodeId: string) =>
    subflowInstanceIds.map((id) => `sub_${id}_`).join('') + internalNodeId,
  cancelPreview: (pipelineId: string, nodeId: string) =>
    request<void>(`/pipelines/${seg(pipelineId)}/nodes/${seg(nodeId)}/preview`, {
      method: 'DELETE',
    }),
  getPreview: (pipelineId: string, nodeId: string, page?: number, pageSize?: number) => {
    const params = new URLSearchParams();
    if (page) params.set('page', page.toString());
    if (pageSize) params.set('pageSize', pageSize.toString());
    const query = params.toString() ? `?${params.toString()}` : '';
    return request<PreviewRowsResponse>(`/pipelines/${seg(pipelineId)}/nodes/${seg(nodeId)}/preview${query}`);
  },
  setVariable: (
    pipelineId: string,
    data: { name: string; value: string; environment?: string; isSecret?: boolean }
  ) =>
    request<{ status: string }>(`/pipelines/${seg(pipelineId)}/variables`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  deleteVariable: (pipelineId: string, name: string, environment = 'default') =>
    request<void>(`/pipelines/${seg(pipelineId)}/variables/${seg(name)}?environment=${seg(environment)}`, {
      method: 'DELETE',
    }),

  // Versions
  getVersions: (pipelineId: string) =>
    request<{ versions: Array<{ id: string; version: number; createdAt: string; label: string | null }> }>(
      `/pipelines/${seg(pipelineId)}/versions`
    ),
  getVersionSnapshot: (pipelineId: string, versionId: string) =>
    request<{ snapshot: SerializedWorkflowDTO }>(`/pipelines/${seg(pipelineId)}/versions/${seg(versionId)}`),
  createVersionSnapshot: (pipelineId: string, data: { label?: string }) =>
    request<{ id: string; version: number; createdAt: string; label: string | null }>(
      `/pipelines/${seg(pipelineId)}/versions`,
      {
        method: 'POST',
        body: JSON.stringify(data),
      }
    ),

  // Generation & Execution
  generateCode: (id: string) =>
    request<GeneratedCodeDTO>(`/pipelines/${seg(id)}/generate`, { method: 'POST' }),
  executePipeline: (id: string, options?: RequestInit) =>
    request<ExecutionResultDTO>(`/pipelines/${seg(id)}/execute`, { method: 'POST', ...options }),
  getExecution: (pipelineId: string, execId: string) =>
    request<ExecutionResultDTO>(`/pipelines/${seg(pipelineId)}/executions/${seg(execId)}`),
  previewCsv: (filePath: string, delimiter = ',') =>
    request<{ headers: string[]; sampleRows: string[][] }>('/pipelines/preview-csv', {
      method: 'POST',
      body: JSON.stringify({ filePath, delimiter }),
    }),
  previewSql: (connectionString: string, sqlQuery: string) =>
    request<{ columns: Array<{ name: string; type: string }> }>('/pipelines/preview-sql', {
      method: 'POST',
      body: JSON.stringify({ connectionString, sqlQuery }),
    }),
  uploadFile: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    // request() helper sets Content-Type to application/json if we don't override it,
    // but fetch automatically sets the correct multipart boundary if we omit Content-Type.
    // However, our request() helper sets headers to {} and doesn't explicitly force JSON unless body is a string.
    // Let's rely on standard fetch inside our request helper or bypass it if needed.
    const token = localStorage.getItem('bf_token');
    const res = await fetch(`${API_BASE}/pipelines/upload`, {
      method: 'POST',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || err.message || `HTTP ${res.status}`);
    }
    return res.json() as Promise<{ path: string }>;
  },
  testConnection: (connectionString: string) =>
    request<{ success: boolean; message?: string; error?: string }>('/pipelines/test-connection', {
      method: 'POST',
      body: JSON.stringify({ connectionString }),
    }),

  // Health
  health: () => request<HealthDTO>('/health'),
};

// ─── DTO Types (derived from @beamflow/shared) ──────────────────────────────

/**
 * A port as serialized in a node definition response. Field names/shape mirror
 * the shared `IPort`; `direction`/`dataType` are widened to `string` because
 * the editor also builds `NodeDef`s locally (custom nodes) with plain strings —
 * the shared enums are string-valued, so the values are interchangeable.
 */
export interface NodePortDef {
  id: string;
  name: string;
  direction: string;
  dataType: string;
  required: boolean;
  multiple?: boolean;
}

/** A setting as serialized in a node definition response. */
export interface NodeSettingDef {
  key: string;
  label: string;
  description?: string;
  type: string;
  defaultValue?: unknown;
  options?: Array<{ label: string; value: string }>;
  validation?: Array<{ type: string; message: string; value?: unknown; pattern?: string }>;
  fixed?: boolean;
  placeholder?: string;
  group?: string;
  order?: number;
  dependsOn?: { key: string; value: unknown };
}

/**
 * A node definition as served by `GET /api/nodes` — the presentational subset
 * of the server's `INodeDefinition` (the server omits `validate`/`toIR`, which
 * are functions and don't serialize). Shapes mirror `@beamflow/shared` with
 * `string` widening on enum fields so both server responses and locally-built
 * custom-node defs satisfy it.
 */
export interface NodeDef {
  type: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  version: string;
  tags?: string[];
  ports: NodePortDef[];
  settings: NodeSettingDef[];
  /** Present on the single-node endpoint (`GET /api/nodes/:type`). */
  documentation?: string;
}

/**
 * One compiled IR step returned by `POST /api/compile-subgraph`.
 * (Loosely typed — the server renames IR `type` → `stepType` and the editor
 * only reads these fields to bake a composite custom node.)
 */
export interface CompiledStep {
  operation: string;
  stepType: string;
  params: Record<string, unknown>;
  imports?: string[];
  label?: string;
  inputRefs?: number[];
}

/** Node instance payload accepted by `compileSubgraph` (editor's loose shape). */
export interface CompileNode {
  id: string;
  type: string;
  settings: Record<string, unknown>;
  position: { x: number; y: number };
  label?: string;
  /** Pre-compiled IR carried by user-authored custom nodes. */
  inlineIR?: unknown;
}

/** Connection payload accepted by `compileSubgraph`. */
export interface CompileConnection {
  id: string;
  sourceNodeId: string;
  sourcePortId: string;
  targetNodeId: string;
  targetPortId: string;
}

/** A project row from `GET /api/projects`. */
export interface ProjectDTO {
  id: string;
  name: string;
  description?: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

/** Summary row from `GET /api/pipelines`. */
export interface PipelineSummary {
  id: string;
  name: string;
  description?: string;
  isSubflow?: boolean;
  projectId?: string;
  /** For subflows listed via subflowsOnly: how many workflows reference it. */
  usedByCount?: number;
  createdAt: string;
  updatedAt: string;
  nodeCount: number;
  connectionCount: number;
}

/**
 * A full serialized workflow as exchanged with the pipeline endpoints. Mirrors
 * the shared `SerializedWorkflow` but keeps the editor's looser field types
 * (string node types, `unknown` inlineIR) so the store's models flow through
 * without enum-casting.
 */
export interface SerializedWorkflowDTO {
  schemaVersion: string;
  metadata: {
    id: string;
    name: string;
    description?: string;
    isSubflow?: boolean;
    projectId?: string;
    orgId?: string;
    /** Optimistic-concurrency token: the version this document was loaded at. */
    version?: number;
    createdAt: string;
    updatedAt: string;
    parameters?: any[];
  };
  nodes: CompileNode[];
  connections: CompileConnection[];
}

/** Generated code payload from `POST /api/pipelines/:id/generate`. */
export interface GeneratedCodeDTO {
  code: string;
  filename: string;
  language: string;
  requirements: string[];
}

/**
 * Execution result from `POST /api/pipelines/:id/execute`. Mirrors the shared
 * `ExecutionResult` but keeps `status` as `string` (the UI compares it loosely
 * against runtime states), avoiding a coupling to the `ExecutionStatus` enum.
 */
export interface ExecutionResultDTO {
  id: string;
  status: string;
  startedAt?: string;
  completedAt?: string;
  logs: string[];
  errors: string[];
  exitCode?: number;
}

/** Health payload from `GET /api/health`. */
export interface HealthDTO {
  status: string;
  version: string;
  nodeTypes: number;
  plugins?: string[];
}
