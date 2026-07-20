import { describe, it, expect } from 'vitest';
import {
  deriveAutoParameters,
  mergeSubflowParameters,
  isAutoParamId,
} from './subflow-auto-params.js';
import type { AutoParamSettingLite, SettingDefsLookup } from './subflow-auto-params.js';
import type { ISubflowParameter } from './types.js';

const required = [{ type: 'required' }];

const setting = (key: string, overrides: Partial<AutoParamSettingLite> = {}): AutoParamSettingLite => ({
  key,
  label: `Label ${key}`,
  type: 'text',
  validation: required,
  ...overrides,
});

/** Lookup with one node type 'x' carrying the given settings. */
const lookup = (settings: AutoParamSettingLite[]): SettingDefsLookup => (t) =>
  t === 'x' ? settings : undefined;

describe('deriveAutoParameters', () => {
  it('derives a param for a required setting that is empty', () => {
    const params = deriveAutoParameters(
      [{ id: 'n1', type: 'x', settings: { field: '' } }],
      lookup([setting('field')]),
    );
    expect(params).toEqual([
      {
        id: 'auto_n1_field',
        name: 'Label field',
        type: 'string',
        targetNodeId: 'n1',
        targetSettingKey: 'field',
        required: true,
        options: undefined,
        defaultValue: undefined,
      },
    ]);
  });

  it('skips a required setting that has a value (incl. whitespace-only counts as empty)', () => {
    const defs = lookup([setting('field')]);
    expect(deriveAutoParameters([{ id: 'n1', type: 'x', settings: { field: 'age' } }], defs)).toEqual([]);
    expect(deriveAutoParameters([{ id: 'n1', type: 'x', settings: { field: '   ' } }], defs)).toHaveLength(1);
  });

  it('a non-empty defaultValue counts as filled', () => {
    const params = deriveAutoParameters(
      [{ id: 'n1', type: 'x', settings: {} }],
      lookup([setting('delimiter', { defaultValue: ',' })]),
    );
    expect(params).toEqual([]);
  });

  it('skips non-required settings even when empty', () => {
    const params = deriveAutoParameters(
      [{ id: 'n1', type: 'x', settings: {} }],
      lookup([setting('opt', { validation: [] }), setting('opt2', { validation: undefined })]),
    );
    expect(params).toEqual([]);
  });

  it('skips fixed settings', () => {
    const params = deriveAutoParameters(
      [{ id: 'n1', type: 'x', settings: {} }],
      lookup([setting('locked', { fixed: true })]),
    );
    expect(params).toEqual([]);
  });

  it('skips settings hidden by an unmet dependsOn, includes them when met', () => {
    const defs = lookup([setting('path', { dependsOn: { key: 'mode', value: 'file' } })]);
    expect(deriveAutoParameters([{ id: 'n1', type: 'x', settings: { mode: 'db' } }], defs)).toEqual([]);
    expect(deriveAutoParameters([{ id: 'n1', type: 'x', settings: { mode: 'file' } }], defs)).toHaveLength(1);
  });

  it('skips boundary nodes, subflowId keys, and unresolvable node types', () => {
    const defs: SettingDefsLookup = (t) =>
      t === 'unknown-type' ? undefined : [setting('subflowId'), setting('field')];
    const params = deriveAutoParameters(
      [
        { id: 'b1', type: 'system:subflow-input', settings: {} },
        { id: 'b2', type: 'system:subflow-output', settings: {} },
        { id: 'u1', type: 'unknown-type', settings: {} },
        { id: 'n1', type: 'x', settings: {} },
      ],
      defs,
    );
    expect(params.map((p) => p.id)).toEqual(['auto_n1_field']);
  });

  it('maps setting types to param types like togglePipelineParameter', () => {
    const params = deriveAutoParameters(
      [{ id: 'n1', type: 'x', settings: {} }],
      lookup([
        setting('a', { type: 'number' }),
        setting('b', { type: 'boolean' }),
        setting('c', { type: 'select', options: [{ label: 'CSV', value: 'csv' }] }),
        setting('d', { type: 'multi-select' }),
        setting('e', { type: 'expression' }),
      ]),
    );
    expect(params.map((p) => [p.targetSettingKey, p.type])).toEqual([
      ['a', 'number'],
      ['b', 'boolean'],
      ['c', 'enum'],
      ['d', 'enum'],
      ['e', 'string'],
    ]);
    expect(params[2].options).toEqual([{ label: 'CSV', value: 'csv' }]);
  });

  it('ids are deterministic — re-derivation yields identical params', () => {
    const nodes = [{ id: 'n1', type: 'x', settings: {} }];
    const defs = lookup([setting('field')]);
    expect(deriveAutoParameters(nodes, defs)).toEqual(deriveAutoParameters(nodes, defs));
  });
});

describe('mergeSubflowParameters', () => {
  const manual: ISubflowParameter = {
    id: 'param_abc123',
    name: 'Field',
    type: 'string',
    targetNodeId: 'n1',
    targetSettingKey: 'field',
  };
  const auto = (nodeId: string, key: string): ISubflowParameter => ({
    id: `auto_${nodeId}_${key}`,
    name: `Label ${key}`,
    type: 'string',
    targetNodeId: nodeId,
    targetSettingKey: key,
    required: true,
  });

  it('manual params win over auto params targeting the same setting', () => {
    const merged = mergeSubflowParameters([manual], [auto('n1', 'field'), auto('n2', 'other')]);
    expect(merged.map((p) => p.id)).toEqual(['param_abc123', 'auto_n2_other']);
  });

  it('strips stale auto params loaded from a previous save', () => {
    // A previously saved auto param whose target is now filled: it appears in
    // `manual` (loaded back from the doc) but NOT in the fresh derivation.
    const stale = auto('n1', 'field');
    const merged = mergeSubflowParameters([manual, stale], []);
    expect(merged).toEqual([manual]);
  });

  it('re-derived auto params keep their (stable) ids after a round-trip', () => {
    const first = mergeSubflowParameters([], [auto('n1', 'field')]);
    const second = mergeSubflowParameters(first, [auto('n1', 'field')]);
    expect(second).toEqual(first);
  });
});

describe('isAutoParamId', () => {
  it('distinguishes auto ids from manual ids', () => {
    expect(isAutoParamId('auto_n1_field')).toBe(true);
    expect(isAutoParamId('param_abc123')).toBe(false);
  });
});
