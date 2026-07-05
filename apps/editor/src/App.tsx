/**
 * Main App component — assembles toolbar, palette, canvas, and property panel.
 */

import React, { useEffect } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { Toolbar } from './components/Toolbar';
import { NodePalette } from './components/NodePalette';
import { Canvas } from './components/Canvas';
import { PropertyPanel } from './components/PropertyPanel';
import { Toasts } from './components/Toasts';
import { GroupBar } from './components/GroupBar';
import { useWorkflowStore } from './store/workflow-store';
import { api } from './api/client';

export default function App() {
  const setNodeDefinitions = useWorkflowStore((s) => s.setNodeDefinitions);
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId);
  const addToast = useWorkflowStore((s) => s.addToast);
  const loadCustomNodeDefs = useWorkflowStore((s) => s.loadCustomNodeDefs);

  // Load user-authored custom nodes from localStorage on mount
  useEffect(() => {
    loadCustomNodeDefs();
  }, [loadCustomNodeDefs]);

  // Load node definitions from API on mount
  useEffect(() => {
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
  }, [setNodeDefinitions, addToast]);

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
