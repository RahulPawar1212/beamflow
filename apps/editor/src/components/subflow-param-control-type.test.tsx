// @vitest-environment jsdom
/**
 * Regression: ISubflowParameter.type ('string'|'number'|'boolean'|'enum') and
 * the setting-control's type ('text'|'number'|'boolean'|'select'|...) are
 * DIFFERENT enums. Mapping 'string' straight through used to match no
 * SettingControl branch at all — the label and required "*" rendered, but the
 * actual input/select never did, making the parameter look permanently
 * unfillable (label + red "*", no visible control to type into).
 *
 * This reproduces the exact real-world case: a calculation-kind custom node
 * ("CSI") with an unrenamed "Param 1" text setting, grouped into a subflow —
 * the auto-derived parameter must render a real, enabled, editable control.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { NodeDef, SerializedWorkflowDTO } from '../api/client';

const { useWorkflowStore } = await import('../store/workflow-store');
const { useSchemaStore } = await import('../lib/schema-store');
const { PropertyPanel } = await import('./PropertyPanel');

// Mirrors toNodeDef() output for a calculation-kind custom node whose author
// added params and left one at the modal's default label ("Param 1").
const CALC_DEF: NodeDef = {
  type: 'custom:csi123',
  name: 'CSI',
  category: 'custom',
  icon: 'sparkles',
  description: 'CSI calculation node',
  ports: [
    { id: 'in', name: 'Input', direction: 'input' },
    { id: 'out', name: 'Output', direction: 'output' },
  ],
  settings: [
    { key: 'param1', label: 'Param 1', type: 'text', defaultValue: '', validation: [{ type: 'required', message: 'Param 1 is required.' }] },
    { key: 'count', label: 'Count', type: 'number', defaultValue: undefined, validation: [{ type: 'required', message: 'Count is required.' }] },
    { key: 'flag', label: 'Flag', type: 'boolean', defaultValue: undefined, validation: [{ type: 'required', message: 'Flag is required.' }] },
    {
      key: 'mode', label: 'Mode', type: 'select', defaultValue: '',
      options: [{ label: 'Fast', value: 'fast' }, { label: 'Slow', value: 'slow' }],
      validation: [{ type: 'required', message: 'Mode is required.' }],
    },
  ],
} as any;

const SUBFLOW_DEF: NodeDef = {
  type: 'system:subflow', name: 'Subflow', category: 'custom', icon: 'boxes',
  description: 'A subflow.', ports: [{ id: 'out', name: 'Out', direction: 'output' }], settings: [],
} as any;

const child: SerializedWorkflowDTO = {
  schemaVersion: '1.0.0',
  metadata: { id: 'csi_sub', name: 'csi subflow', isSubflow: true, createdAt: '', updatedAt: '' },
  nodes: [
    { id: 'calc_node', type: 'custom:csi123', settings: {} } as any,
    { id: 'sub_out', type: 'system:subflow-output', settings: { outputName: 'Output 1' } } as any,
  ],
  connections: [
    { id: 'ce', sourceNodeId: 'calc_node', sourcePortId: 'out', targetNodeId: 'sub_out', targetPortId: 'in' } as any,
  ],
};

function rowFor(label: string): HTMLElement {
  return screen.getByText(label).closest('div')!.parentElement!;
}

beforeEach(() => {
  cleanup();
  useWorkflowStore.getState().clearWorkflow();
  useSchemaStore.getState().clearSchemas();
  useWorkflowStore.getState().setNodeDefinitions([SUBFLOW_DEF, CALC_DEF]);
  useWorkflowStore.getState().loadWorkflow({
    schemaVersion: '1.0.0',
    metadata: { id: 'parent_1', name: 'parent', createdAt: '', updatedAt: '' },
    nodes: [{ id: 'sf', type: 'system:subflow', settings: { subflowId: 'csi_sub' } } as any],
    connections: [],
  });
  // Seed the subflow cache directly (bypassing the network fetch) to isolate
  // the render/edit path from refreshSubflowCache's async round-trip.
  (useWorkflowStore as any).setState({ subflowCache: { csi_sub: child } });
  useWorkflowStore.getState().setSelectedNode('sf');
});

describe('Subflow parameter controls render the correct editable input per source type', () => {
  it('string param ("Param 1") renders an enabled text input, editable', () => {
    render(<PropertyPanel />);
    const input = rowFor('Param 1').querySelector('input[type="text"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.disabled).toBe(false);

    fireEvent.change(input, { target: { value: '7' } });
    const sfNode = useWorkflowStore.getState().nodes.find((n) => n.id === 'sf')!;
    expect(sfNode.data.settings.auto_calc_node_param1).toBe('7');
  });

  it('number param renders an enabled number input, editable', () => {
    render(<PropertyPanel />);
    const input = rowFor('Count').querySelector('input[type="number"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.disabled).toBe(false);

    fireEvent.change(input, { target: { value: '42' } });
    const sfNode = useWorkflowStore.getState().nodes.find((n) => n.id === 'sf')!;
    expect(sfNode.data.settings.auto_calc_node_count).toBe(42);
  });

  it('boolean param renders an enabled checkbox, editable', () => {
    render(<PropertyPanel />);
    const input = rowFor('Flag').querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.disabled).toBe(false);

    fireEvent.click(input);
    const sfNode = useWorkflowStore.getState().nodes.find((n) => n.id === 'sf')!;
    expect(sfNode.data.settings.auto_calc_node_flag).toBe(true);
  });

  it('enum param renders a select with the real options, editable', () => {
    render(<PropertyPanel />);
    const select = rowFor('Mode').querySelector('select') as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect(select.disabled).toBe(false);
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(
      expect.arrayContaining(['Fast', 'Slow']),
    );

    fireEvent.change(select, { target: { value: 'fast' } });
    const sfNode = useWorkflowStore.getState().nodes.find((n) => n.id === 'sf')!;
    expect(sfNode.data.settings.auto_calc_node_mode).toBe('fast');
  });
});
