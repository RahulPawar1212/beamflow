import { describe, it, expect } from 'vitest';
import { resolveSubflowOutputs, resolveSubflowInputBoundary } from './subflow-outputs.js';

const n = (id: string, label?: string) => ({ id, label });
const e = (from: string, to: string) => ({ from, to });

describe('resolveSubflowOutputs', () => {
  it('0 outputs, single terminal → derives that terminal', () => {
    // A → B (B is the single terminal), no output node.
    const r = resolveSubflowOutputs([n('A'), n('B')], [], [e('A', 'B')]);
    expect(r.error).toBeUndefined();
    expect(r.outputs).toEqual([{ sourceId: 'B' }]);
  });

  it('0 outputs, single isolated node → derives it (it is the terminal)', () => {
    const r = resolveSubflowOutputs([n('A')], [], []);
    expect(r.error).toBeUndefined();
    expect(r.outputs).toEqual([{ sourceId: 'A' }]);
  });

  it('0 outputs, two terminals → ambiguity error naming a terminal', () => {
    // A → B, A → C : B and C are both terminals.
    const r = resolveSubflowOutputs([n('A'), n('B'), n('C')], [], [e('A', 'B'), e('A', 'C')]);
    expect(r.outputs).toEqual([]);
    expect(r.error?.nodeId).toBeDefined();
    expect(['B', 'C']).toContain(r.error!.nodeId);
    expect(r.error!.message).toMatch(/Subflow Output/i);
  });

  it('0 outputs, zero active nodes → error', () => {
    const r = resolveSubflowOutputs([], [], []);
    expect(r.outputs).toEqual([]);
    expect(r.error).toBeDefined();
  });

  it('explicit output, terminal wired to it → uses the explicit output', () => {
    // A → B → OUT
    const r = resolveSubflowOutputs([n('A'), n('B')], [n('OUT')], [e('A', 'B'), e('B', 'OUT')]);
    expect(r.error).toBeUndefined();
    expect(r.outputs).toEqual([{ sourceId: 'B', viaOutputNodeId: 'OUT' }]);
  });

  it('multi-output: two terminals each wired to their own output → both routings', () => {
    // A → B → OUT1 ; A → C → OUT2
    const r = resolveSubflowOutputs(
      [n('A'), n('B'), n('C')],
      [n('OUT1'), n('OUT2')],
      [e('A', 'B'), e('A', 'C'), e('B', 'OUT1'), e('C', 'OUT2')],
    );
    expect(r.error).toBeUndefined();
    expect(r.outputs).toEqual(
      expect.arrayContaining([
        { sourceId: 'B', viaOutputNodeId: 'OUT1' },
        { sourceId: 'C', viaOutputNodeId: 'OUT2' },
      ]),
    );
    expect(r.outputs).toHaveLength(2);
  });

  it('multi-output with one output deleted → orphan terminal error, valid output still routed', () => {
    // A → B → OUT1 ; A → C (C is a terminal with NO output — orphaned)
    const r = resolveSubflowOutputs(
      [n('A'), n('B'), n('C', 'Branch C')],
      [n('OUT1')],
      [e('A', 'B'), e('A', 'C'), e('B', 'OUT1')],
    );
    // The valid output is still routed (graceful) ...
    expect(r.outputs).toEqual([{ sourceId: 'B', viaOutputNodeId: 'OUT1' }]);
    // ... but the orphaned terminal is flagged by name.
    expect(r.error?.nodeId).toBe('C');
    expect(r.error!.message).toContain('Branch C');
  });
});

describe('resolveSubflowInputBoundary', () => {
  it('no external edge → never dangling, regardless of input node count', () => {
    expect(resolveSubflowInputBoundary(false, 0)).toEqual({ danglingExternalInput: false });
    expect(resolveSubflowInputBoundary(false, 2)).toEqual({ danglingExternalInput: false });
  });

  it('external edge + no Subflow Input node → dangling (subflow\'s own data wins silently otherwise)', () => {
    expect(resolveSubflowInputBoundary(true, 0)).toEqual({ danglingExternalInput: true });
  });

  it('external edge + at least one Subflow Input node → not dangling, data has somewhere to go', () => {
    expect(resolveSubflowInputBoundary(true, 1)).toEqual({ danglingExternalInput: false });
    expect(resolveSubflowInputBoundary(true, 2)).toEqual({ danglingExternalInput: false });
  });
});
