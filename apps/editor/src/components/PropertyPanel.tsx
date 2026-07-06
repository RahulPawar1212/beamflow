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

  const [isConnectionModalOpen, setIsConnectionModalOpen] = React.useState(false);

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
                if ((s as any).hidden) return null;

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
          <>
            <div className="border-t border-[var(--color-border)] pt-4 mt-2 px-1">
              <button
                onClick={() => setIsConnectionModalOpen(true)}
                className="w-full flex items-center justify-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 font-semibold px-2 py-2 border border-indigo-500/30 rounded-lg hover:bg-indigo-500/10 transition-colors"
              >
                🔌 Configure Connection
              </button>
            </div>
            <SchemaEditor
              nodeType="beamflow:sql-source"
              columns={(settings.schemaColumns as any[]) ?? []}
              onChange={(cols) => handleChange('schemaColumns', cols)}
              connectionString={(settings.connectionString as string) ?? ''}
              sqlQuery={(settings.sqlQuery as string) ?? ''}
            />
          </>
        )}
      </div>

      {/* Node ID footer */}
      <div className="px-4 py-2 border-t border-[var(--color-border)] text-[10px] text-gray-700">
        ID: {selectedNode.id}
      </div>

      <ConnectionBuilderModal
        isOpen={isConnectionModalOpen}
        onClose={() => setIsConnectionModalOpen(false)}
        settings={settings}
        onSave={(connStr, details) => {
          // Update all details to node settings
          updateSettings(selectedNode.id, {
            connectionString: connStr,
            ...details
          });
        }}
      />
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

// ─── Connection Builder Modal ───────────────────────────────────────

interface ConnectionBuilderModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: Record<string, any>;
  onSave: (connectionString: string, details: Record<string, any>) => void;
}

function ConnectionBuilderModal({ isOpen, onClose, settings, onSave }: ConnectionBuilderModalProps) {
  if (!isOpen) return null;

  const [provider, setProvider] = React.useState(settings.connectionProvider || 'PostgreSQL');
  const [host, setHost] = React.useState(settings.host || 'localhost');
  const [port, setPort] = React.useState(settings.port || 5432);
  const [databaseName, setDatabaseName] = React.useState(settings.databaseName || '');
  const [authType, setAuthType] = React.useState(settings.username ? 'SQL' : 'Windows');
  const [username, setUsername] = React.useState(settings.username || '');
  const [password, setPassword] = React.useState(settings.password || '');
  const [sqlitePath, setSqlitePath] = React.useState(settings.sqlitePath || 'beamflow.db');
  const [containsProduction, setContainsProduction] = React.useState(settings.containsProduction || false);
  const [rememberConnection, setRememberConnection] = React.useState(settings.rememberConnection !== false);

  const [testStatus, setTestStatus] = React.useState<{ type: 'success' | 'error' | null; message: string }>({
    type: null,
    message: '',
  });
  const [isTesting, setIsTesting] = React.useState(false);

  // Auto-assemble connection string based on form details
  const getConnectionString = () => {
    if (provider === 'SQLite') {
      return `file:${sqlitePath}`;
    } else {
      const authPart = authType === 'SQL' && username ? `${username}:${password}@` : '';
      return `postgresql://${authPart}${host}:${port}/${databaseName}`;
    }
  };

  const handleTest = async () => {
    setIsTesting(true);
    setTestStatus({ type: null, message: '' });
    try {
      const connStr = getConnectionString();
      const res = await api.testConnection(connStr);
      if (res.success) {
        setTestStatus({ type: 'success', message: 'Connection established successfully!' });
      } else {
        setTestStatus({ type: 'error', message: res.error || 'Connection failed.' });
      }
    } catch (err) {
      setTestStatus({
        type: 'error',
        message: err instanceof Error ? err.message : 'Unknown connection error.',
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = () => {
    const connStr = getConnectionString();
    onSave(connStr, {
      connectionProvider: provider,
      host,
      port: Number(port),
      databaseName,
      username: authType === 'SQL' ? username : '',
      password: authType === 'SQL' ? password : '',
      sqlitePath,
      containsProduction,
      rememberConnection,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg bg-[var(--color-surface-100)] border border-[var(--color-border)] rounded-xl shadow-2xl overflow-hidden animate-zoom-in">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[var(--color-border)] flex items-center justify-between bg-[var(--color-surface-200)]">
          <h3 className="text-sm font-bold text-gray-200 flex items-center gap-2">
            <span>🔌</span> LINQ to SQL Connection Builder
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-200 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 flex flex-col gap-4 max-h-[70vh] overflow-y-auto">
          {/* Provider Selection */}
          <div className="border border-[var(--color-border)] p-3 rounded-lg bg-[var(--color-surface-200)]/50">
            <label className="text-[10px] font-bold text-gray-400 uppercase block mb-2">Provider</label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
                <input
                  type="radio"
                  name="provider"
                  checked={provider === 'PostgreSQL'}
                  onChange={() => setProvider('PostgreSQL')}
                  className="text-indigo-500 focus:ring-indigo-500/30"
                />
                PostgreSQL
              </label>
              <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
                <input
                  type="radio"
                  name="provider"
                  checked={provider === 'SQLite'}
                  onChange={() => setProvider('SQLite')}
                  className="text-indigo-500 focus:ring-indigo-500/30"
                />
                SQLite (local file)
              </label>
              <label className="flex items-center gap-2 text-xs text-gray-500 cursor-not-allowed">
                <input type="radio" name="provider" disabled className="text-gray-700" />
                SQL Server (unsupported)
              </label>
            </div>
          </div>

          {/* SQLite Specific details */}
          {provider === 'SQLite' && (
            <div className="flex flex-col gap-3">
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">SQLite Database File Path</label>
                <input
                  type="text"
                  value={sqlitePath}
                  onChange={(e) => setSqlitePath(e.target.value)}
                  placeholder="e.g. beamflow.db"
                  className="w-full px-3 py-2 text-xs rounded-lg bg-[var(--color-surface-200)] border border-[var(--color-border)] text-gray-300 placeholder-gray-600 outline-none focus:border-indigo-500/50 transition-colors"
                />
              </div>
            </div>
          )}

          {/* Postgres details */}
          {provider === 'PostgreSQL' && (
            <div className="flex flex-col gap-4 animate-fade-in">
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Server Host</label>
                  <input
                    type="text"
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                    placeholder="localhost"
                    className="w-full px-3 py-2 text-xs rounded-lg bg-[var(--color-surface-200)] border border-[var(--color-border)] text-gray-300 placeholder-gray-600 outline-none focus:border-indigo-500/50 transition-colors"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Port</label>
                  <input
                    type="number"
                    value={port}
                    onChange={(e) => setPort(Number(e.target.value))}
                    placeholder="5432"
                    className="w-full px-3 py-2 text-xs rounded-lg bg-[var(--color-surface-200)] border border-[var(--color-border)] text-gray-300 placeholder-gray-600 outline-none focus:border-indigo-500/50 transition-colors"
                  />
                </div>
              </div>

              {/* Logon Details */}
              <div className="border border-[var(--color-border)] p-3 rounded-lg bg-[var(--color-surface-200)]/30">
                <label className="text-[10px] font-bold text-gray-400 uppercase block mb-2">Logon Details</label>
                <div className="flex gap-4 mb-3">
                  <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
                    <input
                      type="radio"
                      name="authType"
                      checked={authType === 'Windows'}
                      onChange={() => setAuthType('Windows')}
                      className="text-indigo-500 focus:ring-indigo-500/30"
                    />
                    Windows Authentication / Integrated
                  </label>
                  <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
                    <input
                      type="radio"
                      name="authType"
                      checked={authType === 'SQL'}
                      onChange={() => setAuthType('SQL')}
                      className="text-indigo-500 focus:ring-indigo-500/30"
                    />
                    SQL Authentication
                  </label>
                </div>

                {authType === 'SQL' && (
                  <div className="flex flex-col gap-2 mt-2 animate-fade-in">
                    <div>
                      <label className="text-[9px] font-semibold text-gray-400 block mb-0.5">Username</label>
                      <input
                        type="text"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder="postgres"
                        className="w-full px-3 py-1.5 text-xs rounded bg-[var(--color-surface-200)] border border-[var(--color-border)] text-gray-300 placeholder-gray-600 outline-none focus:border-indigo-500/50"
                      />
                    </div>
                    <div>
                      <label className="text-[9px] font-semibold text-gray-400 block mb-0.5">Password</label>
                      <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full px-3 py-1.5 text-xs rounded bg-[var(--color-surface-200)] border border-[var(--color-border)] text-gray-300 placeholder-gray-600 outline-none focus:border-indigo-500/50"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Database Select */}
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Database Name</label>
                <input
                  type="text"
                  value={databaseName}
                  onChange={(e) => setDatabaseName(e.target.value)}
                  placeholder="e.g. sales_db"
                  className="w-full px-3 py-2 text-xs rounded-lg bg-[var(--color-surface-200)] border border-[var(--color-border)] text-gray-300 placeholder-gray-600 outline-none focus:border-indigo-500/50 transition-colors"
                />
              </div>
            </div>
          )}

          {/* Options checkboxes */}
          <div className="flex flex-col gap-2 border-t border-[var(--color-border)] pt-3">
            <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                checked={rememberConnection}
                onChange={(e) => setRememberConnection(e.target.checked)}
                className="rounded text-indigo-500 focus:ring-indigo-500/30"
              />
              Remember this connection
            </label>
            <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                checked={containsProduction}
                onChange={(e) => setContainsProduction(e.target.checked)}
                className="rounded text-indigo-500 focus:ring-indigo-500/30"
              />
              Contains production data
              {containsProduction && (
                <span className="text-[9px] px-1 py-0.5 rounded bg-red-500/10 text-red-400 font-semibold uppercase animate-pulse">
                  Production Warning
                </span>
              )}
            </label>
          </div>

          {/* Status Message */}
          {testStatus.type && (
            <div
              className={`p-3 rounded-lg text-xs font-semibold mt-1 border ${
                testStatus.type === 'success'
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                  : 'bg-red-500/10 border-red-500/30 text-red-400'
              }`}
            >
              {testStatus.type === 'success' ? '✅' : '❌'} {testStatus.message}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-[var(--color-border)] bg-[var(--color-surface-200)] flex justify-between gap-3">
          <button
            onClick={handleTest}
            disabled={isTesting}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-colors border
              ${
                isTesting
                  ? 'bg-gray-500/10 text-gray-500 border-gray-500/20 cursor-not-allowed'
                  : 'bg-indigo-500/10 border-indigo-500/30 text-indigo-400 hover:bg-indigo-500/20'
              }`}
          >
            {isTesting ? 'Testing connection...' : 'Test Connection'}
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-xs font-bold text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-2 rounded-lg text-xs font-bold bg-indigo-500 hover:bg-indigo-400 text-white transition-colors"
            >
              Save Connection
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
