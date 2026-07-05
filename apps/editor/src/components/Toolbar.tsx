/**
 * Toolbar — top bar with pipeline name, save, generate, execute, undo/redo.
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Save, Play, Code2, Undo2, Redo2, Download, Upload,
  Loader2, Zap, Copy, Check, X, CheckCircle2, XCircle, FileCode2,
  Sun, Moon, SunDim,
} from 'lucide-react';
import { useWorkflowStore } from '../store/workflow-store';
import { api } from '../api/client';

export function Toolbar() {
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

  const [showCode, setShowCode] = useState(false);

  // ─── Save ─────────────────────────────────────────────────────────

  const handleSave = async (silent = false): Promise<boolean> => {
    setSaving(true);
    try {
      const workflow = toWorkflow();
      if (pipelineId) {
        await api.updatePipeline(pipelineId, workflow);
      } else {
        const created = await api.createPipeline({ name: pipelineName });
        setPipelineId(created.metadata.id);
        await api.updatePipeline(created.metadata.id, toWorkflow());
      }
      markSaved();
      if (!silent) addToast('success', 'Pipeline saved');
      return true;
    } catch (err) {
      addToast('error', `Save failed: ${err instanceof Error ? err.message : err}`);
      return false;
    } finally {
      setSaving(false);
    }
  };

  // ─── Generate ─────────────────────────────────────────────────────

  const handleGenerate = async () => {
    if (nodeCount === 0) {
      addToast('info', 'Add at least one node before generating code');
      return;
    }
    if (!pipelineId) {
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
    if (!pipelineId) {
      const ok = await handleSave(true);
      if (!ok) return;
    }
    const id = useWorkflowStore.getState().pipelineId;
    if (!id) return;

    setExecuting(true);
    setExecutionStatus('running');
    setExecutionLogs([]);
    try {
      await api.updatePipeline(id, toWorkflow());
      markSaved();
      const result = await api.executePipeline(id);
      const logs = [...result.logs, ...result.errors];
      setExecutionLogs(logs.length ? logs : ['Pipeline finished with no output.']);
      const ok = result.status === 'success' || result.exitCode === 0;
      setExecutionStatus(ok ? 'success' : 'error');
      addToast(ok ? 'success' : 'error', ok ? 'Pipeline ran successfully' : 'Pipeline finished with errors');
    } catch (err) {
      setExecutionLogs([`Execution failed: ${err instanceof Error ? err.message : err}`]);
      setExecutionStatus('error');
      addToast('error', 'Execution failed');
    } finally {
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
      <div className="h-12 glass flex items-center px-4 gap-2 border-b border-[var(--color-border)] z-10">
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
          <ToolbarButton
            icon={isExecuting ? Loader2 : Play}
            label="Run"
            onClick={handleExecute}
            disabled={isExecuting}
            spinning={isExecuting}
            accent
            variant="success"
          />
        </div>
      </div>

      {/* Code Preview Modal */}
      {showCode && <CodeModal onClose={() => setShowCode(false)} />}

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

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
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-8"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl max-h-[82vh] bg-[var(--color-surface-100)] rounded-xl border border-[var(--color-border)] flex flex-col animate-fade-in shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-2 min-w-0">
            <FileCode2 size={16} className="text-indigo-400 flex-shrink-0" />
            <span className="text-sm font-semibold text-gray-200 truncate">
              {artifact.filename || 'Generated Python Beam Pipeline'}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-gray-500 uppercase">
              {artifact.language || 'python'}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-colors"
            >
              {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              onClick={handleDownload}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-colors"
            >
              <Download size={13} />
              Download
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-white/10 transition-colors"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4">
          <pre className="text-xs font-mono text-gray-300 whitespace-pre leading-relaxed">
            {artifact.code}
          </pre>
        </div>

        {artifact.requirements && artifact.requirements.length > 0 && (
          <div className="px-4 py-2.5 border-t border-[var(--color-border)]">
            <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
              Requirements
            </div>
            <div className="flex flex-wrap gap-1.5">
              {artifact.requirements.map((r) => (
                <span
                  key={r}
                  className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-[var(--color-surface-200)] border border-[var(--color-border)] text-gray-400"
                >
                  {r}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Execution Panel ────────────────────────────────────────────────

function ExecutionPanel() {
  const logs = useWorkflowStore((s) => s.executionLogs);
  const status = useWorkflowStore((s) => s.executionStatus);
  const setExecutionLogs = useWorkflowStore((s) => s.setExecutionLogs);
  const setExecutionStatus = useWorkflowStore((s) => s.setExecutionStatus);
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
      ? { label: 'Running…', color: 'text-indigo-400', icon: Loader2, spin: true }
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
  variant?: 'default' | 'success';
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
      ? 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
      : 'bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20'
    : 'text-gray-500 hover:text-gray-300 hover:bg-[var(--color-surface-200)]';

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={hint ? `${label} (${hint})` : label}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs
        transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed
        ${colors}`}
    >
      <Icon size={14} className={spinning ? 'animate-spin' : ''} />
      <span className="hidden lg:inline">{label}</span>
    </button>
  );
}
