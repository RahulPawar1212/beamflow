/**
 * Custom React Flow node components.
 * Color-coded by category with handles, icons, and status indicators.
 */

import React, { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import {
  FileText, FileJson, Filter, ArrowRightLeft, Group, FileOutput,
  Database, Box, Sparkles,
} from 'lucide-react';
import type { NodeData } from '../../store/workflow-store';
import { useWorkflowStore } from '../../store/workflow-store';

// ─── Icon resolver ──────────────────────────────────────────────────

const iconMap: Record<string, React.ElementType> = {
  'file-csv': FileText,
  'file-json': FileJson,
  'filter': Filter,
  'arrow-right-left': ArrowRightLeft,
  'group': Group,
  'file-output': FileOutput,
  'database': Database,
  'box': Box,
  'sparkles': Sparkles,
};

function getIcon(iconName: string) {
  return iconMap[iconName] || Box;
}

// ─── Category colors ───────────────────────────────────────────────

const categoryColors: Record<
  string,
  { bg: string; border: string; accent: string; glow: string; bar: string; chip: string }
> = {
  source: {
    bg: 'bg-emerald-950/40 light:bg-emerald-100/70',
    border: 'border-emerald-500/30 light:border-emerald-300',
    accent: 'text-emerald-400 light:text-emerald-700',
    glow: 'shadow-emerald-500/10 light:shadow-emerald-500/5',
    bar: 'from-emerald-400 to-emerald-600',
    chip: 'from-emerald-500/25 to-emerald-500/5 ring-emerald-400/20',
  },
  transform: {
    bg: 'bg-indigo-950/40 light:bg-indigo-100/70',
    border: 'border-indigo-500/30 light:border-indigo-300',
    accent: 'text-indigo-400 light:text-indigo-700',
    glow: 'shadow-indigo-500/10 light:shadow-indigo-500/5',
    bar: 'from-indigo-400 to-indigo-600',
    chip: 'from-indigo-500/25 to-indigo-500/5 ring-indigo-400/20',
  },
  arithmetic: {
    bg: 'bg-amber-950/40 light:bg-amber-100/70',
    border: 'border-amber-500/30 light:border-amber-300',
    accent: 'text-amber-400 light:text-amber-700',
    glow: 'shadow-amber-500/10 light:shadow-amber-500/5',
    bar: 'from-amber-400 to-amber-600',
    chip: 'from-amber-500/25 to-amber-500/5 ring-amber-400/20',
  },
  logical: {
    bg: 'bg-violet-950/40 light:bg-violet-100/70',
    border: 'border-violet-500/30 light:border-violet-300',
    accent: 'text-violet-400 light:text-violet-700',
    glow: 'shadow-violet-500/10 light:shadow-violet-500/5',
    bar: 'from-violet-400 to-violet-600',
    chip: 'from-violet-500/25 to-violet-500/5 ring-violet-400/20',
  },
  output: {
    bg: 'bg-orange-950/40 light:bg-orange-100/70',
    border: 'border-orange-500/30 light:border-orange-300',
    accent: 'text-orange-400 light:text-orange-700',
    glow: 'shadow-orange-500/10 light:shadow-orange-500/5',
    bar: 'from-orange-400 to-orange-600',
    chip: 'from-orange-500/25 to-orange-500/5 ring-orange-400/20',
  },
  ml: {
    bg: 'bg-pink-950/40 light:bg-pink-100/70',
    border: 'border-pink-500/30 light:border-pink-300',
    accent: 'text-pink-400 light:text-pink-700',
    glow: 'shadow-pink-500/10 light:shadow-pink-500/5',
    bar: 'from-pink-400 to-pink-600',
    chip: 'from-pink-500/25 to-pink-500/5 ring-pink-400/20',
  },
  custom: {
    bg: 'bg-cyan-950/40 light:bg-cyan-100/70',
    border: 'border-cyan-500/30 light:border-cyan-300',
    accent: 'text-cyan-400 light:text-cyan-700',
    glow: 'shadow-cyan-500/10 light:shadow-cyan-500/5',
    bar: 'from-cyan-400 to-cyan-600',
    chip: 'from-cyan-500/25 to-cyan-500/5 ring-cyan-400/20',
  },
};

function getColors(category: string) {
  return categoryColors[category] || categoryColors.transform;
}

// ─── Base Node Component ────────────────────────────────────────────

function BaseNode({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as NodeData;
  const colors = getColors(nodeData.category);
  const Icon = getIcon(nodeData.icon);
  const setSelected = useWorkflowStore((s: { setSelectedNode: (id: string | null) => void }) => s.setSelectedNode);
  const defs = useWorkflowStore((s: { nodeDefinitions: { type: string; ports: Array<{ direction: string }> }[] }) => s.nodeDefinitions);
  const def = defs.find((d: { type: string }) => d.type === nodeData.nodeType);

  const hasInputs = def?.ports.some((p: { direction: string }) => p.direction === 'input') ?? false;
  const hasOutputs = def?.ports.some((p: { direction: string }) => p.direction === 'output') ?? false;

  return (
    <div
      className={`
        group/node relative min-w-[188px] overflow-hidden rounded-xl border backdrop-blur-sm
        transition-all duration-200 cursor-pointer
        ${colors.bg} ${colors.border}
        ${
          selected
            ? `ring-2 ring-offset-2 ring-offset-[var(--color-surface-50)] ring-indigo-400 shadow-xl ${colors.glow} -translate-y-0.5`
            : 'shadow-sm hover:shadow-lg hover:-translate-y-0.5'
        }
      `}
      onClick={() => setSelected(id)}
    >
      {/* Category accent bar */}
      <div className={`h-1 w-full bg-gradient-to-r ${colors.bar}`} />

      {/* Input handle */}
      {hasInputs && (
        <Handle
          type="target"
          position={Position.Left}
          id="in"
          className="!w-3 !h-3 !border-2 !bg-slate-300 !border-slate-500 transition-transform hover:!scale-125"
        />
      )}

      {/* Node content */}
      <div className="px-3 py-2.5">
        <div className="flex items-center gap-2.5">
          <div
            className={`flex-shrink-0 p-1.5 rounded-lg bg-gradient-to-br ring-1 ${colors.chip} ${colors.accent}`}
          >
            <Icon size={16} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-gray-200 truncate">
              {nodeData.label}
            </div>
            <div className="text-[10px] text-gray-500 capitalize tracking-wide">
              {nodeData.category}
            </div>
          </div>
        </div>
      </div>

      {/* Output handle */}
      {hasOutputs && (
        <Handle
          type="source"
          position={Position.Right}
          id="out"
          className="!w-3 !h-3 !border-2 !bg-slate-300 !border-slate-500 transition-transform hover:!scale-125"
        />
      )}
    </div>
  );
}

// ─── Category-specific wrappers (memoized) ─────────────────────────

export const SourceNode = memo(BaseNode);
export const TransformNode = memo(BaseNode);
export const ArithmeticNode = memo(BaseNode);
export const LogicalNode = memo(BaseNode);
export const OutputNode = memo(BaseNode);
export const MLNode = memo(BaseNode);
export const CustomNode = memo(BaseNode);

/** Map of node type → React component for React Flow registration */
export const nodeTypes = {
  source: SourceNode,
  transform: TransformNode,
  arithmetic: ArithmeticNode,
  logical: LogicalNode,
  output: OutputNode,
  ml: MLNode,
  custom: CustomNode,
};
