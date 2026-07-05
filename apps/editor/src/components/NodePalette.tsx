/**
 * Node Palette — sidebar with categorized, searchable, draggable node list.
 */

import React, { useState, useMemo } from 'react';
import { useReactFlow } from '@xyflow/react';
import {
  Search, FileText, ArrowRightLeft, Calculator, GitBranch,
  FileOutput, Brain, ChevronDown, ChevronRight, Plus, X,
  Sparkles, Pencil, Trash2,
  FileJson, Filter, Group, Database, Box,
} from 'lucide-react';
import { useWorkflowStore } from '../store/workflow-store';
import { isCustomType, type CustomNodeDef } from '../customNodes';
import { CustomNodeModal } from './CustomNodeModal';
import type { NodeDef } from '../api/client';

// Icon chip styling per category: gradient fill + ring + icon tint.
// Mirrors the on-canvas node colors so the palette and canvas read as one system.
const categoryChip: Record<string, string> = {
  source: 'bg-gradient-to-br from-emerald-500/25 to-emerald-500/5 ring-emerald-400/25 text-emerald-400',
  transform: 'bg-gradient-to-br from-indigo-500/25 to-indigo-500/5 ring-indigo-400/25 text-indigo-400',
  arithmetic: 'bg-gradient-to-br from-amber-500/25 to-amber-500/5 ring-amber-400/25 text-amber-400',
  logical: 'bg-gradient-to-br from-violet-500/25 to-violet-500/5 ring-violet-400/25 text-violet-400',
  output: 'bg-gradient-to-br from-orange-500/25 to-orange-500/5 ring-orange-400/25 text-orange-400',
  ml: 'bg-gradient-to-br from-pink-500/25 to-pink-500/5 ring-pink-400/25 text-pink-400',
  custom: 'bg-gradient-to-br from-cyan-500/25 to-cyan-500/5 ring-cyan-400/25 text-cyan-400',
};

// Flat icon tint for the (smaller, subtler) category header icons — a colored
// dot of identity, distinct from the filled chips used on node rows below.
const categoryIconColor: Record<string, string> = {
  source: 'text-emerald-400',
  transform: 'text-indigo-400',
  arithmetic: 'text-amber-400',
  logical: 'text-violet-400',
  output: 'text-orange-400',
  ml: 'text-pink-400',
  custom: 'text-cyan-400',
};

// Per-node icon lookup by the node's declared `icon` name, matching the
// canvas node icon set. Falls back to the category icon, then a generic box.
const nodeIconMap: Record<string, React.ElementType> = {
  'file-csv': FileText,
  'file-json': FileJson,
  'filter': Filter,
  'arrow-right-left': ArrowRightLeft,
  'group': Group,
  'file-output': FileOutput,
  'database': Database,
  'box': Box,
  'sparkles': Sparkles,
  'brain': Brain,
  'calculator': Calculator,
};

const categoryIcons: Record<string, React.ElementType> = {
  source: FileText,
  transform: ArrowRightLeft,
  arithmetic: Calculator,
  logical: GitBranch,
  output: FileOutput,
  ml: Brain,
  custom: Sparkles,
};

const categoryLabels: Record<string, string> = {
  source: 'Sources',
  transform: 'Transforms',
  arithmetic: 'Arithmetic',
  logical: 'Logical',
  output: 'Outputs',
  ml: 'ML / AI',
  custom: 'Custom',
};

const categoryOrder = ['custom', 'source', 'transform', 'arithmetic', 'logical', 'output', 'ml'];

export function NodePalette() {
  const nodeDefinitions = useWorkflowStore((s) => s.nodeDefinitions);
  const addNode = useWorkflowStore((s) => s.addNode);
  const customNodeDefs = useWorkflowStore((s) => s.customNodeDefs);
  const deleteCustomNode = useWorkflowStore((s) => s.deleteCustomNode);
  const addToast = useWorkflowStore((s) => s.addToast);
  const { screenToFlowPosition } = useReactFlow();
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  // null = closed; 'new' = create; otherwise the def being edited
  const [modal, setModal] = useState<CustomNodeDef | 'new' | null>(null);

  // Group and filter nodes
  const groupedNodes = useMemo(() => {
    const filtered = searchQuery.trim()
      ? nodeDefinitions.filter(
          (n) =>
            n.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            n.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
            n.tags?.some((t) => t.toLowerCase().includes(searchQuery.toLowerCase())),
        )
      : nodeDefinitions;

    const groups: Record<string, NodeDef[]> = {};
    for (const node of filtered) {
      if (!groups[node.category]) groups[node.category] = [];
      groups[node.category].push(node);
    }
    return groups;
  }, [nodeDefinitions, searchQuery]);

  const toggleCategory = (cat: string) => {
    setCollapsed((prev) => ({ ...prev, [cat]: !prev[cat] }));
  };

  const onDragStart = (event: React.DragEvent, nodeType: string) => {
    event.dataTransfer.setData('application/beamflow-node', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  };

  // Click-to-add: place near the viewport center, cascading each successive
  // node down-right so repeated adds don't stack on top of each other.
  const onAddNode = (nodeType: string) => {
    const count = useWorkflowStore.getState().nodes.length;
    const base = screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    // Cascade in a diagonal so nodes never land on top of each other,
    // wrapping every 5 nodes into a fresh column.
    const colGap = 300;
    const rowGap = 90;
    const col = Math.floor(count / 5);
    const row = count % 5;
    const pos = {
      x: base.x - 90 + col * colGap,
      y: base.y - 120 + row * rowGap,
    };
    addNode(nodeType, pos);
  };

  const totalMatches = Object.values(groupedNodes).reduce((n, arr) => n + arr.length, 0);

  // ─── Custom node export / import ───────────────────────────────────
  const importCustomNodes = useWorkflowStore((s) => s.importCustomNodes);

  const handleExportCustom = () => {
    if (customNodeDefs.length === 0) {
      addToast('info', 'No custom nodes to export');
      return;
    }
    const blob = new Blob([JSON.stringify(customNodeDefs, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'beamflow-custom-nodes.json';
    a.click();
    URL.revokeObjectURL(url);
    addToast('success', `Exported ${customNodeDefs.length} custom node(s)`);
  };

  const handleImportCustom = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const defs = JSON.parse(await file.text());
        const added = importCustomNodes(Array.isArray(defs) ? defs : [defs]);
        addToast('success', `Imported ${added} new custom node(s)`);
      } catch {
        addToast('error', 'Invalid custom-nodes file');
      }
    };
    input.click();
  };

  return (
    <div className="w-68 h-full glass flex flex-col animate-slide-left">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--color-border)]">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-gray-200">Nodes</h2>
          <button
            onClick={() => setModal('new')}
            title="Create a custom node"
            className="flex items-center gap-1 text-[11px] text-cyan-400 hover:text-cyan-300 px-1.5 py-0.5 rounded-md hover:bg-cyan-500/10 transition-colors"
          >
            <Plus size={12} /> New
          </button>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 bg-[var(--color-surface-200)] border border-[var(--color-border)] rounded-lg focus-within:border-indigo-500/50 transition-colors">
          <Search
            size={14}
            className="text-gray-400 flex-shrink-0"
          />
          <input
            type="text"
            placeholder="Search nodes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 bg-transparent text-sm text-gray-300 placeholder-gray-500 outline-none"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="text-gray-600 hover:text-gray-300 transition-colors flex-shrink-0 cursor-pointer"
            >
              <X size={13} />
            </button>
          )}
        </div>
        {searchQuery && (
          <div className="mt-1.5 text-[10px] text-gray-600">
            {totalMatches} {totalMatches === 1 ? 'match' : 'matches'}
          </div>
        )}
      </div>

      {/* Node list */}
      <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-2">
        {categoryOrder.map((cat) => {
          const nodes = groupedNodes[cat];
          if (!nodes || nodes.length === 0) return null;

          const CatIcon = categoryIcons[cat] || FileText;
          const isCollapsed = collapsed[cat];

          return (
            <div key={cat} className="animate-fade-in">
              {/* Category header */}
              <button
                onClick={() => toggleCategory(cat)}
                className="w-full flex items-center gap-2 px-1 py-1 rounded-md
                  text-gray-400 hover:text-gray-200 transition-colors group/cat"
              >
                <ChevronRight
                  size={12}
                  className={`text-gray-600 transition-transform duration-200 ${isCollapsed ? '' : 'rotate-90'}`}
                />
                <CatIcon size={12} className={categoryIconColor[cat] || 'text-gray-400'} />
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-gray-400">
                  {categoryLabels[cat] || cat}
                </span>
                <span className="ml-auto text-[10px] font-medium text-gray-500 bg-white/5 rounded-full px-1.5 py-0.5 min-w-[18px] text-center">
                  {nodes.length}
                </span>
              </button>

              {/* Nodes in category */}
              {!isCollapsed && (
                <div className="mt-1 flex flex-col gap-1">
                  {nodes.map((node) => {
                    const custom = isCustomType(node.type);
                    const def = custom
                      ? customNodeDefs.find((d) => d.id === node.type)
                      : undefined;
                    const NodeIcon =
                      nodeIconMap[node.icon] || categoryIcons[node.category] || Box;
                    return (
                      <div
                        key={node.type}
                        draggable
                        onDragStart={(e) => onDragStart(e, node.type)}
                        onDoubleClick={() => onAddNode(node.type)}
                        title={`${node.name} — ${node.description}`}
                        className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg
                          border border-transparent bg-[var(--color-surface-200)]/40
                          cursor-grab active:cursor-grabbing active:scale-[0.98]
                          hover:bg-[var(--color-surface-200)] hover:border-[var(--color-border-hover)] transition-all group"
                      >
                        <span
                          className={`flex-shrink-0 p-1.5 rounded-lg ring-1 ${categoryChip[node.category] || categoryChip.transform}`}
                        >
                          <NodeIcon size={15} />
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] font-medium text-gray-200 truncate leading-tight">
                            {node.name}
                          </div>
                          {node.description && (
                            <div className="text-[10.5px] text-gray-500 leading-snug mt-0.5 truncate">
                              {node.description}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-0.5 flex-shrink-0">
                          {custom && def && (
                            <>
                              <button
                                onClick={() => setModal(def)}
                                title="Edit custom node"
                                className="p-1 rounded-md text-gray-600 opacity-0
                                  group-hover:opacity-100 hover:text-cyan-400 hover:bg-white/10 transition-all"
                              >
                                <Pencil size={12} />
                              </button>
                              <button
                                onClick={() => {
                                  deleteCustomNode(def.id);
                                  addToast('info', `Deleted "${def.name}"`);
                                }}
                                title="Delete custom node"
                                className="p-1 rounded-md text-gray-600 opacity-0
                                  group-hover:opacity-100 hover:text-red-400 hover:bg-white/10 transition-all"
                              >
                                <Trash2 size={12} />
                              </button>
                            </>
                          )}
                          <button
                            onClick={() => onAddNode(node.type)}
                            title="Add to canvas"
                            className="p-1 rounded-md text-gray-500 opacity-0
                              group-hover:opacity-100 hover:text-indigo-400 hover:bg-indigo-500/15 transition-all"
                          >
                            <Plus size={14} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {Object.keys(groupedNodes).length === 0 && (
          <div className="text-center py-8 text-xs text-gray-600">
            {searchQuery
              ? 'No matching nodes'
              : nodeDefinitions.length === 0
                ? 'Loading nodes…'
                : 'No nodes available'}
          </div>
        )}
      </div>

      {/* Footer: custom-node sharing + hint */}
      <div className="px-3 py-2 border-t border-[var(--color-border)] flex flex-col gap-1.5">
        <div className="flex items-center gap-1">
          <button
            onClick={handleImportCustom}
            className="flex-1 text-[10px] text-gray-500 hover:text-gray-300 py-1 rounded hover:bg-white/5 transition-colors"
          >
            Import nodes
          </button>
          <button
            onClick={handleExportCustom}
            className="flex-1 text-[10px] text-gray-500 hover:text-gray-300 py-1 rounded hover:bg-white/5 transition-colors"
          >
            Export nodes
          </button>
        </div>
        <div className="text-[10px] text-gray-600 text-center">
          Drag or double-click to add
        </div>
      </div>

      {/* Custom node create/edit modal */}
      {modal && (
        <CustomNodeModal
          editing={modal === 'new' ? null : modal}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
