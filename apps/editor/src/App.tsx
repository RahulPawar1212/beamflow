import React, { useEffect } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { Toolbar } from './components/Toolbar.js';
import { NodePalette } from './components/NodePalette.js';
import { Canvas } from './components/Canvas.js';
import { PropertyPanel } from './components/PropertyPanel.js';
import { Toasts } from './components/Toasts.js';
import { GroupBar } from './components/GroupBar.js';
import { PreviewPanel } from './components/PreviewPanel.js';
import { useWorkflowStore } from './store/workflow-store.js';
import { useAuthStore } from './lib/auth-store.js';
import { LoginPage } from './components/LoginPage.js';
import { api } from './api/client.js';

export default function App() {
  const token = useAuthStore((s) => s.token);
  const setNodeDefinitions = useWorkflowStore((s) => s.setNodeDefinitions);
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId);
  const addToast = useWorkflowStore((s) => s.addToast);
  const initTheme = useWorkflowStore((s) => s.initTheme);
  const loadCustomNodeDefs = useWorkflowStore((s) => s.loadCustomNodeDefs);

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

  if (!token) {
    return <LoginPage />;
  }

  return (
    <ReactFlowProvider>
      <div className="w-full h-full flex flex-col">
        {/* Top toolbar */}
        <Toolbar />

        {/* Main content area */}
        <div className="flex-1 flex overflow-hidden relative">
          {/* Left: Node palette */}
          <NodePalette />

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
      </div>
    </ReactFlowProvider>
  );
}
