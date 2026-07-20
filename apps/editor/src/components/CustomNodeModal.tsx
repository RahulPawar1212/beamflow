/**
 * Custom Node builder — create or edit a user-authored expression PTransform.
 *
 * Produces a CustomNodeDef (kind 'expression') persisted to localStorage via
 * the store. Composite nodes are created by the "Group as node" flow, not here,
 * but this modal can edit an existing composite's metadata (name/desc/icon).
 */

import React, { useState, useMemo } from 'react';
import { Plus, Trash2, Boxes, Sparkles, Calculator } from 'lucide-react';
import { nanoid } from 'nanoid';
import { SettingType } from '@beamflow/shared';
import type { ISettingDefinition } from '@beamflow/shared';
import { ColumnDataType } from '@beamflow/schema';
import {
  useWorkflowStore,
} from '../store/workflow-store';
import {
  type CustomNodeDef,
  type CustomOperation,
  type CustomSetting,
  type OutputColumnDecl,
  type OutputColumnMode,
  type KeyByMode,
  CUSTOM_NODE_PREFIX,
  normalizeKeyBy,
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

const PARAM_TYPES: { value: SettingType; label: string }[] = [
  { value: SettingType.Text, label: 'text' },
  { value: SettingType.Number, label: 'number' },
  { value: SettingType.Boolean, label: 'boolean' },
  { value: SettingType.Select, label: 'select (dropdown)' },
  { value: SettingType.TextArea, label: 'textarea' },
];

const COLUMN_TYPES: ColumnDataType[] = [
  ColumnDataType.STRING,
  ColumnDataType.INTEGER,
  ColumnDataType.DOUBLE,
  ColumnDataType.BOOLEAN,
  ColumnDataType.DATE,
  ColumnDataType.DATETIME,
  ColumnDataType.TIME,
  ColumnDataType.DECIMAL,
  ColumnDataType.BYTES,
];

const DEFAULT_PROCESS_BODY =
  "# `element` is the input record (a dict). Build the output record and yield it.\n" +
  "result = dict(element)\n" +
  "result['flag'] = True\n" +
  "yield result";

function newParam(index: number): ISettingDefinition {
  return {
    key: `param${index + 1}`,
    label: `Param ${index + 1}`,
    type: SettingType.Text,
    defaultValue: '',
  };
}

function newOutputColumn(): OutputColumnDecl {
  return { mode: 'new', name: 'value', type: ColumnDataType.STRING, nullable: true };
}

interface Props {
  /** Existing def to edit, or null to create. */
  editing: CustomNodeDef | null;
  onClose: () => void;
}

export function CustomNodeModal({ editing, onClose }: Props) {
  const upsertCustomNode = useWorkflowStore((s) => s.upsertCustomNode);
  const addToast = useWorkflowStore((s) => s.addToast);

  const isComposite = editing?.kind === 'composite';

  // Node type only matters for NEW nodes — an existing def's kind is fixed.
  const [newKind, setNewKind] = useState<'expression' | 'calculation'>(
    editing?.kind === 'calculation' ? 'calculation' : 'expression',
  );
  const kind: CustomNodeDef['kind'] = editing?.kind ?? newKind;
  const isCalculation = kind === 'calculation';

  const [name, setName] = useState(editing?.name ?? '');
  const [description, setDescription] = useState(editing?.description ?? '');
  const [icon, setIcon] = useState(editing?.icon ?? 'sparkles');
  const [operation, setOperation] = useState<CustomOperation>(editing?.operation ?? 'MapExpr');
  const [expression, setExpression] = useState(
    editing?.expression ?? "{**element, 'total': element['qty'] * element['price']}",
  );
  const [settings, setSettings] = useState<CustomSetting[]>(editing?.settings ?? []);

  // Calculation-kind state
  const [params, setParams] = useState<ISettingDefinition[]>(editing?.params ?? []);
  const editingKeyBy = normalizeKeyBy(editing?.transform?.keyBy);
  const [keyBy, setKeyBy] = useState(editingKeyBy.columns.join(', '));
  const [keyByMode, setKeyByMode] = useState<KeyByMode>(editingKeyBy.mode);
  const [processBody, setProcessBody] = useState(
    editing?.transform?.processBody ?? DEFAULT_PROCESS_BODY,
  );
  const [outputColumns, setOutputColumns] = useState<OutputColumnDecl[]>(
    editing?.outputColumns ?? [{ mode: 'passthrough-all' }],
  );

  const preview = useMemo(() => {
    if (isCalculation) {
      const keyed = keyBy.trim().length > 0;
      return keyed
        ? `class _Fn(beam.DoFn):\n    def process(self, key_records):\n        key, records = key_records\n        ...\n\npcoll | beam.Map(...) | beam.GroupByKey() | beam.ParDo(_Fn())`
        : `class _Fn(beam.DoFn):\n    def process(self, element):\n        ...\n\npcoll | beam.ParDo(_Fn())`;
    }
    const sampleSettings: Record<string, unknown> = {};
    for (const s of settings) sampleSettings[s.key] = s.defaultValue ?? s.key;
    const expr = resolveExpression(expression || 'element', sampleSettings);
    const fn =
      operation === 'FilterExpr' ? 'beam.Filter' : operation === 'FlatMapExpr' ? 'beam.FlatMap' : 'beam.Map';
    return `${fn}(lambda element: ${expr})`;
  }, [expression, operation, settings, isCalculation, keyBy]);

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

  const addParam = () => setParams((p) => [...p, newParam(p.length)]);
  const updateParam = (i: number, patch: Partial<ISettingDefinition>) => {
    setParams((p) => p.map((item, idx) => (idx === i ? { ...item, ...patch } : item)));
  };
  const removeParam = (i: number) => setParams((p) => p.filter((_, idx) => idx !== i));

  const addOutputColumn = () => setOutputColumns((c) => [...c, newOutputColumn()]);
  const updateOutputColumn = (i: number, patch: Partial<OutputColumnDecl>) => {
    setOutputColumns((c) => c.map((item, idx) => (idx === i ? { ...item, ...patch } : item)));
  };
  const removeOutputColumn = (i: number) => setOutputColumns((c) => c.filter((_, idx) => idx !== i));

  const canSave =
    name.trim().length > 0 &&
    (isComposite ||
      (isCalculation ? processBody.trim().length > 0 : expression.trim().length > 0));

  const handleSave = () => {
    if (!canSave) return;
    const calcFields = {
      params,
      transform: {
        keyBy: {
          columns: keyBy
            .split(',')
            .map((k) => k.trim())
            .filter(Boolean),
          mode: keyByMode,
        },
        processBody: processBody.trim(),
      },
      outputColumns,
    };
    // Expression-kind nodes declare only outputColumns (no params/transform —
    // those are calculation-only); this is what lets the schema store build a
    // CustomCalcSchemaNode for an expression node (see createSchemaNodeForType).
    const expressionFields = { operation, expression: expression.trim(), settings, outputColumns };
    const def: CustomNodeDef = editing
      ? {
          ...editing,
          name: name.trim(),
          description: description.trim(),
          icon,
          ...(isComposite
            ? {}
            : isCalculation
              ? calcFields
              : expressionFields),
        }
      : {
          id: `${CUSTOM_NODE_PREFIX}${nanoid(8)}`,
          name: name.trim(),
          description: description.trim(),
          icon,
          kind,
          ...(isCalculation
            ? calcFields
            : expressionFields),
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
            {isCalculation && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground flex items-center gap-1 flex-shrink-0 font-normal">
                <Calculator size={10} /> calculation
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-5 flex flex-col gap-7">
          {/* ── Basics ─────────────────────────────────────────── */}
          <Section title="Basics">
            {!editing && (
              <Field
                label="Node type"
                hint={
                  isCalculation
                    ? 'A full calculation node: rich parameters, a Python DoFn body, and a declared output schema — the same shape as a cortex blueprint calculation node.'
                    : 'A single expression over element (Map/Filter/FlatMap).'
                }
              >
                <Select value={newKind} onValueChange={(v) => setNewKind(v as 'expression' | 'calculation')}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="expression">Expression — one-line transform</SelectItem>
                    <SelectItem value="calculation">Calculation — full DoFn + parameters + schema</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            )}

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

          {!isComposite && !isCalculation && (
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

              {/* ── Output columns ───────────────────────────────── */}
              <OutputColumnsSection
                outputColumns={outputColumns}
                onAdd={addOutputColumn}
                onUpdate={updateOutputColumn}
                onRemove={removeOutputColumn}
              />

              {/* ── Live preview ─────────────────────────────────── */}
              <Section title="Generated Beam transform">
                <pre className="text-[13px] font-mono text-emerald-400 bg-muted/40 border border-border rounded-lg px-3.5 py-3 overflow-x-auto whitespace-pre leading-relaxed">
                  {preview}
                </pre>
              </Section>
            </>
          )}

          {isCalculation && (
            <>
              {/* ── Parameters ───────────────────────────────────── */}
              <Section
                title="Parameters"
                subtitle="optional"
                action={
                  <Button variant="ghost" size="xs" onClick={addParam} className="text-cyan-400 hover:text-cyan-300">
                    <Plus /> Add
                  </Button>
                }
              >
                {params.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">No parameters — the transform body is fixed.</p>
                ) : (
                  <div className="flex flex-col gap-2.5">
                    {params.map((p, i) => (
                      <div
                        key={i}
                        className="flex flex-col gap-2 bg-muted/40 border border-border rounded-lg p-2.5"
                      >
                        <div className="flex flex-wrap sm:flex-nowrap gap-2 items-center">
                          <Input
                            value={p.key}
                            onChange={(e) => updateParam(i, { key: e.target.value.replace(/\s/g, '') })}
                            placeholder="key"
                            className="w-full sm:w-28 font-mono"
                          />
                          <Input
                            value={p.label}
                            onChange={(e) => updateParam(i, { label: e.target.value })}
                            placeholder="Label"
                            className="flex-1 min-w-[120px]"
                          />
                          <Select
                            value={p.type}
                            onValueChange={(v) => updateParam(i, { type: v as SettingType })}
                          >
                            <SelectTrigger className="w-full sm:w-36">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {PARAM_TYPES.map((t) => (
                                <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => removeParam(i)}
                            title="Remove parameter"
                            className="flex-shrink-0 ml-auto text-muted-foreground hover:text-red-400 hover:bg-red-500/10"
                          >
                            <Trash2 />
                          </Button>
                        </div>

                        <div className="flex flex-wrap gap-2 items-center">
                          <Input
                            value={(p.defaultValue as string) ?? ''}
                            onChange={(e) => updateParam(i, { defaultValue: e.target.value })}
                            placeholder="Default value"
                            className="w-full sm:w-40"
                          />
                          {p.type === SettingType.Select && (
                            <Input
                              value={(p.options ?? []).map((o) => o.value).join(', ')}
                              onChange={(e) =>
                                updateParam(i, {
                                  options: e.target.value
                                    .split(',')
                                    .map((v) => v.trim())
                                    .filter(Boolean)
                                    .map((v) => ({ label: v, value: v })),
                                })
                              }
                              placeholder="Options: a, b, c"
                              className="flex-1 min-w-[160px] font-mono"
                            />
                          )}
                          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground whitespace-nowrap">
                            <input
                              type="checkbox"
                              checked={(p.validation ?? []).some((v) => v.type === 'required')}
                              onChange={(e) =>
                                updateParam(i, {
                                  validation: e.target.checked
                                    ? [...(p.validation ?? []), { type: 'required', message: `${p.label} is required.` }]
                                    : (p.validation ?? []).filter((v) => v.type !== 'required'),
                                })
                              }
                            />
                            required
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Section>

              {/* ── Logic ────────────────────────────────────────── */}
              <Section title="Logic">
                <Field
                  label="Group by (optional)"
                  hint="Comma-separated column names. When set, the generator groups records by these keys before running your body once per group — same as cortex's GroupByKey → DoFn pattern (e.g. CSI, Sum)."
                >
                  <Input
                    value={keyBy}
                    onChange={(e) => setKeyBy(e.target.value)}
                    placeholder="e.g. TargetGroupId, QuestionId"
                    className="font-mono"
                  />
                </Field>

                {keyBy.trim().length > 0 && (
                  <Field
                    label="Key mode"
                    hint={
                      keyByMode === 'first-present'
                        ? 'The columns above are an ordered priority list: the first one present on the record becomes the key (e.g. TargetGroupId if it exists, else QuestionId). Records with none of them raise an error at run time, and the editor flags the node if the input schema has none of them.'
                        : 'Records are keyed by the combination of ALL columns above. Every column must exist in the input schema.'
                    }
                  >
                    <Select value={keyByMode} onValueChange={(v) => setKeyByMode(v as KeyByMode)}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All columns — composite key</SelectItem>
                        <SelectItem value="first-present">First column present wins — fallback priority</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                )}

                <Field
                  label={
                    keyBy.trim()
                      ? <>Process body — over <code className="text-cyan-400 font-mono">key</code> and <code className="text-cyan-400 font-mono">records</code> (the grouped list)</>
                      : <>Process body — over <code className="text-cyan-400 font-mono">element</code></>
                  }
                  hint={<>Reference parameters with <code className="text-cyan-400 font-mono">{'{{key}}'}</code>. Build a dict and <code className="text-cyan-400 font-mono">yield</code> it — this is the row's/group's output.</>}
                >
                  <Textarea
                    value={processBody}
                    onChange={(e) => setProcessBody(e.target.value)}
                    rows={8}
                    spellCheck={false}
                    className="font-mono text-[13px] leading-relaxed resize-y min-h-[160px]"
                  />
                </Field>
              </Section>

              {/* ── Output columns ───────────────────────────────── */}
              <OutputColumnsSection
                outputColumns={outputColumns}
                onAdd={addOutputColumn}
                onUpdate={updateOutputColumn}
                onRemove={removeOutputColumn}
              />

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

/**
 * The "Output columns" editor — shared between calculation-kind and
 * expression-kind nodes so both declare their output schema the same way
 * (see CustomCalcSchemaNode, which consumes this declaration for any kind).
 */
function OutputColumnsSection({
  outputColumns,
  onAdd,
  onUpdate,
  onRemove,
}: {
  outputColumns: OutputColumnDecl[];
  onAdd: () => void;
  onUpdate: (i: number, patch: Partial<OutputColumnDecl>) => void;
  onRemove: (i: number) => void;
}) {
  return (
    <Section
      title="Output columns"
      subtitle="declares the schema downstream nodes see"
      action={
        <Button variant="ghost" size="xs" onClick={onAdd} className="text-cyan-400 hover:text-cyan-300">
          <Plus /> Add
        </Button>
      }
    >
      <div className="flex flex-col gap-2.5">
        {outputColumns.map((c, i) => (
          <div
            key={i}
            className="flex flex-wrap sm:flex-nowrap gap-2 items-center bg-muted/40 border border-border rounded-lg p-2"
          >
            <Select
              value={c.mode}
              onValueChange={(v) => onUpdate(i, { mode: v as OutputColumnMode })}
            >
              <SelectTrigger className="w-full sm:w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="passthrough-all">forward all input columns</SelectItem>
                <SelectItem value="passthrough">forward one input column</SelectItem>
                <SelectItem value="new">new column</SelectItem>
              </SelectContent>
            </Select>
            {c.mode !== 'passthrough-all' && (
              <Input
                value={c.name ?? ''}
                onChange={(e) => onUpdate(i, { name: e.target.value })}
                placeholder="Column name"
                className="flex-1 min-w-[120px] font-mono"
              />
            )}
            {c.mode === 'new' && (
              <Select
                value={c.type ?? ColumnDataType.STRING}
                onValueChange={(v) => onUpdate(i, { type: v as ColumnDataType })}
              >
                <SelectTrigger className="w-full sm:w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COLUMN_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => onRemove(i)}
              title="Remove column"
              className="flex-shrink-0 ml-auto text-muted-foreground hover:text-red-400 hover:bg-red-500/10"
            >
              <Trash2 />
            </Button>
          </div>
        ))}
      </div>
    </Section>
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
