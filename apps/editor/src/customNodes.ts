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

/**
 * A custom node definition. Either:
 *  - kind 'expression': a single expression-based transform, or
 *  - kind 'composite':  an ordered list of inner steps (from grouping).
 */
export interface CustomNodeDef {
  id: string;
  name: string;
  description: string;
  icon: string;
  kind: 'expression' | 'composite';

  // Expression kind
  operation?: CustomOperation;
  /** Python expression over `element`. May reference {{settingKey}} tokens. */
  expression?: string;
  settings?: CustomSetting[];

  // Composite kind
  steps?: CompositeStep[];

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
    settings: (def.settings || []).map((s, i) => ({
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

  // Expression kind
  const stepType = def.operation === 'FilterExpr' ? 'transform' : 'transform';
  return {
    operation: def.operation || 'MapExpr',
    stepType,
    params: {
      expression: resolveExpression(def.expression || 'element', settings),
    },
    imports: [],
  };
}

export function isCustomType(type: string): boolean {
  return type.startsWith(CUSTOM_NODE_PREFIX);
}
