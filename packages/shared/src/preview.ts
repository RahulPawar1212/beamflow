/**
 * Preview Engine metadata and response definitions.
 */

export type PreviewStatus = 'running' | 'ready' | 'stale' | 'failed';

export interface PreviewMetadata {
  workflowId: string;
  nodeId: string;
  rowCount: number;
  sampledRows: number;
  createdAt: string; // ISO format date
  filePath: string;
  status: PreviewStatus;
  errorMessage?: string;
  // schema representation can be simple array of cols
  schema: { name: string; type: string }[];
}

export interface PreviewRowsResponse {
  metadata: PreviewMetadata;
  rows: Record<string, any>[];
  page: number;
  pageSize: number;
  totalPages: number;
}
