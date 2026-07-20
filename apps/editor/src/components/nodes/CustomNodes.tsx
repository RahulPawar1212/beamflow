/**
 * Custom React Flow node components.
 * Color-coded by category with handles, icons, and status indicators.
 */

import React, { memo, useEffect } from 'react';
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
import {
  FileText, FileJson, Filter, ArrowRightLeft, Group, FileOutput,
  Database, Box, Sparkles, AlertTriangle, AlertCircle,
} from 'lucide-react';
import type { NodeData } from '../../store/workflow-store';
import { useWorkflowStore } from '../../store/workflow-store';
import { useNodeIssues } from '../../lib/schema-store';
import { effectiveSubflowParameters } from '../../lib/subflow-params';
import type { NodeDef, NodeSettingDef } from '../../api/client';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '../ui/tooltip';

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

// ─── Node issue badge ───────────────────────────────────────────────
// Generic — driven by whatever design-time issues the schema store has
// recorded for this node (schema-store.ts's useNodeIssues). Not specific to
// any node type; a subflow proxy is simply the first real user of it today
// (e.g. a dangling external input, or a mirrored output-boundary error).

function NodeIssueBadge({ nodeId }: { nodeId: string }) {
  const issues = useNodeIssues(nodeId);
  if (issues.length === 0) return null;

  const hasError = issues.some((i) => i.severity === 'error');
  const Icon = hasError ? AlertCircle : AlertTriangle;
  const colorClass = hasError ? 'text-red-400' : 'text-amber-400';

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={`absolute top-2 right-2 z-10 ${colorClass}`}
          onClick={(e) => e.stopPropagation()}
        >
          <Icon size={16} />
        </div>
      </TooltipTrigger>
      <TooltipContent side="top">
        <div className="flex flex-col gap-1 max-w-xs">
          {issues.map((issue, i) => (
            <span key={i}>{issue.message}</span>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

// ─── On-node settings summary ───────────────────────────────────────
// A compact, read-only view of a node's configured values rendered on the
// card itself, so configuration is visible at a glance without opening the
// PropertyPanel. Generic nodes list their non-empty settings (joined with the
// NodeDef's setting definitions for labels/options); subflow proxies list
// their subflow parameters instead — a required parameter with no value shows
// a red "Missing" so an unrunnable subflow is obvious from the canvas.

export interface SummaryRow {
  key: string;
  label: string;
  value: string;
  missing?: boolean;
}

const MAX_SUMMARY_ROWS = 3;

/** Human-readable rendering of a setting value; null = don't show a row. */
export function formatSummaryValue(
  value: unknown,
  options?: ReadonlyArray<{ label: string; value: string }>,
): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 'On' : 'Off';
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? '' : 's'}`;
  if (typeof value === 'object') return null; // structured settings have no one-line form
  const str = String(value);
  if (str.trim() === '') return null;
  // Map select values to their option label (same as the PropertyPanel).
  const opt = options?.find((o) => o.value === str);
  return opt ? opt.label : str;
}

/** Rows for a regular node: its setting definitions joined with current values. */
export function buildSettingRows(
  settings: Record<string, unknown>,
  settingDefs: readonly NodeSettingDef[],
): SummaryRow[] {
  const rows: SummaryRow[] = [];
  const sorted = [...settingDefs].sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  for (const def of sorted) {
    if (def.key === 'subflowId') continue; // internal wiring, not user config
    if ((def as { hidden?: boolean }).hidden) continue;
    // Same visibility rule as the PropertyPanel form.
    if (def.dependsOn && settings[def.dependsOn.key] !== def.dependsOn.value) continue;
    const value = formatSummaryValue(settings[def.key] ?? def.defaultValue, def.options);
    if (value === null) continue;
    rows.push({ key: def.key, label: def.label, value });
  }
  return rows;
}

/** Rows for a subflow proxy: its subflow parameters and their current values. */
export function buildParamRows(
  settings: Record<string, unknown>,
  parameters: ReadonlyArray<{
    id: string;
    name: string;
    required?: boolean;
    options?: ReadonlyArray<{ label: string; value: string }>;
    defaultValue?: unknown;
  }>,
): SummaryRow[] {
  const rows: SummaryRow[] = [];
  for (const p of parameters) {
    const value = formatSummaryValue(settings[p.id] ?? p.defaultValue, p.options);
    if (value === null) {
      // Unset required param: show it, in red — this subflow can't run yet.
      if (p.required) rows.push({ key: p.id, label: p.name, value: 'Missing', missing: true });
      continue;
    }
    rows.push({ key: p.id, label: p.name, value });
  }
  return rows;
}

export function NodeSettingsSummary({ rows }: { rows: SummaryRow[] }) {
  if (rows.length === 0) return null; // unconfigured nodes keep their compact look

  const visible = rows.slice(0, MAX_SUMMARY_ROWS);
  const overflow = rows.slice(MAX_SUMMARY_ROWS);

  return (
    <div className="mt-2 pt-2 border-t border-white/10 light:border-black/10 flex flex-col gap-1">
      {visible.map((r) => (
        <div key={r.key} className="flex items-center gap-1.5 text-[10px] leading-tight min-w-0">
          <span className="text-gray-500 flex-shrink-0">{r.label}</span>
          <span className={`truncate ${r.missing ? 'text-red-400' : 'text-gray-300 light:text-gray-700'}`}>
            {r.value}
          </span>
        </div>
      ))}
      {overflow.length > 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className="text-[10px] text-gray-500 cursor-default w-fit"
              onClick={(e) => e.stopPropagation()}
            >
              +{overflow.length} more
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <div className="flex flex-col gap-1 max-w-xs">
              {overflow.map((r) => (
                <span key={r.key}>
                  {r.label}: {r.missing ? 'Missing' : r.value}
                </span>
              ))}
            </div>
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

// ─── Base Node Component ────────────────────────────────────────────

function BaseNode({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as NodeData;
  const colors = getColors(nodeData.category);
  const Icon = getIcon(nodeData.icon);
  const setSelected = useWorkflowStore((s: { setSelectedNode: (id: string | null) => void }) => s.setSelectedNode);
  const defs = useWorkflowStore((s: { nodeDefinitions: NodeDef[] }) => s.nodeDefinitions);
  const def = defs.find((d: { type: string }) => d.type === nodeData.nodeType);

  const hasInputs = def?.ports.some((p: { direction: string }) => p.direction === 'input') ?? false;
  const hasOutputs = def?.ports.some((p: { direction: string }) => p.direction === 'output') ?? false;

  // For subflow proxy nodes, derive one handle per named boundary port from the
  // referenced subflow definition so multi-input/output subflows are wired correctly.
  const subflowCache = useWorkflowStore((s: { subflowCache: Record<string, any> }) => s.subflowCache);
  const isSubflow = nodeData.nodeType === 'system:subflow';
  const subflowDef = isSubflow ? subflowCache[nodeData.settings?.subflowId as string] : null;
  const inputPortNames: string[] = subflowDef
    ? (subflowDef.nodes as any[])
        .filter((n) => n.type === 'system:subflow-input')
        .map((n) => (n.settings?.inputName as string) || 'Input')
    : [];
  const outputPortNames: string[] = subflowDef
    ? (subflowDef.nodes as any[])
        .filter((n) => n.type === 'system:subflow-output')
        .map((n) => (n.settings?.outputName as string) || 'Output')
    : [];
  // ANY resolved subflow definition uses named-port handles (id = the boundary
  // node's inputName/outputName), not just when there are 2+ named ports —
  // otherwise a subflow with exactly ONE named output (the common case) falls
  // through to the generic branch below, whose output Handle hardcodes
  // id="out". A parent edge wired with sourcePortId="Output 1" (or any other
  // real name) then can't find a matching handle id, so React Flow silently
  // fails to render the edge at all — the connection exists in the data
  // (workflow-store/backend agree it's wired) but is invisible on canvas.
  const useNamedPorts = isSubflow && !!subflowDef;

  // The subflow proxy's handle set changes shape post-mount: it first renders
  // before `subflowCache[subflowId]` has loaded (no def yet), then re-renders
  // with named handles once the async fetch resolves. React Flow caches each
  // handle's measured position at mount and does NOT automatically re-measure
  // just because React re-rendered the DOM with different handles — edges
  // referencing a handle id that didn't exist at last measurement silently
  // fail to draw. `updateNodeInternals` is the explicit signal React Flow
  // needs to re-measure this node's handles.
  // On-node settings summary rows. Subflow proxies show their parameters
  // (with red "Missing" for unfilled required ones); every other node shows
  // its non-empty settings joined with the def's labels/options.
  const summaryRows =
    isSubflow && subflowDef
      ? buildParamRows(
          nodeData.settings ?? {},
          effectiveSubflowParameters(subflowDef, (t) => defs.find((d) => d.type === t)?.settings),
        )
      : buildSettingRows(nodeData.settings ?? {}, def?.settings ?? []);

  const updateNodeInternals = useUpdateNodeInternals();
  const handleKey = inputPortNames.join(',') + '|' + outputPortNames.join(',');
  // The summary changes the node's height; %-positioned named-port handles
  // must be re-measured when the number of rendered rows changes.
  const summaryRowCount =
    Math.min(summaryRows.length, MAX_SUMMARY_ROWS) + (summaryRows.length > MAX_SUMMARY_ROWS ? 1 : 0);
  useEffect(() => {
    updateNodeInternals(id);
  }, [id, useNamedPorts, handleKey, summaryRowCount, updateNodeInternals]);

  const handleClass =
    '!w-3.5 !h-3.5 !border-2 !bg-slate-300 !border-slate-500 transition-transform hover:!scale-125';

  if (useNamedPorts) {
    return (
      <div
        className={`
          group/node relative w-[260px] overflow-hidden rounded-2xl border backdrop-blur-sm
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
        <div className={`h-1.5 w-full bg-gradient-to-r ${colors.bar}`} />
        <NodeIssueBadge nodeId={id} />

        {/* Named input handles — falls back to a single generic "in" handle
            when the subflow has no system:subflow-input node (self-contained
            subflow), matching the plain branch's convention + the index-0
            fallback wiring described in docs/subflows.md §5. */}
        {(inputPortNames.length > 0 ? inputPortNames : ['in']).map((name, i, arr) => (
          <Handle
            key={`in-${name}`}
            type="target"
            position={Position.Left}
            id={name}
            style={{ top: `${((i + 1) / (arr.length + 1)) * 100}%` }}
            className={handleClass}
          />
        ))}

        <div className="px-4 py-3.5">
          <div className="flex items-center gap-3">
            <div className={`flex-shrink-0 p-2.5 rounded-xl bg-gradient-to-br ring-1 ${colors.chip} ${colors.accent}`}>
              <Icon size={22} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[15px] font-semibold text-gray-200 truncate leading-tight">{nodeData.label}</div>
              <div className="text-[11px] text-gray-500 capitalize tracking-wide mt-0.5">{nodeData.category}</div>
            </div>
          </div>
          <NodeSettingsSummary rows={summaryRows} />
        </div>

        {/* Named output handles — falls back to a single generic "out" handle
            when the output boundary is auto-derived (no explicit
            system:subflow-output node; see resolveSubflowOutputs), same
            fallback reasoning as the input handles above. */}
        {(outputPortNames.length > 0 ? outputPortNames : ['out']).map((name, i, arr) => (
          <Handle
            key={`out-${name}`}
            type="source"
            position={Position.Right}
            id={name}
            style={{ top: `${((i + 1) / (arr.length + 1)) * 100}%` }}
            className={handleClass}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      className={`
        group/node relative w-[260px] overflow-hidden rounded-2xl border backdrop-blur-sm
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
      <div className={`h-1.5 w-full bg-gradient-to-r ${colors.bar}`} />
      <NodeIssueBadge nodeId={id} />

      {/* Input handle */}
      {hasInputs && (
        <Handle
          type="target"
          position={Position.Left}
          id="in"
          className="!w-3.5 !h-3.5 !border-2 !bg-slate-300 !border-slate-500 transition-transform hover:!scale-125"
        />
      )}

      {/* Node content */}
      <div className="px-4 py-3.5">
        <div className="flex items-center gap-3">
          <div
            className={`flex-shrink-0 p-2.5 rounded-xl bg-gradient-to-br ring-1 ${colors.chip} ${colors.accent}`}
          >
            <Icon size={22} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[15px] font-semibold text-gray-200 truncate leading-tight">
              {nodeData.label}
            </div>
            <div className="text-[11px] text-gray-500 capitalize tracking-wide mt-0.5">
              {nodeData.category}
            </div>
          </div>
        </div>
        <NodeSettingsSummary rows={summaryRows} />
      </div>

      {/* Output handle */}
      {hasOutputs && (
        <Handle
          type="source"
          position={Position.Right}
          id="out"
          className="!w-3.5 !h-3.5 !border-2 !bg-slate-300 !border-slate-500 transition-transform hover:!scale-125"
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
