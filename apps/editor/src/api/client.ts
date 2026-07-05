/**
 * API client for the BeamFlow backend.
 *
 * Response types are derived from `@beamflow/shared` (the same domain types the
 * server uses) rather than hand-written duplicates, so client/server drift is
 * caught by the compiler. The `api` object's method names/signatures are stable
 * — call sites import the type aliases exported at the bottom of this file.
 */


/**
 * Base URL for API calls. Defaults to the relative `/api` (proxied to the
 * server by Vite in dev); override with `VITE_API_BASE` for a prod build that
 * talks to an absolute server URL.
 */
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';

async function request<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (options?.body) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { ...headers, ...options?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
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

  // Pipelines
  listPipelines: () => request<{ pipelines: PipelineSummary[] }>('/pipelines'),
  getPipeline: (id: string) => request<SerializedWorkflowDTO>(`/pipelines/${seg(id)}`),
  createPipeline: (data: { name?: string; description?: string }) =>
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

  // Generation & Execution
  generateCode: (id: string) =>
    request<GeneratedCodeDTO>(`/pipelines/${seg(id)}/generate`, { method: 'POST' }),
  executePipeline: (id: string) =>
    request<ExecutionResultDTO>(`/pipelines/${seg(id)}/execute`, { method: 'POST' }),
  getExecution: (pipelineId: string, execId: string) =>
    request<ExecutionResultDTO>(`/pipelines/${seg(pipelineId)}/executions/${seg(execId)}`),

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

/** Summary row from `GET /api/pipelines`. */
export interface PipelineSummary {
  id: string;
  name: string;
  description?: string;
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
    createdAt: string;
    updatedAt: string;
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
