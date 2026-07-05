/**
 * Custom Node builder — create or edit a user-authored expression PTransform.
 *
 * Produces a CustomNodeDef (kind 'expression') persisted to localStorage via
 * the store. Composite nodes are created by the "Group as node" flow, not here,
 * but this modal can edit an existing composite's metadata (name/desc/icon).
 */

import React, { useState, useMemo } from 'react';
import { Plus, Trash2, Boxes, Sparkles } from 'lucide-react';
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

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

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        showCloseButton
        className="max-w-2xl sm:max-w-2xl p-0 gap-0 max-h-[90vh] flex flex-col overflow-hidden"
      >
        {/* Header */}
        <DialogHeader className="px-5 sm:px-6 py-4 border-b border-border">
          <DialogTitle className="flex items-center gap-2.5 text-[15px]">
            <span className="flex-shrink-0 p-1.5 rounded-lg bg-gradient-to-br from-cyan-500/25 to-cyan-500/5 ring-1 ring-cyan-400/25 text-cyan-400">
              <Sparkles size={16} />
            </span>
            <span className="truncate">
              {editing ? 'Edit Custom Node' : 'Create Custom Node'}
            </span>
            {isComposite && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground flex items-center gap-1 flex-shrink-0 font-normal">
                <Boxes size={10} /> composite
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-5 flex flex-col gap-7">
          {/* ── Basics ─────────────────────────────────────────── */}
          <Section title="Basics">
            {/* Name + icon: stack on narrow screens, side-by-side on wider */}
            <div className="flex flex-col sm:flex-row gap-4">
              <Field label="Name" className="flex-1">
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Add Total Column"
                  autoFocus
                />
              </Field>
              <Field label="Icon" className="sm:w-40">
                <Select value={icon} onValueChange={setIcon}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ICONS.map((i) => (
                      <SelectItem key={i} value={i}>{i}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <Field label="Description">
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What does this node do?"
              />
            </Field>
          </Section>

          {!isComposite && (
            <>
              {/* ── Logic ────────────────────────────────────────── */}
              <Section title="Logic">
                <Field label="Operation" hint={OPERATIONS.find((o) => o.value === operation)?.hint}>
                  <Select value={operation} onValueChange={(v) => setOperation(v as CustomOperation)}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {OPERATIONS.map((op) => (
                        <SelectItem key={op.value} value={op.value}>{op.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>

                <Field
                  label={<>Python expression (over <code className="text-cyan-400 font-mono">element</code>)</>}
                  hint={<>Reference exposed settings with <code className="text-cyan-400 font-mono">{'{{key}}'}</code>.</>}
                >
                  <Textarea
                    value={expression}
                    onChange={(e) => setExpression(e.target.value)}
                    rows={4}
                    spellCheck={false}
                    className="font-mono text-[13px] leading-relaxed resize-y min-h-[92px]"
                    placeholder="element['price'] * 1.2"
                  />
                </Field>
              </Section>

              {/* ── Exposed settings ─────────────────────────────── */}
              <Section
                title="Exposed settings"
                subtitle="optional"
                action={
                  <Button variant="ghost" size="xs" onClick={addSetting} className="text-cyan-400 hover:text-cyan-300">
                    <Plus /> Add
                  </Button>
                }
              >
                {settings.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">No settings — the expression is fixed.</p>
                ) : (
                  <div className="flex flex-col gap-2.5">
                    {settings.map((s, i) => (
                      <div
                        key={i}
                        className="flex flex-wrap sm:flex-nowrap gap-2 items-center bg-muted/40 border border-border rounded-lg p-2"
                      >
                        <Input
                          value={s.key}
                          onChange={(e) => updateSetting(i, { key: e.target.value.replace(/\s/g, '') })}
                          placeholder="key"
                          className="w-full sm:w-28 font-mono"
                        />
                        <Input
                          value={s.label}
                          onChange={(e) => updateSetting(i, { label: e.target.value })}
                          placeholder="Label"
                          className="flex-1 min-w-[120px]"
                        />
                        <Select
                          value={s.type}
                          onValueChange={(v) => updateSetting(i, { type: v as CustomSetting['type'] })}
                        >
                          <SelectTrigger className="w-full sm:w-28">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="text">text</SelectItem>
                            <SelectItem value="number">number</SelectItem>
                            <SelectItem value="boolean">boolean</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => removeSetting(i)}
                          title="Remove setting"
                          className="flex-shrink-0 ml-auto text-muted-foreground hover:text-red-400 hover:bg-red-500/10"
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </Section>

              {/* ── Live preview ─────────────────────────────────── */}
              <Section title="Generated Beam transform">
                <pre className="text-[13px] font-mono text-emerald-400 bg-muted/40 border border-border rounded-lg px-3.5 py-3 overflow-x-auto whitespace-pre leading-relaxed">
                  {preview}
                </pre>
              </Section>
            </>
          )}

          {isComposite && (
            <div className="text-xs text-muted-foreground bg-muted/40 border border-border rounded-lg px-3.5 py-3 leading-relaxed">
              This is a composite node built from {editing?.steps?.length ?? 0} grouped steps.
              You can rename it and change its icon here; its internal logic is fixed.
            </div>
          )}
        </div>

        {/* Footer */}
        <DialogFooter className="px-5 sm:px-6 py-4">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={!canSave}>
            {editing ? 'Save changes' : 'Create node'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A titled group of related fields. Separates the modal into clear sections
 * (Basics / Logic / Settings / Preview) with a header row that can carry an
 * optional subtitle and a right-aligned action.
 */
function Section({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
          {subtitle && <span className="ml-1.5 normal-case tracking-normal font-normal opacity-70">· {subtitle}</span>}
        </h3>
        {action}
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

/** A single labelled control with an optional helper hint below it. */
function Field({
  label,
  hint,
  className = '',
  children,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <Label className="mb-1.5 text-[13px] text-foreground">{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">{hint}</p>}
    </div>
  );
}
