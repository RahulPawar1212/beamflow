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
import { MousePointerSquareDashed } from 'lucide-react';
import { useWorkflowStore, type NodeData } from '../store/workflow-store';
import { nodeTypes } from './nodes/CustomNodes';

export function Canvas() {
  const nodes = useWorkflowStore((s) => s.nodes);
  const edges = useWorkflowStore((s) => s.edges);
  const onNodesChange = useWorkflowStore((s) => s.onNodesChange);
  const onEdgesChange = useWorkflowStore((s) => s.onEdgesChange);
  const onConnect = useWorkflowStore((s) => s.onConnect);
  const addNode = useWorkflowStore((s) => s.addNode);
  const setSelectedNode = useWorkflowStore((s) => s.setSelectedNode);
  const removeSelectedNodes = useWorkflowStore((s) => s.removeSelectedNodes);

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

  const isEmpty = nodes.length === 0;

  return (
    <div className="flex-1 h-full relative" onKeyDown={onKeyDown} tabIndex={0}>
      {/* Empty state — guides first-time users */}
      {isEmpty && (
        <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
          <div className="flex flex-col items-center text-center max-w-sm px-6 animate-fade-in">
            <div className="p-4 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 mb-4">
              <MousePointerSquareDashed size={28} className="text-indigo-400" />
            </div>
            <h3 className="text-base font-semibold text-gray-200 mb-1.5">
              Start building your pipeline
            </h3>
            <p className="text-xs text-gray-500 leading-relaxed mb-4">
              Drag a node from the left palette onto the canvas — or click one to
              add it. Connect nodes by dragging from an output handle to an input.
            </p>
            <div className="flex flex-col gap-1.5 text-[11px] text-gray-600">
              <span>1 · Add a <span className="text-emerald-400">Source</span> node</span>
              <span>2 · Chain <span className="text-indigo-400">Transforms</span></span>
              <span>3 · End with an <span className="text-orange-400">Output</span></span>
            </div>
          </div>
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
