/**
 * Custom Node builder — create or edit a user-authored expression PTransform.
 *
 * Produces a CustomNodeDef (kind 'expression') persisted to localStorage via
 * the store. Composite nodes are created by the "Group as node" flow, not here,
 * but this modal can edit an existing composite's metadata (name/desc/icon).
 */

import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, Trash2, Boxes, Sparkles } from 'lucide-react';
import { nanoid } from 'nanoid';
import {
  useWorkflowStore,
} from '../store/workflow-store';
import {
  type CustomNodeDef,
  type CustomOperation,
  type CustomSetting,
  CUSTOM_NODE_PREFIX,
  resolveExpression,
} from '../customNodes';

const OPERATIONS: { value: CustomOperation; label: string; hint: string }[] = [
  { value: 'MapExpr', label: 'Map — transform each element', hint: 'Return the new element' },
  { value: 'FilterExpr', label: 'Filter — keep matching elements', hint: 'Return True to keep' },
  { value: 'FlatMapExpr', label: 'FlatMap — expand to many', hint: 'Return a list of elements' },
];

const ICONS = ['box', 'sparkles', 'filter', 'arrow-right-left', 'group', 'database', 'file-output', 'file-csv'];

interface Props {
  /** Existing def to edit, or null to create. */
  editing: CustomNodeDef | null;
  onClose: () => void;
}

export function CustomNodeModal({ editing, onClose }: Props) {
  const upsertCustomNode = useWorkflowStore((s) => s.upsertCustomNode);
  const addToast = useWorkflowStore((s) => s.addToast);

  const isComposite = editing?.kind === 'composite';

  const [name, setName] = useState(editing?.name ?? '');
  const [description, setDescription] = useState(editing?.description ?? '');
  const [icon, setIcon] = useState(editing?.icon ?? 'sparkles');
  const [operation, setOperation] = useState<CustomOperation>(editing?.operation ?? 'MapExpr');
  const [expression, setExpression] = useState(
    editing?.expression ?? "{**element, 'total': element['qty'] * element['price']}",
  );
  const [settings, setSettings] = useState<CustomSetting[]>(editing?.settings ?? []);

  const preview = useMemo(() => {
    const sampleSettings: Record<string, unknown> = {};
    for (const s of settings) sampleSettings[s.key] = s.defaultValue ?? s.key;
    const expr = resolveExpression(expression || 'element', sampleSettings);
    const fn =
      operation === 'FilterExpr' ? 'beam.Filter' : operation === 'FlatMapExpr' ? 'beam.FlatMap' : 'beam.Map';
    return `${fn}(lambda element: ${expr})`;
  }, [expression, operation, settings]);

  const addSetting = () => {
    setSettings((s) => [
      ...s,
      { key: `param${s.length + 1}`, label: `Param ${s.length + 1}`, type: 'text', defaultValue: '' },
    ]);
  };
  const updateSetting = (i: number, patch: Partial<CustomSetting>) => {
    setSettings((s) => s.map((item, idx) => (idx === i ? { ...item, ...patch } : item)));
  };
  const removeSetting = (i: number) => setSettings((s) => s.filter((_, idx) => idx !== i));

  const canSave = name.trim().length > 0 && (isComposite || expression.trim().length > 0);

  const handleSave = () => {
    if (!canSave) return;
    const def: CustomNodeDef = editing
      ? {
          ...editing,
          name: name.trim(),
          description: description.trim(),
          icon,
          ...(isComposite
            ? {}
            : { operation, expression: expression.trim(), settings }),
        }
      : {
          id: `${CUSTOM_NODE_PREFIX}${nanoid(8)}`,
          name: name.trim(),
          description: description.trim(),
          icon,
          kind: 'expression',
          operation,
          expression: expression.trim(),
          settings,
          createdAt: new Date().toISOString(),
        };
    upsertCustomNode(def);
    addToast('success', editing ? `Updated "${def.name}"` : `Created node "${def.name}"`);
    onClose();
  };

  return createPortal(
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[100] flex items-center justify-center p-4 sm:p-8" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[90vh] bg-[var(--color-surface-100)] rounded-2xl border border-[var(--color-border-hover)] flex flex-col animate-fade-in shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-2">
            <Sparkles size={17} className="text-cyan-400" />
            <span className="text-[15px] font-semibold text-gray-100">
              {editing ? 'Edit Custom Node' : 'Create Custom Node'}
            </span>
            {isComposite && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-gray-500 flex items-center gap-1">
                <Boxes size={10} /> composite
              </span>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-white/10 transition-colors">
            <X size={15} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
          {/* Name + icon */}
          <div className="flex gap-3">
            <div className="flex-1">
              <Label>Name</Label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Add Total Column"
                className={inputCls}
                autoFocus
              />
            </div>
            <div>
              <Label>Icon</Label>
              <select value={icon} onChange={(e) => setIcon(e.target.value)} className={inputCls}>
                {ICONS.map((i) => (
                  <option key={i} value={i}>{i}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <Label>Description</Label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this node do?"
              className={inputCls}
            />
          </div>

          {!isComposite && (
            <>
              <div>
                <Label>Operation</Label>
                <select
                  value={operation}
                  onChange={(e) => setOperation(e.target.value as CustomOperation)}
                  className={inputCls}
                >
                  {OPERATIONS.map((op) => (
                    <option key={op.value} value={op.value}>{op.label}</option>
                  ))}
                </select>
                <p className="text-[11px] text-gray-500 mt-1.5">
                  {OPERATIONS.find((o) => o.value === operation)?.hint}
                </p>
              </div>

              <div>
                <Label>Python expression (over <code className="text-cyan-400 font-mono">element</code>)</Label>
                <textarea
                  value={expression}
                  onChange={(e) => setExpression(e.target.value)}
                  rows={4}
                  spellCheck={false}
                  className={`${inputCls} font-mono text-[13px] leading-relaxed resize-y`}
                  placeholder="element['price'] * 1.2"
                />
                <p className="text-[11px] text-gray-500 mt-1.5">
                  Reference exposed settings with <code className="text-cyan-400 font-mono">{'{{key}}'}</code>.
                </p>
              </div>

              {/* Exposed settings */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <Label className="!mb-0">Exposed settings (optional)</Label>
                  <button
                    onClick={addSetting}
                    className="flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 px-2 py-1 rounded-md hover:bg-white/5"
                  >
                    <Plus size={13} /> Add
                  </button>
                </div>
                {settings.length === 0 ? (
                  <p className="text-[11px] text-gray-500">No settings — the expression is fixed.</p>
                ) : (
                  <div className="space-y-2">
                    {settings.map((s, i) => (
                      <div key={i} className="flex gap-2 items-center">
                        <input
                          value={s.key}
                          onChange={(e) => updateSetting(i, { key: e.target.value.replace(/\s/g, '') })}
                          placeholder="key"
                          className={`${inputCls} !w-24 font-mono`}
                        />
                        <input
                          value={s.label}
                          onChange={(e) => updateSetting(i, { label: e.target.value })}
                          placeholder="Label"
                          className={inputCls}
                        />
                        <select
                          value={s.type}
                          onChange={(e) => updateSetting(i, { type: e.target.value as CustomSetting['type'] })}
                          className={`${inputCls} !w-28`}
                        >
                          <option value="text">text</option>
                          <option value="number">number</option>
                          <option value="boolean">boolean</option>
                        </select>
                        <button
                          onClick={() => removeSetting(i)}
                          className="p-1 rounded text-gray-500 hover:text-red-400 hover:bg-red-500/10"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Live preview */}
              <div>
                <Label>Generated Beam transform</Label>
                <pre className="text-[13px] font-mono text-emerald-300 bg-[var(--color-surface-0)] border border-[var(--color-border-hover)] rounded-lg px-3 py-2.5 overflow-x-auto whitespace-pre leading-relaxed">
                  {preview}
                </pre>
              </div>
            </>
          )}

          {isComposite && (
            <div className="text-xs text-gray-400 bg-[var(--color-surface-0)] border border-[var(--color-border-hover)] rounded-lg px-3 py-2.5 leading-relaxed">
              This is a composite node built from {editing?.steps?.length ?? 0} grouped steps.
              You can rename it and change its icon here; its internal logic is fixed.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-[var(--color-border)]">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-gray-300 hover:text-gray-100 hover:bg-white/5 transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!canSave}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-indigo-500 text-white hover:bg-indigo-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {editing ? 'Save changes' : 'Create node'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const inputCls = `w-full px-3 py-2 text-sm rounded-lg bg-[var(--color-surface-200)]
  border border-[var(--color-border-hover)] text-gray-100 placeholder-gray-500 outline-none
  focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-colors`;

function Label({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <label className={`block text-xs font-semibold text-gray-300 mb-1.5 ${className}`}>{children}</label>
  );
}
