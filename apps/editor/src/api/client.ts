/**
 * API client for the BeamFlow backend.
 */

const API_BASE = '/api';

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

export const api = {
  // Nodes
  getNodes: () => request<{ nodes: NodeDef[] }>('/nodes'),
  getNode: (type: string) => request<NodeDef>(`/nodes/${encodeURIComponent(type)}`),
  compileSubgraph: (body: {
    nodes: Array<{ id: string; type: string; settings: Record<string, unknown>; position: { x: number; y: number }; label?: string; inlineIR?: unknown }>;
    connections: Array<{ id: string; sourceNodeId: string; sourcePortId: string; targetNodeId: string; targetPortId: string }>;
  }) =>
    request<{ steps: CompiledStep[] }>('/compile-subgraph', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // Pipelines
  listPipelines: () => request<{ pipelines: PipelineSummary[] }>('/pipelines'),
  getPipeline: (id: string) => request<SerializedWorkflowDTO>(`/pipelines/${id}`),
  createPipeline: (data: { name?: string; description?: string }) =>
    request<SerializedWorkflowDTO>('/pipelines', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updatePipeline: (id: string, data: SerializedWorkflowDTO) =>
    request<SerializedWorkflowDTO>(`/pipelines/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  deletePipeline: (id: string) =>
    request<void>(`/pipelines/${id}`, { method: 'DELETE' }),

  // Generation & Execution
  generateCode: (id: string) =>
    request<GeneratedCodeDTO>(`/pipelines/${id}/generate`, { method: 'POST' }),
  executePipeline: (id: string) =>
    request<ExecutionResultDTO>(`/pipelines/${id}/execute`, { method: 'POST' }),
  getExecution: (pipelineId: string, execId: string) =>
    request<ExecutionResultDTO>(`/pipelines/${pipelineId}/executions/${execId}`),

  // Health
  health: () => request<{ status: string; version: string; nodeTypes: number }>('/health'),
};

// ─── DTO Types ────────────────────────────────────────────────────────────────

export interface NodeDef {
  type: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  version: string;
  tags: string[];
  ports: Array<{
    id: string;
    name: string;
    direction: string;
    dataType: string;
    required: boolean;
    multiple?: boolean;
  }>;
  settings: Array<{
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
  }>;
}

export interface CompiledStep {
  operation: string;
  stepType: string;
  params: Record<string, unknown>;
  imports?: string[];
  label?: string;
  inputRefs?: number[];
}

export interface PipelineSummary {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  nodeCount: number;
  connectionCount: number;
}

export interface SerializedWorkflowDTO {
  schemaVersion: string;
  metadata: {
    id: string;
    name: string;
    description?: string;
    createdAt: string;
    updatedAt: string;
  };
  nodes: Array<{
    id: string;
    type: string;
    settings: Record<string, unknown>;
    position: { x: number; y: number };
    label?: string;
    /** Pre-compiled IR carried by user-authored custom nodes. */
    inlineIR?: unknown;
  }>;
  connections: Array<{
    id: string;
    sourceNodeId: string;
    sourcePortId: string;
    targetNodeId: string;
    targetPortId: string;
  }>;
}

export interface GeneratedCodeDTO {
  code: string;
  filename: string;
  language: string;
  requirements: string[];
}

export interface ExecutionResultDTO {
  id: string;
  status: string;
  startedAt: string;
  completedAt?: string;
  logs: string[];
  errors: string[];
  exitCode?: number;
}
