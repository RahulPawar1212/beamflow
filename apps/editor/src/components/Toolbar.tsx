/**
 * Toolbar — top bar with pipeline name, save, generate, execute, undo/redo.
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Save, Play, Code2, Undo2, Redo2, Download, Upload,
  Loader2, Zap, Copy, Check, X, CheckCircle2, XCircle, FileCode2,
  Sun, Moon, SunDim, LogOut, User, FolderOpen, Plus, Trash2, Clock
} from 'lucide-react';
import { useWorkflowStore } from '../store/workflow-store.js';
import { useAuthStore } from '../lib/auth-store.js';
import { api, type PipelineSummary } from '../api/client.js';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export function Toolbar() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  
  const pipelineName = useWorkflowStore((s) => s.pipelineName);
  const pipelineId = useWorkflowStore((s) => s.pipelineId);
  const setPipelineName = useWorkflowStore((s) => s.setPipelineName);
  const isGenerating = useWorkflowStore((s) => s.isGenerating);
  const isExecuting = useWorkflowStore((s) => s.isExecuting);
  const isSaving = useWorkflowStore((s) => s.isSaving);
  const isDirty = useWorkflowStore((s) => s.isDirty);
  const setGenerating = useWorkflowStore((s) => s.setGenerating);
  const setExecuting = useWorkflowStore((s) => s.setExecuting);
  const setSaving = useWorkflowStore((s) => s.setSaving);
  const setGeneratedArtifact = useWorkflowStore((s) => s.setGeneratedArtifact);
  const setExecutionLogs = useWorkflowStore((s) => s.setExecutionLogs);
  const setExecutionStatus = useWorkflowStore((s) => s.setExecutionStatus);
  const markSaved = useWorkflowStore((s) => s.markSaved);
  const addToast = useWorkflowStore((s) => s.addToast);
  const undo = useWorkflowStore((s) => s.undo);
  const redo = useWorkflowStore((s) => s.redo);
  const canUndo = useWorkflowStore((s) => s.canUndo);
  const canRedo = useWorkflowStore((s) => s.canRedo);
  const toWorkflow = useWorkflowStore((s) => s.toWorkflow);
  const loadWorkflow = useWorkflowStore((s) => s.loadWorkflow);
  const setPipelineId = useWorkflowStore((s) => s.setPipelineId);
  const nodeCount = useWorkflowStore((s) => s.nodes.length);
  const theme = useWorkflowStore((s) => s.theme);
  const toggleTheme = useWorkflowStore((s) => s.toggleTheme);
  const clearWorkflow = useWorkflowStore((s) => s.clearWorkflow);

  const [showCode, setShowCode] = useState(false);
  const [showSwitcher, setShowSwitcher] = useState(false);
  const saveWorkflow = useWorkflowStore((s) => s.saveWorkflow);

  // ─── Save ─────────────────────────────────────────────────────────

  const handleSave = async (silent = false): Promise<boolean> => {
    const ok = await saveWorkflow();
    if (ok && !silent) addToast('success', 'Pipeline saved');
    if (!ok && !silent) addToast('error', 'Failed to save pipeline');
    return ok;
  };

  // ─── Generate ─────────────────────────────────────────────────────

  const handleGenerate = async () => {
    if (nodeCount === 0) {
      addToast('info', 'Add at least one node before generating code');
      return;
    }
    if (!pipelineId || isDirty) {
      const ok = await handleSave(true);
      if (!ok) return;
    }
    const id = useWorkflowStore.getState().pipelineId;
    if (!id) return;

    setGenerating(true);
    try {
      await api.updatePipeline(id, toWorkflow());
      markSaved();
      const result = await api.generateCode(id);
      setGeneratedArtifact({
        code: result.code,
        filename: result.filename,
        language: result.language,
        requirements: result.requirements,
      });
      setShowCode(true);
    } catch (err) {
      addToast('error', `Generation failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      setGenerating(false);
    }
  };

  // ─── Execute ──────────────────────────────────────────────────────

  const handleExecute = async () => {
    if (nodeCount === 0) {
      addToast('info', 'Add at least one node before running');
      return;
    }
    if (!pipelineId || isDirty) {
      const ok = await handleSave(true);
      if (!ok) return;
    }
    const id = useWorkflowStore.getState().pipelineId;
    if (!id) return;

    const controller = new AbortController();
    useWorkflowStore.getState().setCancelExecution(() => controller.abort());

    setExecuting(true);
    setExecutionStatus('running');
    setExecutionLogs([]);
    try {
      await api.updatePipeline(id, toWorkflow());
      markSaved();
      const result = await api.executePipeline(id, { signal: controller.signal });
      const logs = [...result.logs, ...result.errors];
      setExecutionLogs(logs.length ? logs : ['Pipeline finished with no output.']);
      const ok = result.status === 'success' || result.exitCode === 0;
      setExecutionStatus(ok ? 'success' : 'error');
      addToast(ok ? 'success' : 'error', ok ? 'Pipeline ran successfully' : 'Pipeline finished with errors');
    } catch (err: any) {
      if (err.name === 'AbortError' || err.message === 'Aborted') {
        setExecutionLogs(['Pipeline execution cancelled by user.']);
        setExecutionStatus('error');
        addToast('info', 'Execution cancelled');
      } else {
        setExecutionLogs([`Execution failed: ${err instanceof Error ? err.message : err}`]);
        setExecutionStatus('error');
        addToast('error', 'Execution failed');
      }
    } finally {
      useWorkflowStore.getState().setCancelExecution(null);
      setExecuting(false);
    }
  };

  // ─── Export/Import ────────────────────────────────────────────────

  const handleExport = () => {
    if (nodeCount === 0) {
      addToast('info', 'Nothing to export yet');
      return;
    }
    const workflow = toWorkflow();
    const blob = new Blob([JSON.stringify(workflow, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${pipelineName.replace(/\s+/g, '_')}.beamflow.json`;
    a.click();
    URL.revokeObjectURL(url);
    addToast('success', 'Workflow exported');
  };

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.beamflow.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const text = await file.text();
      try {
        const workflow = JSON.parse(text);
        loadWorkflow(workflow);
        addToast('success', `Imported "${workflow.metadata?.name || file.name}"`);
      } catch {
        addToast('error', 'Invalid workflow file');
      }
    };
    input.click();
  };

  // ─── Keyboard shortcuts ───────────────────────────────────────────

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === 's') {
        e.preventDefault();
        handleSave();
      } else if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipelineId, pipelineName]);

  return (
    <>
      <div className="h-12 glass flex items-center px-5 gap-2 border-b border-[var(--color-border)] z-10">
        {/* Logo */}
        <div className="flex items-center gap-2 mr-3">
          <Zap size={18} className="text-indigo-400" />
          <span className="text-sm font-bold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
            BeamFlow
          </span>
        </div>

        {/* Pipeline name */}
        <div className="flex items-center gap-1.5 min-w-0">
          <input
            type="text"
            value={pipelineName}
            onChange={(e) => setPipelineName(e.target.value)}
            spellCheck={false}
            className="text-sm bg-transparent border border-transparent rounded-md px-1.5 py-0.5 outline-none text-gray-300
              hover:border-[var(--color-border)] focus:border-indigo-500/50 focus:text-white min-w-[160px] max-w-[280px] font-medium transition-colors"
          />
          {/* Dirty / saved indicator */}
          <SaveStatus isDirty={isDirty} isSaving={isSaving} />
        </div>

        <div className="flex-1" />

        {/* Action buttons */}
        <div className="flex items-center gap-1">
          {/* Workflows */}
          <ToolbarButton
            icon={FolderOpen}
            label="Workflows"
            hint="Switch or create workflows"
            onClick={() => setShowSwitcher(true)}
          />

          <div className="w-px h-5 bg-[var(--color-border)] mx-1" />

          {/* Undo/Redo */}
          <ToolbarButton
            icon={Undo2}
            label="Undo"
            hint="Ctrl+Z"
            onClick={undo}
            disabled={!canUndo()}
          />
          <ToolbarButton
            icon={Redo2}
            label="Redo"
            hint="Ctrl+Shift+Z"
            onClick={redo}
            disabled={!canRedo()}
          />

          <div className="w-px h-5 bg-[var(--color-border)] mx-1" />

          {/* Save */}
          <ToolbarButton
            icon={isSaving ? Loader2 : Save}
            label="Save"
            hint="Ctrl+S"
            onClick={() => handleSave()}
            disabled={isSaving}
            spinning={isSaving}
          />

          {/* Import/Export */}
          <ToolbarButton icon={Upload} label="Import" onClick={handleImport} />
          <ToolbarButton icon={Download} label="Export" onClick={handleExport} />

          <div className="w-px h-5 bg-[var(--color-border)] mx-1" />

          {/* Theme Switcher */}
          <ToolbarButton
            icon={theme === 'dark' ? Moon : theme === 'light' ? Sun : SunDim}
            label={theme === 'dark' ? 'Dark' : theme === 'light' ? 'Light' : 'Softer Light'}
            onClick={toggleTheme}
          />

          {/* User profile & Logout */}
          {user && (
            <>
              <div className="w-px h-5 bg-[var(--color-border)] mx-1" />
              <div className="flex items-center gap-2 pl-1 pr-1.5 py-0.5 rounded-lg border border-[var(--color-border)] bg-black/10">
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-500/25 text-indigo-300">
                  <User size={12} />
                </div>
                <span className="text-xs font-medium text-gray-300 max-w-[100px] truncate">
                  {user.name}
                </span>
                <button
                  onClick={logout}
                  title="Sign out"
                  className="text-gray-500 hover:text-red-400 p-1 rounded-md transition-colors"
                >
                  <LogOut size={12} />
                </button>
              </div>
            </>
          )}

          <div className="w-px h-5 bg-[var(--color-border)] mx-1" />

          {/* Generate */}
          <ToolbarButton
            icon={isGenerating ? Loader2 : Code2}
            label="Generate"
            onClick={handleGenerate}
            disabled={isGenerating}
            spinning={isGenerating}
            accent
          />

          {/* Execute */}
          {isExecuting ? (
            <ToolbarButton
              icon={X}
              label="Cancel Run"
              onClick={() => useWorkflowStore.getState().cancelExecution?.()}
              accent
              variant="danger"
            />
          ) : (
            <ToolbarButton
              icon={Play}
              label="Run"
              onClick={handleExecute}
              accent
              variant="success"
            />
          )}
        </div>
      </div>

      {/* Code Preview Modal */}
      {showCode && <CodeModal onClose={() => setShowCode(false)} />}

      {/* Workflow Switcher Modal */}
      {showSwitcher && (
        <WorkflowSwitcherModal
          onClose={() => setShowSwitcher(false)}
          onSelect={(id) => {
            setShowSwitcher(false);
            api.getPipeline(id).then((wf) => {
              loadWorkflow(wf);
            }).catch((err) => {
              addToast('error', `Failed to load workflow: ${err instanceof Error ? err.message : err}`);
            });
          }}
          onNew={() => {
            setShowSwitcher(false);
            clearWorkflow();
          }}
        />
      )}

      {/* Execution Logs Panel */}
      <ExecutionPanel />
    </>
  );
}

// ─── Save status indicator ──────────────────────────────────────────

function SaveStatus({ isDirty, isSaving }: { isDirty: boolean; isSaving: boolean }) {
  if (isSaving) {
    return (
      <span className="flex items-center gap-1 text-[10px] text-gray-500">
        <Loader2 size={10} className="animate-spin" />
      </span>
    );
  }
  if (isDirty) {
    return (
      <span title="Unsaved changes" className="flex items-center gap-1 text-[10px] text-amber-400/80">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
        <span className="hidden md:inline">Unsaved</span>
      </span>
    );
  }
  return (
    <span title="All changes saved" className="flex items-center gap-1 text-[10px] text-emerald-400/70">
      <CheckCircle2 size={11} />
      <span className="hidden md:inline">Saved</span>
    </span>
  );
}

// ─── Code Modal ─────────────────────────────────────────────────────

function CodeModal({ onClose }: { onClose: () => void }) {
  const artifact = useWorkflowStore((s) => s.generatedArtifact);
  const [copied, setCopied] = useState(false);

  if (!artifact) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(artifact.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  const handleDownload = () => {
    const blob = new Blob([artifact.code], { type: 'text/x-python' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = artifact.filename || 'pipeline.py';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        showCloseButton
        className="max-w-4xl sm:max-w-4xl p-0 gap-0 max-h-[82vh] flex flex-col overflow-hidden"
      >
        <DialogHeader className="px-4 py-3 border-b border-border pr-14">
          <DialogTitle className="flex items-center gap-2 min-w-0 text-sm">
            <FileCode2 size={16} className="text-indigo-400 flex-shrink-0" />
            <span className="truncate">
              {artifact.filename || 'Generated Python Beam Pipeline'}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground uppercase font-normal">
              {artifact.language || 'python'}
            </span>
            <span className="flex items-center gap-1 ml-auto">
              <Button variant="ghost" size="sm" onClick={handleCopy} className="text-muted-foreground">
                {copied ? <Check className="text-emerald-400" /> : <Copy />}
                {copied ? 'Copied' : 'Copy'}
              </Button>
              <Button variant="ghost" size="sm" onClick={handleDownload} className="text-muted-foreground">
                <Download />
                Download
              </Button>
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-auto p-4">
          <pre className="text-xs font-mono text-foreground/90 whitespace-pre leading-relaxed">
            {artifact.code}
          </pre>
        </div>

        {artifact.requirements && artifact.requirements.length > 0 && (
          <div className="px-4 py-2.5 border-t border-border">
            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
              Requirements
            </div>
            <div className="flex flex-wrap gap-1.5">
              {artifact.requirements.map((r) => (
                <span
                  key={r}
                  className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-muted border border-border text-muted-foreground"
                >
                  {r}
                </span>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Workflow Switcher Modal ────────────────────────────────────────

function WorkflowSwitcherModal({
  onClose,
  onSelect,
  onNew,
}: {
  onClose: () => void;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  const [pipelines, setPipelines] = useState<PipelineSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const currentId = useWorkflowStore((s) => s.pipelineId);
  const addToast = useWorkflowStore((s) => s.addToast);

  useEffect(() => {
    let mounted = true;
    api
      .listPipelines()
      .then((res) => {
        if (mounted) {
          setPipelines(res.pipelines);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to load workflows');
          setLoading(false);
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this workflow?')) return;
    try {
      await api.deletePipeline(id);
      setPipelines((prev) => prev.filter((p) => p.id !== id));
      addToast('success', 'Workflow deleted');
      if (currentId === id) {
        onNew();
      }
    } catch (err) {
      addToast('error', `Failed to delete: ${err instanceof Error ? err.message : err}`);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-[95vw] sm:max-w-3xl w-full p-0 gap-0 overflow-hidden bg-[var(--color-surface-100)] border-[var(--color-border)]">
        <DialogHeader className="px-5 py-4 pr-12 border-b border-[var(--color-border)] bg-[var(--color-surface-200)]">
          <DialogTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FolderOpen size={18} className="text-indigo-400" />
              <span className="text-gray-200 text-base">Saved Workflows</span>
            </div>
            <Button
              onClick={onNew}
              variant="default"
              size="sm"
              className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium shadow-sm h-8 px-3"
            >
              <Plus size={14} className="mr-1.5" />
              New Workflow
            </Button>
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto max-h-[75vh] p-4 bg-[var(--color-surface-100)]">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-gray-500 gap-2">
              <Loader2 size={16} className="animate-spin" />
              Loading workflows...
            </div>
          ) : error ? (
            <div className="text-center py-8 text-red-400 text-sm">
              <XCircle size={24} className="mx-auto mb-2 opacity-50" />
              {error}
            </div>
          ) : pipelines.length === 0 ? (
            <div className="text-center py-12">
              <FolderOpen size={32} className="mx-auto mb-3 text-gray-600" />
              <p className="text-sm font-medium text-gray-400">No saved workflows</p>
              <p className="text-xs text-gray-500 mt-1">Create a new workflow and save it to see it here.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {pipelines.map((p) => {
                const isCurrent = p.id === currentId;
                const date = new Date(p.updatedAt).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                });
                return (
                  <div
                    key={p.id}
                    onClick={() => !isCurrent && onSelect(p.id)}
                    className={`group relative px-4 py-3 rounded-lg border flex items-center justify-between transition-all cursor-pointer
                      ${isCurrent
                        ? 'border-indigo-500/50 bg-indigo-500/10 cursor-default'
                        : 'border-[var(--color-border)] bg-[var(--color-surface-200)]/40 hover:border-gray-500 hover:bg-[var(--color-surface-200)]'
                      }`}
                  >
                    <div className="flex items-center gap-4 min-w-0">
                      <div className="min-w-0">
                        <h4 className="text-sm font-bold text-gray-200 truncate pr-2">
                          {p.name}
                        </h4>
                      </div>
                      {isCurrent && (
                        <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 text-[10px] font-bold shrink-0">
                          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                          Active
                        </span>
                      )}
                    </div>
                    
                    <div className="flex items-center gap-6 text-[11px] text-gray-500 font-medium shrink-0">
                      <div className="flex items-center gap-1.5" title="Number of nodes">
                        <div className="flex gap-0.5 items-end h-3">
                          <div className="w-1 h-1.5 bg-gray-500/60 rounded-sm" />
                          <div className="w-1 h-2.5 bg-gray-500/60 rounded-sm" />
                          <div className="w-1 h-2 bg-gray-500/60 rounded-sm" />
                        </div>
                        {p.nodeCount} {p.nodeCount === 1 ? 'node' : 'nodes'}
                      </div>
                      <div className="flex items-center gap-1.5 min-w-[70px]" title="Last updated">
                        <Clock size={12} className="opacity-70" />
                        {date}
                      </div>
                      {!isCurrent ? (
                        <button
                          onClick={(e) => handleDelete(e, p.id)}
                          className="p-1.5 rounded-md text-gray-500 opacity-0 group-hover:opacity-100 hover:text-red-400 hover:bg-red-500/10 transition-all ml-2"
                          title="Delete workflow"
                        >
                          <Trash2 size={16} />
                        </button>
                      ) : (
                        <div className="w-[36px] ml-2" /> // spacer for alignment with trash icon
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Execution Panel ────────────────────────────────────────────────

function ExecutionPanel() {
  const logs = useWorkflowStore((s) => s.executionLogs);
  const status = useWorkflowStore((s) => s.executionStatus);
  const setExecutionLogs = useWorkflowStore((s) => s.setExecutionLogs);
  const setExecutionStatus = useWorkflowStore((s) => s.setExecutionStatus);
  const cancelExecution = useWorkflowStore((s) => s.cancelExecution);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new logs
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  if (status === 'idle' && logs.length === 0) return null;

  const statusMeta =
    status === 'running'
      ? { label: 'Running...', color: 'text-indigo-400', icon: Loader2, spin: true }
      : status === 'success'
        ? { label: 'Success', color: 'text-emerald-400', icon: CheckCircle2, spin: false }
        : status === 'error'
          ? { label: 'Failed', color: 'text-red-400', icon: XCircle, spin: false }
          : { label: 'Output', color: 'text-gray-400', icon: Play, spin: false };
  const StatusIcon = statusMeta.icon;

  return (
    <div className="absolute bottom-0 left-0 right-0 h-52 bg-[var(--color-surface-100)]/95 backdrop-blur border-t border-[var(--color-border)] flex flex-col z-20">
      <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2">
          <StatusIcon size={13} className={`${statusMeta.color} ${statusMeta.spin ? 'animate-spin' : ''}`} />
          <span className="text-xs font-semibold text-gray-300">Execution Output</span>
          <span className={`text-[10px] ${statusMeta.color}`}>{statusMeta.label}</span>
        </div>
        <button
          onClick={() => {
            setExecutionLogs([]);
            setExecutionStatus('idle');
          }}
          className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-gray-300 px-2 py-1 rounded hover:bg-white/5 transition-colors"
        >
          <X size={11} /> Close
        </button>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-auto px-4 py-2">
        {status === 'running' && logs.length === 0 ? (
          <div className="flex items-center gap-2 text-[11px] text-gray-500 font-mono">
            <Loader2 size={12} className="animate-spin" />
            Starting pipeline…
          </div>
        ) : (
          logs.map((line, i) => (
            <div
              key={i}
              className={`text-[11px] font-mono leading-5 whitespace-pre-wrap ${
                /error/i.test(line)
                  ? 'text-red-400'
                  : line.includes('[BeamFlow]')
                    ? 'text-indigo-400'
                    : 'text-gray-400'
              }`}
            >
              {line}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Toolbar Button ─────────────────────────────────────────────────

interface ToolbarButtonProps {
  icon: React.ElementType;
  label: string;
  hint?: string;
  onClick: () => void;
  disabled?: boolean;
  spinning?: boolean;
  accent?: boolean;
  variant?: 'default' | 'success' | 'danger';
}

function ToolbarButton({
  icon: Icon,
  label,
  hint,
  onClick,
  disabled,
  spinning,
  accent,
  variant = 'default',
}: ToolbarButtonProps) {
  const colors = accent
    ? variant === 'success'
      ? 'bg-gradient-to-b from-emerald-500 to-emerald-600 text-white shadow-sm shadow-emerald-500/25 hover:from-emerald-400 hover:to-emerald-500 hover:shadow-md hover:shadow-emerald-500/30 font-medium'
      : variant === 'danger'
        ? 'bg-gradient-to-b from-amber-500 to-amber-600 text-white shadow-sm shadow-amber-500/25 hover:from-amber-400 hover:to-amber-500 hover:shadow-md hover:shadow-amber-500/30 font-medium'
        : 'bg-gradient-to-b from-indigo-500 to-indigo-600 text-white shadow-sm shadow-indigo-500/25 hover:from-indigo-400 hover:to-indigo-500 hover:shadow-md hover:shadow-indigo-500/30 font-medium'
    : 'text-gray-500 hover:text-gray-300 hover:bg-[var(--color-surface-200)]';

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={hint ? `${label} (${hint})` : label}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs
        transition-all duration-150 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100
        ${colors}`}
    >
      <Icon size={14} className={spinning ? 'animate-spin' : ''} />
      <span className="hidden lg:inline">{label}</span>
    </button>
  );
}
