/**
 * Property Panel — right-side panel for editing selected node settings.
 * Dynamically renders form controls based on ISettingDefinition.
 */

import React from 'react';
import { X, Settings2, Trash2 } from 'lucide-react';
import { useWorkflowStore } from '../store/workflow-store';
import type { NodeDef } from '../api/client';

export function PropertyPanel() {
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId);
  const nodes = useWorkflowStore((s) => s.nodes);
  const nodeDefinitions = useWorkflowStore((s) => s.nodeDefinitions);
  const updateSettings = useWorkflowStore((s) => s.updateNodeSettings);
  const updateNodeLabel = useWorkflowStore((s) => s.updateNodeLabel);
  const removeNode = useWorkflowStore((s) => s.removeNode);
  const setSelected = useWorkflowStore((s) => s.setSelectedNode);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  if (!selectedNode) return null;

  const def = nodeDefinitions.find((d) => d.type === selectedNode.data.nodeType);
  if (!def) return null;

  const settings = selectedNode.data.settings;

  // Group settings
  const groups = new Map<string, typeof def.settings>();
  for (const s of def.settings) {
    const group = s.group || 'General';
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(s);
  }

  // Sort each group by order
  for (const [, groupSettings] of groups) {
    groupSettings.sort((a, b) => (a.order || 99) - (b.order || 99));
  }

  const handleChange = (key: string, value: unknown) => {
    updateSettings(selectedNode.id, { [key]: value });
  };

  return (
    <div className="w-72 h-full glass flex flex-col animate-slide-right">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2">
          <Settings2 size={14} className="text-indigo-400 flex-shrink-0" />
          <span className="text-[10px] text-gray-500 capitalize flex-1">
            {def.name} · {def.category}
          </span>
          <button
            onClick={() => removeNode(selectedNode.id)}
            title="Delete node"
            className="p-1 rounded hover:bg-red-500/15 text-gray-500 hover:text-red-400 transition-colors"
          >
            <Trash2 size={13} />
          </button>
          <button
            onClick={() => setSelected(null)}
            title="Close"
            className="p-1 rounded hover:bg-white/10 text-gray-500 hover:text-gray-300 transition-colors"
          >
            <X size={14} />
          </button>
        </div>
        {/* Editable node label */}
        <input
          type="text"
          value={selectedNode.data.label}
          onChange={(e) => updateNodeLabel(selectedNode.id, e.target.value)}
          spellCheck={false}
          placeholder="Node name"
          className="mt-2 w-full text-sm font-semibold text-gray-200 bg-transparent
            border border-transparent rounded-md px-1.5 py-0.5 -ml-1.5 outline-none
            hover:border-[var(--color-border)] focus:border-indigo-500/50 transition-colors"
        />
      </div>

      {/* Description */}
      {def.description && (
        <div className="px-4 py-2 text-[11px] text-gray-500 border-b border-[var(--color-border)]">
          {def.description}
        </div>
      )}

      {/* Settings form */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {Array.from(groups.entries()).map(([groupName, groupSettings]) => (
          <div key={groupName}>
            <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
              {groupName}
            </div>
            <div className="space-y-3">
              {groupSettings.map((s) => {
                // Check dependsOn visibility
                if (s.dependsOn) {
                  const depValue = settings[s.dependsOn.key];
                  if (depValue !== s.dependsOn.value) return null;
                }

                return (
                  <SettingControl
                    key={s.key}
                    setting={s}
                    value={settings[s.key]}
                    onChange={(v) => handleChange(s.key, v)}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Node ID footer */}
      <div className="px-4 py-2 border-t border-[var(--color-border)] text-[10px] text-gray-700">
        ID: {selectedNode.id}
      </div>
    </div>
  );
}

// ─── Setting Control Renderer ───────────────────────────────────────

interface SettingControlProps {
  setting: NodeDef['settings'][0];
  value: unknown;
  onChange: (value: unknown) => void;
}

function SettingControl({ setting, value, onChange }: SettingControlProps) {
  const isFixed = setting.fixed;

  const baseInputClass = `w-full px-2.5 py-1.5 text-xs rounded-lg
    bg-[var(--color-surface-200)] border border-[var(--color-border)]
    text-gray-300 placeholder-gray-600 outline-none
    focus:border-indigo-500/50 transition-colors
    ${isFixed ? 'opacity-60 cursor-not-allowed' : ''}`;

  return (
    <div>
      <label className="flex items-center gap-1 text-[11px] text-gray-400 mb-1">
        {setting.label}
        {setting.validation?.some((v) => v.type === 'required') && (
          <span className="text-red-400">*</span>
        )}
        {isFixed && (
          <span className="text-[9px] px-1 py-0.5 rounded bg-amber-500/10 text-amber-400 ml-1">
            Fixed
          </span>
        )}
      </label>

      {setting.description && (
        <div className="text-[10px] text-gray-600 mb-1">{setting.description}</div>
      )}

      {/* Text / Expression */}
      {(setting.type === 'text' || setting.type === 'expression') && (
        <input
          type="text"
          value={(value as string) || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={setting.placeholder}
          disabled={isFixed}
          className={baseInputClass}
        />
      )}

      {/* Textarea / SQL */}
      {(setting.type === 'textarea' || setting.type === 'sql') && (
        <textarea
          value={(value as string) || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={setting.placeholder}
          disabled={isFixed}
          rows={4}
          className={`${baseInputClass} resize-y font-mono`}
        />
      )}

      {/* Number */}
      {setting.type === 'number' && (
        <input
          type="number"
          value={(value as number) ?? ''}
          onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)}
          placeholder={setting.placeholder}
          disabled={isFixed}
          className={baseInputClass}
        />
      )}

      {/* Boolean */}
      {setting.type === 'boolean' && (
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={(value as boolean) || false}
            onChange={(e) => onChange(e.target.checked)}
            disabled={isFixed}
            className="rounded border-gray-600 bg-[var(--color-surface-200)]
              text-indigo-500 focus:ring-indigo-500/30 focus:ring-offset-0"
          />
          <span className="text-xs text-gray-400">
            {(value as boolean) ? 'Enabled' : 'Disabled'}
          </span>
        </label>
      )}

      {/* Select */}
      {(setting.type === 'select' || setting.type === 'multi-select') && (
        <select
          value={(value as string) || ''}
          onChange={(e) => onChange(e.target.value)}
          disabled={isFixed}
          className={baseInputClass}
        >
          {setting.options?.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
