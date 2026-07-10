import { describe, it, expect } from 'vitest';
import { validateGraphStructure } from './graph-validation.js';
import type { GraphPortLite } from './graph-validation.js';

const n = (id: string, type = 't') => ({ id, type });
const e = (sourceNodeId: string, targetNodeId: string, targetPortId = 'in') => ({
  sourceNodeId,
  targetNodeId,
  targetPortId,
});

describe('validateGraphStructure', () => {
  it('flags a node with no edges at all as an orphan warning', () => {
    const issues = validateGraphStructure([n('A'), n('B'), n('C')], [e('A', 'B')]);
    expect(issues).toEqual([
      { severity: 'warning', message: 'Node is not connected to any other node.', nodeId: 'C' },
    ]);
  });

  it('does not flag nodes that have at least one edge (incoming OR outgoing)', () => {
    const issues = validateGraphStructure([n('A'), n('B')], [e('A', 'B')]);
    expect(issues).toEqual([]);
  });

  it('empty graph → no issues', () => {
    expect(validateGraphStructure([], [])).toEqual([]);
  });

  it('skips the required-port check entirely when no port lookup is provided', () => {
    // B has an edge (not an orphan) but its required port is unconnected —
    // without a resolvePorts function, this must NOT be flagged.
    const issues = validateGraphStructure([n('A'), n('B', 'needs-input')], [e('A', 'B', 'wrong-port')]);
    expect(issues).toEqual([]);
  });

  it('flags a required input port with no matching edge', () => {
    const ports: GraphPortLite[] = [{ id: 'in', name: 'Input', direction: 'input', required: true }];
    const issues = validateGraphStructure(
      [n('A'), n('B', 'needs-input')],
      [e('A', 'B', 'some-other-port')],
      (type) => (type === 'needs-input' ? ports : undefined),
    );
    expect(issues).toEqual([
      { severity: 'error', message: 'Required input port "Input" is not connected.', nodeId: 'B' },
    ]);
  });

  it('does not flag a required input port that IS connected', () => {
    const ports: GraphPortLite[] = [{ id: 'in', name: 'Input', direction: 'input', required: true }];
    const issues = validateGraphStructure(
      [n('A'), n('B', 'needs-input')],
      [e('A', 'B', 'in')],
      (type) => (type === 'needs-input' ? ports : undefined),
    );
    expect(issues).toEqual([]);
  });

  it('does not flag a non-required input port left unconnected', () => {
    const ports: GraphPortLite[] = [{ id: 'in', name: 'Input', direction: 'input', required: false }];
    const issues = validateGraphStructure([n('A')], [], () => ports);
    // A is also an orphan here (no edges), so expect exactly that one issue —
    // no additional required-port error for the optional port.
    expect(issues).toEqual([
      { severity: 'warning', message: 'Node is not connected to any other node.', nodeId: 'A' },
    ]);
  });

  it('skips the required-port check for inline-IR (custom) nodes', () => {
    const ports: GraphPortLite[] = [{ id: 'in', name: 'Input', direction: 'input', required: true }];
    const issues = validateGraphStructure(
      [n('A'), { id: 'B', type: 'custom:x', hasInlineIR: true }],
      [e('A', 'B', 'wrong-port')],
      (type) => (type === 'custom:x' ? ports : undefined),
    );
    expect(issues).toEqual([]);
  });

  it('unknown node type (no ports resolved) is skipped by this check (a separate concern)', () => {
    const issues = validateGraphStructure([n('A'), n('B', 'unknown-type')], [e('A', 'B')], () => undefined);
    expect(issues).toEqual([]);
  });
});
