/**
 * Property Panel — right-side panel for editing selected node settings.
 * Dynamically renders form controls based on ISettingDefinition.
 */

import React from 'react';
import { X, Settings2, Trash2, Plus } from 'lucide-react';
import { useWorkflowStore } from '../store/workflow-store.js';
import { useSchemaStore } from '../lib/schema-store.js';
import { api } from '../api/client.js';
import type { NodeDef } from '../api/client.js';

export function PropertyPanel() {
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId);
  const nodes = useWorkflowStore((s) => s.nodes);
  const edges = useWorkflowStore((s) => s.edges);
  const nodeDefinitions = useWorkflowStore((s) => s.nodeDefinitions);
  const updateSettings = useWorkflowStore((s) => s.updateNodeSettings);
  const updateNodeLabel = useWorkflowStore((s) => s.updateNodeLabel);
  const removeNode = useWorkflowStore((s) => s.removeNode);
  const setSelected = useWorkflowStore((s) => s.setSelectedNode);
  const schemas = useSchemaStore((s) => s.schemas);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  if (!selectedNode) return null;

  // Retrieve input columns from parent nodes
  const incomingEdges = edges.filter((e) => e.target === selectedNode.id);
  const inputColumns = incomingEdges.flatMap((edge) => {
    const parentSchema = schemas.get(edge.source)?.outputSchema;
    return parentSchema ? parentSchema.columns : [];
  });

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
      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-4">
        {Array.from(groups.entries()).map(([groupName, groupSettings]) => (
          <div key={groupName}>
            <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
              {groupName}
            </div>
            <div className="flex flex-col gap-3">
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
                    inputColumns={inputColumns}
                  />
                );
              })}
            </div>
          </div>
        ))}

        {/* Custom Schema Editor for CSV and SQL Source nodes */}
        {selectedNode.data.nodeType === 'beamflow:csv-source' && (
          <SchemaEditor
            nodeType="beamflow:csv-source"
            columns={(settings.schemaColumns as any[]) ?? []}
            onChange={(cols) => handleChange('schemaColumns', cols)}
            filePath={(settings.filePath as string) ?? ''}
            delimiter={(settings.delimiter as string) ?? ','}
          />
        )}
        {selectedNode.data.nodeType === 'beamflow:sql-source' && (
          <SchemaEditor
            nodeType="beamflow:sql-source"
            columns={(settings.schemaColumns as any[]) ?? []}
            onChange={(cols) => handleChange('schemaColumns', cols)}
            connectionString={(settings.connectionString as string) ?? ''}
            sqlQuery={(settings.sqlQuery as string) ?? ''}
          />
        )}
      </div>

      {/* Node ID footer */}
      <div className="px-4 py-2 border-t border-[var(--color-border)] text-[10px] text-gray-700">
        ID: {selectedNode.id}
      </div>
    </div>
  );
}

// ─── Custom Schema Editor ──────────────────────────────────────────

interface SchemaEditorProps {
  columns: any[];
  onChange: (columns: any[]) => void;
  nodeType: string;
  filePath?: string;
  delimiter?: string;
  connectionString?: string;
  sqlQuery?: string;
}

function SchemaEditor({
  columns,
  onChange,
  nodeType,
  filePath,
  delimiter,
  connectionString,
  sqlQuery,
}: SchemaEditorProps) {
  const [isDetecting, setIsDetecting] = React.useState(false);

  const handleDetect = async () => {
    if (nodeType === 'beamflow:csv-source') {
      if (!filePath) {
        alert('Please specify a File Path first.');
        return;
      }
      setIsDetecting(true);
      try {
        const { headers, sampleRows } = await api.previewCsv(filePath, delimiter);
        if (headers.length === 0) {
          alert('No headers or columns detected in this file.');
          return;
        }

        // Simple type inference on first non-empty value in each column
        const inferred = headers.map((header: string, colIndex: number) => {
          let inferredType = 'string';
          for (const row of sampleRows) {
            const val = row[colIndex]?.trim() ?? '';
            if (val !== '') {
              if (/^(true|false|yes|no|1|0)$/i.test(val)) inferredType = 'boolean';
              else if (/^-?\d+$/.test(val)) inferredType = 'integer';
              else if (/^-?\d+\.\d+$/.test(val)) inferredType = 'double';
              else if (/^\d{4}-\d{2}-\d{2}$/.test(val)) inferredType = 'date';
              break;
            }
          }
          return { name: header, type: inferredType, nullable: true };
        });

        onChange(inferred);
      } catch (err) {
        console.error('Schema detection error:', err);
        alert(err instanceof Error ? err.message : 'Failed to read file preview from server.');
      } finally {
        setIsDetecting(false);
      }
    } else if (nodeType === 'beamflow:sql-source') {
      if (!connectionString) {
        alert('Please specify a Connection String first.');
        return;
      }
      if (!sqlQuery) {
        alert('Please specify a SQL Query first.');
        return;
      }
      setIsDetecting(true);
      try {
        const { columns: detectedColumns } = await api.previewSql(connectionString, sqlQuery);
        if (detectedColumns.length === 0) {
          alert('No columns returned from the SQL query.');
          return;
        }
        const inferred = detectedColumns.map((c) => ({
          name: c.name,
          type: c.type,
          nullable: true,
        }));
        onChange(inferred);
      } catch (err) {
        console.error('SQL Schema detection error:', err);
        alert(err instanceof Error ? err.message : 'Failed to query database schema.');
      } finally {
        setIsDetecting(false);
      }
    }
  };

  const handleAdd = () => {
    const newCol = { name: `col_${columns.length + 1}`, type: 'string', nullable: true };
    onChange([...columns, newCol]);
  };

  const handleRemove = (index: number) => {
    const updated = columns.filter((_, i) => i !== index);
    onChange(updated);
  };

  const handleFieldChange = (index: number, key: string, val: unknown) => {
    const updated = columns.map((col, i) => {
      if (i === index) {
        return { ...col, [key]: val };
      }
      return col;
    });
    onChange(updated);
  };

  return (
    <div className="border-t border-[var(--color-border)] pt-4 mt-2">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
          Schema Columns
        </span>
        <div className="flex gap-1.5">
          <button
            onClick={handleDetect}
            disabled={isDetecting}
            className={`text-[10px] font-semibold px-2 py-1 rounded transition-colors
              ${isDetecting
                ? 'text-gray-500 bg-gray-500/10 cursor-not-allowed'
                : 'text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/10'}`}
          >
            {isDetecting ? 'Detecting...' : 'Detect Schema'}
          </button>
          <button
            onClick={handleAdd}
            className="flex items-center gap-1 text-[10px] text-emerald-400 hover:text-emerald-300 font-semibold px-2 py-1 rounded hover:bg-emerald-500/10 transition-colors"
          >
            <Plus size={12} /> Add
          </button>
        </div>
      </div>

      {columns.length === 0 ? (
        <div className="text-[10px] text-gray-600 italic py-3 text-center border border-dashed border-[var(--color-border)] rounded-lg">
          No columns defined. Add columns to propagate downstream.
        </div>
      ) : (
        <div className="flex flex-col gap-2 max-h-60 overflow-y-auto pr-1">
          {columns.map((col, index) => (
            <div key={index} className="flex gap-1.5 items-center">
              <input
                type="text"
                value={col.name || ''}
                onChange={(e) => handleFieldChange(index, 'name', e.target.value)}
                placeholder="Column name"
                className="flex-1 min-w-0 px-2 py-1 text-xs rounded-md bg-[var(--color-surface-200)] border border-[var(--color-border)] text-gray-300 outline-none focus:border-indigo-500/50 transition-colors"
              />
              <select
                value={col.type || 'string'}
                onChange={(e) => handleFieldChange(index, 'type', e.target.value)}
                className="w-24 px-1.5 py-1 text-xs rounded-md bg-[var(--color-surface-200)] border border-[var(--color-border)] text-gray-300 outline-none focus:border-indigo-500/50 transition-colors"
              >
                <option value="string">String</option>
                <option value="integer">Integer</option>
                <option value="double">Double</option>
                <option value="boolean">Boolean</option>
                <option value="date">Date</option>
                <option value="datetime">DateTime</option>
                <option value="time">Time</option>
                <option value="decimal">Decimal</option>
                <option value="bytes">Bytes</option>
              </select>
              <button
                onClick={() => handleRemove(index)}
                className="p-1 rounded hover:bg-red-500/15 text-gray-500 hover:text-red-400 transition-colors"
                title="Remove column"
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Setting Control Renderer ───────────────────────────────────────

interface SettingControlProps {
  setting: NodeDef['settings'][0];
  value: unknown;
  onChange: (value: unknown) => void;
  inputColumns: any[];
}

function SettingControl({ setting, value, onChange, inputColumns }: SettingControlProps) {
  const isFixed = setting.fixed;

  const baseInputClass = `w-full px-2.5 py-1.5 text-xs rounded-lg
    bg-[var(--color-surface-200)] border border-[var(--color-border)]
    text-gray-300 placeholder-gray-600 outline-none
    focus:border-indigo-500/50 transition-colors
    ${isFixed ? 'opacity-60 cursor-not-allowed' : ''}`;

  const isColumnDropdown = (setting.key === 'field' || setting.key === 'aggregateField') && inputColumns.length > 0;

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
        isColumnDropdown ? (
          <select
            value={(value as string) || ''}
            onChange={(e) => onChange(e.target.value)}
            disabled={isFixed}
            className={baseInputClass}
          >
            <option value="">-- Select Column --</option>
            {inputColumns.map((col) => (
              <option key={col.id || col.name} value={col.name}>
                {col.name} ({col.type})
              </option>
            ))}
          </select>
        ) : (
          <input
            type="text"
            value={(value as string) || ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder={setting.placeholder}
            disabled={isFixed}
            className={baseInputClass}
          />
        )
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
