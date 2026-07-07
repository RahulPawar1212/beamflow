import React, { useEffect, useState } from 'react';
import { X, RefreshCw, AlertCircle, Maximize2, Minimize2, Database } from 'lucide-react';
import { useWorkflowStore } from '../store/workflow-store.js';
import { api } from '../api/client.js';
import type { PreviewRowsResponse } from '@beamflow/shared';

export function PreviewPanel() {
  const isPreviewPanelOpen = useWorkflowStore((s) => s.isPreviewPanelOpen);
  const previewNodeId = useWorkflowStore((s) => s.previewNodeId);
  const pipelineId = useWorkflowStore((s) => s.pipelineId);
  const closePreviewPanel = useWorkflowStore((s) => s.closePreviewPanel);

  const [previewData, setPreviewData] = useState<PreviewRowsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [page, setPage] = useState(1);

  // Poll for preview data
  useEffect(() => {
    if (!isPreviewPanelOpen || !previewNodeId || !pipelineId) {
      return;
    }

    let intervalId: NodeJS.Timeout;
    let isMounted = true;

    const fetchPreview = async () => {
      try {
        const response = await api.getPreview(pipelineId, previewNodeId, page, 100);
        if (isMounted) {
          setPreviewData(response);
          setError(null);
          
          if (response.metadata.status !== 'running') {
            clearInterval(intervalId);
          }
        }
      } catch (err: any) {
        if (err.message.includes('No preview available')) {
          // If no preview available, trigger it once automatically
          if (isMounted && !previewData) {
            triggerPreview();
          }
        } else {
          if (isMounted) {
            setError(err.message || 'Failed to fetch preview data');
            clearInterval(intervalId);
          }
        }
      }
    };

    const triggerPreview = async () => {
      try {
        await api.triggerPreview(pipelineId, previewNodeId);
        // Start polling after trigger
        fetchPreview();
      } catch (err: any) {
        if (isMounted) {
          setError(err.message || 'Failed to trigger preview');
        }
      }
    };

    fetchPreview();
    intervalId = setInterval(fetchPreview, 2000);

    return () => {
      isMounted = false;
      clearInterval(intervalId);
    };
  }, [isPreviewPanelOpen, previewNodeId, pipelineId, page]);

  if (!isPreviewPanelOpen) {
    return null;
  }

  const status = previewData?.metadata?.status || 'loading';
  const rows = previewData?.rows || [];
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

  return (
    <div 
      className={`absolute bottom-0 left-0 right-0 glass border-t border-[var(--color-border)] flex flex-col z-40 transition-all duration-300 ease-in-out shadow-2xl
        ${isExpanded ? 'h-[75vh]' : 'h-80'}
      `}
    >
      {/* Header */}
      <div className="px-4 py-2 flex items-center justify-between border-b border-[var(--color-border)] bg-black/10">
        <div className="flex items-center gap-2">
          <Database size={16} className="text-indigo-400" />
          <span className="font-semibold text-sm text-gray-200">Data Preview</span>
          {previewNodeId && (
            <span className="text-xs text-gray-400 font-mono bg-black/20 px-2 py-0.5 rounded border border-white/5">
              {previewNodeId}
            </span>
          )}
          {status === 'running' && (
            <div className="flex items-center gap-1.5 ml-2 text-xs text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded-full border border-amber-400/20">
              <RefreshCw size={12} className="animate-spin" />
              <span>Generating...</span>
            </div>
          )}
          {status === 'stale' && (
            <div className="flex items-center gap-1.5 ml-2 text-xs text-blue-400 bg-blue-400/10 px-2 py-0.5 rounded-full border border-blue-400/20">
              <AlertCircle size={12} />
              <span>Stale (Upstream changed)</span>
              <button 
                onClick={() => api.triggerPreview(pipelineId!, previewNodeId!).then(() => setPreviewData(null))}
                className="ml-1 underline hover:text-blue-300"
              >
                Refresh
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 text-gray-400">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1.5 rounded hover:bg-white/10 hover:text-gray-200 transition-colors"
            title={isExpanded ? "Collapse" : "Expand"}
          >
            {isExpanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
          <button
            onClick={closePreviewPanel}
            className="p-1.5 rounded hover:bg-red-500/15 hover:text-red-400 transition-colors"
            title="Close Preview"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-auto bg-[var(--color-surface-0)]">
        {error ? (
          <div className="p-6 text-red-400 flex flex-col items-center justify-center h-full">
            <AlertCircle size={32} className="mb-2 opacity-50" />
            <p className="text-sm">{error}</p>
          </div>
        ) : status === 'failed' ? (
          <div className="p-6 text-red-400 flex flex-col items-center justify-center h-full">
            <AlertCircle size={32} className="mb-2 opacity-50" />
            <p className="text-sm font-semibold mb-2">Preview Generation Failed</p>
            <pre className="text-xs bg-[var(--color-surface-100)] p-4 rounded max-w-full overflow-x-auto text-red-300/80">
              {previewData?.metadata?.errorMessage || 'Unknown error'}
            </pre>
          </div>
        ) : status === 'running' && rows.length === 0 ? (
          <div className="p-6 flex flex-col items-center justify-center h-full text-gray-500">
            <RefreshCw size={24} className="animate-spin mb-3 text-indigo-500/50" />
            <p className="text-sm">Executing preview sub-graph...</p>
            <p className="text-xs opacity-70 mt-1">This may take a few moments depending on data size.</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="p-6 flex flex-col items-center justify-center h-full text-gray-500">
            <p className="text-sm">No data returned for this node.</p>
          </div>
        ) : (
          <div className="min-w-max">
            <table className="w-full text-sm text-left border-collapse">
              <thead className="text-xs text-gray-400 bg-[var(--color-surface-100)] sticky top-0 z-10 shadow-sm border-b border-[var(--color-border)]">
                <tr>
                  <th className="px-4 py-2 font-mono text-gray-500 border-r border-[var(--color-border)] bg-black/5 dark:bg-black/40 w-12 text-right">#</th>
                  {columns.map((col) => (
                    <th key={col} className="px-4 py-2 font-medium border-r border-[var(--color-border)] max-w-xs truncate" title={col}>
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)] text-gray-300 font-mono text-xs">
                {rows.map((row, idx) => (
                  <tr key={idx} className="hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
                    <td className="px-4 py-1.5 text-gray-500 border-r border-[var(--color-border)] bg-black/5 dark:bg-black/20 text-right">
                      {idx + 1 + (page - 1) * 100}
                    </td>
                    {columns.map((col) => (
                      <td key={col} className="px-4 py-1.5 border-r border-[var(--color-border)] max-w-xs truncate" title={String(row[col])}>
                        {row[col] !== null && row[col] !== undefined ? String(row[col]) : (
                          <span className="text-gray-600 italic">null</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Footer / Pagination */}
      {previewData && (status === 'ready' || status === 'stale') && previewData.totalPages > 1 && (
        <div className="px-4 py-2 flex items-center justify-between border-t border-[var(--color-border)] bg-[var(--color-surface-100)] text-xs text-gray-400">
          <div>
            Showing rows {(page - 1) * 100 + 1} to {Math.min(page * 100, (page - 1) * 100 + rows.length)}
          </div>
          <div className="flex items-center gap-4">
            <button
              disabled={page <= 1}
              onClick={() => setPage(p => p - 1)}
              className="hover:text-white disabled:opacity-50"
            >
              Previous
            </button>
            <span className="font-mono">
              Page {page} of {previewData.totalPages}
            </span>
            <button
              disabled={page >= previewData.totalPages}
              onClick={() => setPage(p => p + 1)}
              className="hover:text-white disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
