/**
 * Canvas — main React Flow canvas with drag-and-drop, minimap, controls.
 */

import React, { useCallback, useRef } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
} from '@xyflow/react';
import { MousePointerSquareDashed, ChevronRight, Home } from 'lucide-react';
import { useWorkflowStore, type NodeData } from '../store/workflow-store';
import { nodeTypes } from './nodes/CustomNodes';
import { api } from '../api/client';

export function Canvas() {
  const nodes = useWorkflowStore((s) => s.nodes);
  const edges = useWorkflowStore((s) => s.edges);
  const onNodesChange = useWorkflowStore((s) => s.onNodesChange);
  const onEdgesChange = useWorkflowStore((s) => s.onEdgesChange);
  const onConnect = useWorkflowStore((s) => s.onConnect);
  const addNode = useWorkflowStore((s) => s.addNode);
  const setSelectedNode = useWorkflowStore((s) => s.setSelectedNode);
  const removeSelectedNodes = useWorkflowStore((s) => s.removeSelectedNodes);
  const navigationStack = useWorkflowStore((s) => s.navigationStack);
  const enterSubflow = useWorkflowStore((s) => s.enterSubflow);
  const exitSubflow = useWorkflowStore((s) => s.exitSubflow);
  const addToast = useWorkflowStore((s) => s.addToast);
  const pipelineName = useWorkflowStore((s) => s.pipelineName);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reactFlowRef = useRef<any>(null);

  // ─── Drag & drop from palette ──────────────────────────────────

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      const nodeType = event.dataTransfer.getData('application/beamflow-node');
      if (!nodeType || !reactFlowRef.current) return;

      const position = reactFlowRef.current.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      addNode(nodeType, position);
    },
    [addNode],
  );

  // ─── Keyboard shortcuts ────────────────────────────────────────

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Delete' || event.key === 'Backspace') {
        removeSelectedNodes();
      }
    },
    [removeSelectedNodes],
  );

  // ─── Selection ─────────────────────────────────────────────────

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: { id: string }) => {
      setSelectedNode(node.id);
    },
    [setSelectedNode],
  );

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
  }, [setSelectedNode]);

  const onNodeDoubleClick = useCallback(async (_: React.MouseEvent, node: { id: string, data: any }) => {
    if (node.data.nodeType === 'system:subflow') {
      const subflowId = node.data.settings?.subflowId;
      if (!subflowId) {
        addToast('error', 'Subflow node is missing subflowId setting.');
        return;
      }
      try {
        const subflow = await api.getPipeline(subflowId);
        enterSubflow(subflow);
      } catch (err) {
        addToast('error', `Could not load subflow: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }, [enterSubflow, addToast]);

  const isEmpty = nodes.length === 0;

  return (
    <div className="flex-1 h-full relative" onKeyDown={onKeyDown} tabIndex={0}>
      {/* Breadcrumb Navigation Overlay */}
      {navigationStack.length > 0 && (
        <div className="absolute top-4 left-4 z-10 flex items-center gap-2 px-3 py-2 bg-[var(--color-surface-100)] border border-[var(--color-border)] rounded-lg shadow-sm">
          <button
            onClick={() => {
              // Go back to root: loop exitSubflow until stack is empty
              while(useWorkflowStore.getState().navigationStack.length > 0) {
                useWorkflowStore.getState().exitSubflow();
              }
            }}
            className="flex items-center text-sm font-medium text-gray-400 hover:text-white transition-colors"
          >
            <Home size={16} className="mr-1.5" />
            Root
          </button>
          
          {navigationStack.map((entry, idx) => (
            <React.Fragment key={idx}>
              <ChevronRight size={16} className="text-gray-600" />
              <button
                onClick={() => {
                  // Pop until we reach this level
                  const state = useWorkflowStore.getState();
                  const popCount = state.navigationStack.length - idx - 1;
                  for(let i=0; i < popCount; i++) state.exitSubflow();
                  // For the target level, exitSubflow will pop it into view
                  if (popCount >= 0) state.exitSubflow();
                }}
                className="text-sm font-medium text-gray-400 hover:text-white transition-colors"
              >
                {entry.pipelineName}
              </button>
            </React.Fragment>
          ))}
          
          <ChevronRight size={16} className="text-gray-600" />
          <span className="text-sm font-semibold text-cyan-400">{pipelineName}</span>
        </div>
      )}

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onInit={(instance) => {
          reactFlowRef.current = instance;
        }}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onPaneClick={onPaneClick}
        fitView
        fitViewOptions={{ maxZoom: 0.85, minZoom: 0.4, padding: 0.3 }}
        defaultViewport={{ x: 0, y: 0, zoom: 0.85 }}
        minZoom={0.2}
        maxZoom={1.5}
        snapToGrid
        snapGrid={[16, 16]}
        deleteKeyCode={['Delete', 'Backspace']}
        multiSelectionKeyCode="Shift"
        defaultEdgeOptions={{
          animated: true,
          style: { stroke: '#6366f1', strokeWidth: 2 },
        }}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="var(--grid-color)"
        />
        <Controls
          position="bottom-right"
          showInteractive={false}
        />
        <MiniMap
          position="bottom-right"
          style={{ marginBottom: 50 }}
          nodeColor={(node) => {
            const data = node.data as NodeData;
            const colors: Record<string, string> = {
              source: '#10b981',
              transform: '#6366f1',
              arithmetic: '#f59e0b',
              logical: '#8b5cf6',
              output: '#f97316',
              ml: '#ec4899',
            };
            return colors[data?.category] || '#6366f1';
          }}
          maskColor="var(--minimap-mask)"
          pannable
          zoomable
        />
      </ReactFlow>
    </div>
  );
}
