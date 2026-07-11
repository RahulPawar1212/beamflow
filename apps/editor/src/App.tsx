import React, { useEffect } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { Toolbar } from './components/Toolbar.js';
import { NodePalette } from './components/NodePalette.js';
import { Canvas } from './components/Canvas.js';
import { PropertyPanel } from './components/PropertyPanel.js';
import { AIPanel } from './components/AIPanel.js';
import { Toasts } from './components/Toasts.js';
import { GroupBar } from './components/GroupBar.js';
import { PreviewPanel } from './components/PreviewPanel.js';
import { useWorkflowStore } from './store/workflow-store';
import { useAuthStore } from './lib/auth-store.js';
import { LoginPage } from './components/LoginPage.js';
import { SettingsModal } from './components/SettingsModal.js';
import { api } from './api/client';
import { useSchemaStore } from './lib/schema-store';
import { installSchemaSync } from './lib/schema-sync.js';
import { installAutoSave } from './lib/auto-save.js';
import { TooltipProvider } from './components/ui/tooltip.js';

// Install the central schema-propagation subscriber once, from this leaf module
// (both stores are fully initialized here). Schema recomputes whenever
// {nodes, edges, subflowCache} changes — no store action triggers it.
// See lib/schema-sync.ts and docs/debugging.md.
installSchemaSync(
  useWorkflowStore as unknown as Parameters<typeof installSchemaSync>[0],
  (nodes, edges) => useSchemaStore.getState().syncFromWorkflow(nodes, edges),
);

// Debounced auto-save: persist ~2s after edits stop, and flush on tab close.
// Same leaf-module install pattern as schema-sync (no store import cycle).
installAutoSave(useWorkflowStore as unknown as Parameters<typeof installAutoSave>[0]);

export default function App() {
  const token = useAuthStore((s) => s.token);
  const setNodeDefinitions = useWorkflowStore((s) => s.setNodeDefinitions);
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId);
  const addToast = useWorkflowStore((s) => s.addToast);
  const initTheme = useWorkflowStore((s) => s.initTheme);
  const loadCustomNodeDefs = useWorkflowStore((s) => s.loadCustomNodeDefs);
  const isAIPanelOpen = useWorkflowStore((s) => s.isAIPanelOpen);
  const isSettingsModalOpen = useWorkflowStore((s) => s.isSettingsModalOpen);
  const setSettingsModalOpen = useWorkflowStore((s) => s.setSettingsModalOpen);
  const currentProjectId = useWorkflowStore((s) => s.currentProjectId);
  const setCurrentProject = useWorkflowStore((s) => s.setCurrentProject);

  // Initialize theme on mount
  useEffect(() => {
    initTheme();
  }, [initTheme]);

  // Load user-authored custom nodes from localStorage on mount
  useEffect(() => {
    loadCustomNodeDefs();
  }, [loadCustomNodeDefs]);

  // Load node definitions from API on mount when token is present
  useEffect(() => {
    if (!token) return;
    let attempts = 0;
    async function loadNodes() {
      try {
        const { nodes } = await api.getNodes();
        setNodeDefinitions(nodes);
      } catch (err) {
        attempts += 1;
        console.error('Failed to load node definitions:', err);
        if (attempts === 3) {
          addToast('error', 'Cannot reach the server. Retrying…');
        }
        // Retry after 2 seconds (server may still be starting)
        setTimeout(loadNodes, 2000);
      }
    }
    loadNodes();
  }, [token, setNodeDefinitions, addToast]);

  // Ensure an active project on startup. The server guarantees at least a
  // "Default Project" per user (startup backfill), so the first entry is a safe
  // default; the user can switch via the toolbar's project chip.
  useEffect(() => {
    if (!token || currentProjectId) return;
    api.listProjects()
      .then(({ projects }) => {
        if (projects.length > 0) {
          setCurrentProject(projects[0].id, projects[0].name);
        }
      })
      .catch((err) => console.error('Failed to load projects:', err));
  }, [token, currentProjectId, setCurrentProject]);

  if (!token) {
    return <LoginPage />;
  }

  return (
    <TooltipProvider>
    <ReactFlowProvider>
      <div className="w-full h-full flex flex-col">
        {/* Top toolbar */}
        <Toolbar />

        {/* Main content area */}
        <div className="flex-1 flex overflow-hidden relative">
          {/* Left: Node palette */}
          <NodePalette />

          <AIPanel />

          {/* Expand AI Panel button (visible when panel is hidden) */}
          {!isAIPanelOpen && (
            <button
              onClick={() => useWorkflowStore.getState().openAIPanel()}
              className="absolute left-[272px] top-1/2 -translate-y-1/2 z-20 flex items-center justify-center w-6 h-16 bg-[var(--color-surface-100)] rounded-r-lg shadow-md border border-l-0 border-[var(--color-border)] hover:bg-[var(--color-surface-200)] transition-colors group cursor-pointer"
              title="Open AI Flow Maker"
            >
              <div className="w-1 h-8 rounded-full bg-indigo-500/50 group-hover:bg-indigo-400 transition-colors" />
            </button>
          )}

          {/* Center: Canvas */}
          <div className="flex-1 relative flex">
            <Canvas />
            <GroupBar />
            <PreviewPanel />
          </div>

          {/* Right: Property panel (conditional) */}
          {selectedNodeId && <PropertyPanel />}
        </div>

        {/* Transient notifications */}
        <Toasts />
        
        <SettingsModal 
          isOpen={isSettingsModalOpen} 
          onClose={() => setSettingsModalOpen(false)} 
        />
      </div>
    </ReactFlowProvider>
    </TooltipProvider>
  );
}
