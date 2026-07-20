// @vitest-environment jsdom
/**
 * On-node settings summary: the compact configured-values view rendered on
 * canvas node cards. Pure row-building logic + the presentational component.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import {
  formatSummaryValue,
  buildSettingRows,
  buildParamRows,
  NodeSettingsSummary,
} from './CustomNodes';
import { TooltipProvider } from '../ui/tooltip';

describe('formatSummaryValue', () => {
  it('formats primitives and maps select values to option labels', () => {
    expect(formatSummaryValue('age')).toBe('age');
    expect(formatSummaryValue(7)).toBe('7');
    expect(formatSummaryValue(true)).toBe('On');
    expect(formatSummaryValue(false)).toBe('Off');
    expect(formatSummaryValue('csv', [{ label: 'CSV file', value: 'csv' }])).toBe('CSV file');
  });

  it('returns null for empty/unrenderable values', () => {
    expect(formatSummaryValue(undefined)).toBeNull();
    expect(formatSummaryValue(null)).toBeNull();
    expect(formatSummaryValue('   ')).toBeNull();
    expect(formatSummaryValue({ nested: true })).toBeNull();
  });

  it('renders arrays as item counts', () => {
    expect(formatSummaryValue([1, 2, 3])).toBe('3 items');
    expect(formatSummaryValue([1])).toBe('1 item');
  });
});

describe('buildSettingRows', () => {
  const defs = [
    { key: 'operator', label: 'Operator', type: 'select', order: 2, options: [{ label: 'equals', value: '==' }] },
    { key: 'field', label: 'Field', type: 'text', order: 1 },
    { key: 'subflowId', label: 'Subflow', type: 'text' },
    { key: 'empty', label: 'Empty', type: 'text' },
    { key: 'path', label: 'Path', type: 'text', dependsOn: { key: 'mode', value: 'file' } },
  ] as any[];

  it('joins values with defs, sorts by order, maps select labels, skips empty/subflowId', () => {
    const rows = buildSettingRows({ field: 'age', operator: '==', empty: '', mode: 'db', path: 'x' }, defs);
    expect(rows).toEqual([
      { key: 'field', label: 'Field', value: 'age' },
      { key: 'operator', label: 'Operator', value: 'equals' },
    ]);
  });

  it('uses defaultValue when the setting is unset', () => {
    const rows = buildSettingRows({}, [{ key: 'delimiter', label: 'Delimiter', type: 'text', defaultValue: ',' }] as any[]);
    expect(rows).toEqual([{ key: 'delimiter', label: 'Delimiter', value: ',' }]);
  });
});

describe('buildParamRows', () => {
  const params = [
    { id: 'auto_n1_field', name: 'Field', required: true },
    { id: 'param_fmt', name: 'Format', options: [{ label: 'CSV file', value: 'csv' }] },
    { id: 'param_opt', name: 'Optional' },
  ];

  it('marks unset required params as Missing, maps enum labels, skips unset optional ones', () => {
    const rows = buildParamRows({ param_fmt: 'csv' }, params);
    expect(rows).toEqual([
      { key: 'auto_n1_field', label: 'Field', value: 'Missing', missing: true },
      { key: 'param_fmt', label: 'Format', value: 'CSV file' },
    ]);
  });

  it('shows the value once a required param is filled', () => {
    const rows = buildParamRows({ auto_n1_field: 'age' }, params);
    expect(rows[0]).toEqual({ key: 'auto_n1_field', label: 'Field', value: 'age' });
  });
});

describe('NodeSettingsSummary', () => {
  const row = (i: number) => ({ key: `k${i}`, label: `Label${i}`, value: `v${i}` });

  it('renders nothing for zero rows', () => {
    const { container } = render(
      <TooltipProvider><NodeSettingsSummary rows={[]} /></TooltipProvider>,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders up to 3 rows plus a "+N more" overflow indicator', () => {
    render(
      <TooltipProvider>
        <NodeSettingsSummary rows={[row(1), row(2), row(3), row(4), row(5)]} />
      </TooltipProvider>,
    );
    expect(screen.getByText('Label1')).toBeTruthy();
    expect(screen.getByText('v3')).toBeTruthy();
    expect(screen.queryByText('Label4')).toBeNull();
    expect(screen.getByText('+2 more')).toBeTruthy();
  });

  it('renders a missing required value in red', () => {
    render(
      <TooltipProvider>
        <NodeSettingsSummary rows={[{ key: 'k', label: 'Field', value: 'Missing', missing: true }]} />
      </TooltipProvider>,
    );
    const el = screen.getByText('Missing');
    expect(el.className).toContain('text-red-400');
  });
});
