// @vitest-environment jsdom
/**
 * Component (visual) tests for PropertyPanel — rendered in jsdom.
 *
 * These assert what the USER SEES, closing the gap the store-only tests can't:
 * that the Filter downstream of a subflow renders a real column <select>
 * (dropdown) populated with the subflow's output columns, rather than the
 * free-text "Field Name" input. This is the exact regression the user hit.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
import type { SerializedWorkflowDTO, NodeDef } from '../api/client';

// ── Mock API: only getPipeline (subflow child fetch) matters here ────────────
const child: SerializedWorkflowDTO = {
  schemaVersion: '1.0.0',
  metadata: { id: 'child_1', name: 'sub', isSubflow: true, createdAt: '', updatedAt: '' },
  nodes: [
    {
      id: 'c_csv',
      type: 'beamflow:csv-source',
      settings: {
        schemaColumns: [
          { name: 'GroupId', type: 'double', nullable: true },
          { name: 'VariableId', type: 'boolean', nullable: true },
        ],
      },
    } as any,
    { id: 'c_out', type: 'system:subflow-output', settings: { outputName: 'Output 1' } } as any,
  ],
  connections: [
    { id: 'ce', sourceNodeId: 'c_csv', sourcePortId: 'out', targetNodeId: 'c_out', targetPortId: 'in' } as any,
  ],
};

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>();
  return { ...actual, api: { ...actual.api, getPipeline: vi.fn(async () => child) } };
});

const { useWorkflowStore } = await import('../store/workflow-store');
const { useSchemaStore } = await import('../lib/schema-store');
const { PropertyPanel } = await import('./PropertyPanel');

// Node definitions the panel needs to render the Filter's settings form.
const FILTER_DEF: NodeDef = {
  type: 'beamflow:filter',
  name: 'Filter',
  category: 'transform',
  icon: 'filter',
  description: 'Filter records.',
  ports: [
    { id: 'in', name: 'In', direction: 'input' },
    { id: 'out', name: 'Out', direction: 'output' },
  ],
  settings: [
    { key: 'field', label: 'Field Name', type: 'text', group: 'Condition', order: 1, placeholder: 'age' },
    { key: 'value', label: 'Value', type: 'text', group: 'Condition', order: 3 },
  ],
} as any;
const SUBFLOW_DEF: NodeDef = {
  type: 'system:subflow', name: 'Subflow', category: 'custom', icon: 'boxes',
  description: 'A subflow.', ports: [{ id: 'out', name: 'Out', direction: 'output' }], settings: [],
} as any;

const parent: SerializedWorkflowDTO = {
  schemaVersion: '1.0.0',
  metadata: { id: 'parent_1', name: 'parent', createdAt: '', updatedAt: '' },
  nodes: [
    { id: 'sf', type: 'system:subflow', settings: { subflowId: 'child_1' } } as any,
    { id: 'flt', type: 'beamflow:filter', settings: {} } as any,
  ],
  connections: [
    { id: 'pe', sourceNodeId: 'sf', sourcePortId: 'out', targetNodeId: 'flt', targetPortId: 'in' } as any,
  ],
};

async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

beforeEach(() => {
  cleanup();
  useWorkflowStore.getState().clearWorkflow();
  useSchemaStore.getState().clearSchemas();
  useWorkflowStore.getState().setNodeDefinitions([SUBFLOW_DEF, FILTER_DEF]);
});

describe('PropertyPanel — Filter downstream of a subflow', () => {
  it('renders a column dropdown (not a text input) with the subflow output columns', async () => {
    useWorkflowStore.getState().loadWorkflow(parent);
    await flush();
    // Select the Filter, as clicking it on the canvas would.
    useWorkflowStore.getState().setSelectedNode('flt');

    render(<PropertyPanel />);

    // The Field Name control must be a <select> (combobox), and contain an
    // <option> per subflow output column plus the "-- Select Column --" prompt.
    await waitFor(() => {
      const combos = screen.getAllByRole('combobox');
      expect(combos.length).toBeGreaterThan(0);
    });

    const options = screen.getAllByRole('option').map((o) => o.textContent);
    expect(options.join(' | ')).toContain('GroupId');
    expect(options.join(' | ')).toContain('VariableId');
  });

  it('falls back to a text input when the Filter has no upstream schema', async () => {
    // Filter alone, no incoming edge → no columns → free-text field.
    useWorkflowStore.getState().loadWorkflow({
      ...parent,
      nodes: [{ id: 'flt', type: 'beamflow:filter', settings: {} } as any],
      connections: [],
    });
    await flush();
    useWorkflowStore.getState().setSelectedNode('flt');

    render(<PropertyPanel />);

    // The Field Name is a free-text input (placeholder "age"), NOT a dropdown.
    await waitFor(() => {
      expect(screen.getByPlaceholderText('age')).toBeInTheDocument();
    });
    expect(screen.queryByRole('combobox')).toBeNull();
  });
});
