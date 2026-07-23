/**
 * Custom (user-authored) node definitions.
 *
 * A custom node is a reusable PTransform that the user builds in the editor —
 * either a single expression-based transform (Phase 1) or a saved subgraph of
 * existing nodes (Phase 2, "composite"). Definitions are stored in the browser
 * (localStorage); when a pipeline is saved, each custom-node *instance* carries
 * its compiled IR (`inlineIR`) so the server can generate code without knowing
 * the definition (see store `toWorkflow`).
 */

import type { NodeDef } from './api/client';
import type { ISettingDefinition } from '@beamflow/shared';
import type { ColumnDataType } from '@beamflow/schema';

const STORAGE_KEY = 'beamflow.customNodes';
export const CUSTOM_NODE_PREFIX = 'custom:';

/** The Beam operation a simple custom node maps to. */
export type CustomOperation = 'MapExpr' | 'FilterExpr' | 'FlatMapExpr';

/** A user-declared setting exposed on a custom node's property panel. */
export interface CustomSetting {
  key: string;
  label: string;
  type: 'text' | 'number' | 'boolean';
  defaultValue?: string;
  placeholder?: string;
}

/** One inner step of a composite custom node. */
export interface CompositeStep {
  operation: string;
  stepType: string;
  params: Record<string, unknown>;
  imports?: string[];
  label?: string;
}

/** How a calculation node's declared output column relates to its input. */
export type OutputColumnMode = 'passthrough-all' | 'passthrough' | 'new';

/**
 * A single output column declared by a calculation node's author. `name` and
 * `type` may reference `{{paramKey}}` tokens (resolved against the node
 * instance's settings) so a parameter can drive the schema, e.g. an
 * `outputName` setting naming the produced column.
 */
export interface OutputColumnDecl {
  mode: OutputColumnMode;
  /** Column name (for 'passthrough' / 'new'); ignored for 'passthrough-all'. */
  name?: string;
  type?: ColumnDataType;
  nullable?: boolean;
}

/**
 * How group-by key columns are interpreted:
 *  - 'all':            key by the tuple of ALL listed columns (default).
 *  - 'first-present':  the columns are an ordered PRIORITY list — the first
 *                      column with a non-null value on the record becomes the
 *                      key (cortex's `element.get('TargetGroupId',
 *                      element['QuestionId'])` fallback-keying pattern). The
 *                      generated code raises ValueError when none are present.
 */
export type KeyByMode = 'all' | 'first-present';

/** Structured group-by declaration for a calculation node. */
export interface KeyBySpec {
  columns: string[];
  mode: KeyByMode;
}

/**
 * Group-by declaration — either the legacy plain column list (implies
 * mode 'all') or the structured {columns, mode} form. Normalize with
 * {@link normalizeKeyBy} before use.
 */
export type KeyByDecl = string[] | KeyBySpec;

/** Normalize either KeyByDecl shape to the structured form. */
export function normalizeKeyBy(keyBy?: KeyByDecl): KeyBySpec {
  if (!keyBy) return { columns: [], mode: 'all' };
  if (Array.isArray(keyBy)) return { columns: keyBy, mode: 'all' };
  return { columns: keyBy.columns ?? [], mode: keyBy.mode ?? 'all' };
}

/** The Python transform body for a calculation-kind custom node. */
export interface CalculationTransform {
  /**
   * Optional group-by key column(s). When set, the generated PTransform keys
   * elements by these columns and groups before running `processBody` once
   * per group (over the list of records); when omitted, `processBody` runs
   * once per element. See {@link KeyByDecl} for the two accepted shapes.
   */
  keyBy?: KeyByDecl;
  /**
   * Body of a `DoFn.process(self, element)` method (or, when `keyBy` is set,
   * `process(self, key, records)`). Must `yield` one or more output dicts.
   * May reference exposed settings via {{settingKey}} tokens.
   */
  processBody: string;
  imports?: string[];
}

/**
 * A custom node definition. One of:
 *  - kind 'expression':   a single expression-based transform,
 *  - kind 'composite':    an ordered list of inner steps (from grouping), or
 *  - kind 'calculation':  a full DoFn-level PTransform with rich params and
 *                         a user-declared output schema (the cortex-style
 *                         "calculation node" — see blueprint/calculations).
 */
export interface CustomNodeDef {
  id: string;
  name: string;
  description: string;
  icon: string;
  kind: 'expression' | 'composite' | 'calculation';

  // Expression kind
  operation?: CustomOperation;
  /** Python expression over `element`. May reference {{settingKey}} tokens. */
  expression?: string;
  settings?: CustomSetting[];

  // Composite kind
  steps?: CompositeStep[];

  // Calculation kind
  /** Full parameter model (dropdowns, validation, groups, dependsOn, …). */
  params?: ISettingDefinition[];
  transform?: CalculationTransform;
  outputColumns?: OutputColumnDecl[];

  createdAt: string;
}

/** localStorage-backed CRUD ─────────────────────────────────────────── */

export function loadCustomNodes(): CustomNodeDef[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CustomNodeDef[]) : [];
  } catch {
    return [];
  }
}

export function saveCustomNodes(defs: CustomNodeDef[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(defs));
  } catch (err) {
    console.error('Failed to persist custom nodes:', err);
  }
}

/** Compile a CustomNodeDef into a palette/property-panel NodeDef. */
export function toNodeDef(def: CustomNodeDef): NodeDef {
  return {
    type: def.id, // already prefixed with CUSTOM_NODE_PREFIX
    name: def.name,
    description: def.description,
    category: 'custom',
    icon: def.icon || 'box',
    version: '1.0.0',
    tags: ['custom'],
    ports: [
      { id: 'in', name: 'Input', direction: 'input', dataType: 'record', required: false },
      { id: 'out', name: 'Output', direction: 'output', dataType: 'record', required: false },
    ],
    // Calculation nodes carry the full ISettingDefinition surface (groups,
    // options, validation, dependsOn) straight through — PropertyPanel
    // already renders that model for built-ins, so it works unmodified here.
    // Each param is spread into a plain mutable object (ISettingDefinition's
    // fields are readonly; NodeSettingDef's are not) so the array satisfies
    // NodeSettingDef[] structurally.
    settings:
      def.kind === 'calculation'
        ? (def.params || []).map((p) => ({
            ...p,
            options: p.options ? [...p.options] : undefined,
            validation: p.validation ? [...p.validation] : undefined,
          }))
        : (def.settings || []).map((s, i) => ({
            key: s.key,
            label: s.label,
            type: s.type,
            defaultValue: s.defaultValue,
            placeholder: s.placeholder,
            order: i,
          })),
  };
}

/**
 * Substitute {{settingKey}} tokens in an expression with the instance's
 * current setting values. Missing values become empty strings.
 */
export function resolveExpression(
  expression: string,
  settings: Record<string, unknown>,
): string {
  return expression.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => {
    const v = settings[key];
    return v === undefined || v === null ? '' : String(v);
  });
}

/** Shape matching shared's InlineIRStep (kept local to avoid a workspace dep). */
export interface InlineIR {
  operation: string;
  stepType: string;
  params: Record<string, unknown>;
  imports?: string[];
  label?: string;
  inputRefs?: number[];
}

/**
 * Compile a custom node instance (definition + its current settings) into the
 * inline IR embedded in the saved pipeline.
 */
export function compileInlineIR(
  def: CustomNodeDef,
  settings: Record<string, unknown>,
): InlineIR | InlineIR[] {
  if (def.kind === 'composite') {
    return (def.steps || []).map((s) => ({
      operation: s.operation,
      stepType: s.stepType,
      params: s.params,
      imports: s.imports,
      label: s.label,
    }));
  }

  if (def.kind === 'calculation') {
    const transform = def.transform || { processBody: 'yield element' };
    const keySpec = normalizeKeyBy(transform.keyBy);
    return {
      operation: 'PyTransform',
      stepType: 'transform',
      params: {
        processBody: resolveExpression(transform.processBody, settings),
        // Flattened for the IR/generator: the column list plus how to apply it
        // ('all' = composite key of every column; 'first-present' = ordered
        // fallback, cortex-style).
        keyBy: keySpec.columns,
        keyByMode: keySpec.mode,
      },
      imports: transform.imports || [],
    };
  }

  // Expression kind
  return {
    operation: def.operation || 'MapExpr',
    stepType: 'transform',
    params: {
      expression: resolveExpression(def.expression || 'element', settings),
    },
    imports: [],
  };
}

export function isCustomType(type: string): boolean {
  return type.startsWith(CUSTOM_NODE_PREFIX);
}
