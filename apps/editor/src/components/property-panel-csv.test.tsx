// @vitest-environment jsdom
/**
 * Reproduces the reported bug: a plain CSV Source -> Filter (NO subflow) where
 * the Filter's Field Name renders as a free-text input instead of a column
 * dropdown, even though the CSV source has schemaColumns.
 *
 * Covers several orderings the user might perform, because the incremental
 * schema paths (onEdgeAdded / onNodeSettingsChanged) behave differently from a
 * full syncFromWorkflow.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import type { SerializedWorkflowDTO, NodeDef } from '../api/client';

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>();
  return { ...actual, api: { ...actual.api, getPipeline: vi.fn(async () => { throw new Error('no subflow'); }) } };
});

const { useWorkflowStore } = await import('../store/workflow-store');
const { useSchemaStore } = await import('../lib/schema-store');
const { PropertyPanel } = await import('./PropertyPanel');

const CSV_DEF: NodeDef = {
  type: 'beamflow:csv-source', name: 'CSV Source', category: 'source', icon: 'file',
  description: 'Read CSV.', ports: [{ id: 'out', name: 'Out', direction: 'output' }], settings: [],
} as any;
const FILTER_DEF: NodeDef = {
  type: 'beamflow:filter', name: 'Filter', category: 'transform', icon: 'filter', description: 'Filter.',
  ports: [{ id: 'in', name: 'In', direction: 'input' }, { id: 'out', name: 'Out', direction: 'output' }],
  settings: [{ key: 'field', label: 'Field Name', type: 'text', group: 'Condition', order: 1, placeholder: 'age' }],
} as any;

const COLS = [
  { name: 'TargetGroupId', type: 'double', nullable: true },
  { name: 'GroupId', type: 'double', nullable: true },
  { name: 'VariableId', type: 'boolean', nullable: true },
];

async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  for (let i = 0; i < 10; i++) await Promise.resolve();
}
function idOf(t: string) {
  return useWorkflowStore.getState().nodes.find((n) => n.data.nodeType === t)!.id;
}
function fieldNameIsDropdown(): boolean {
  return screen.queryByRole('combobox') !== null;
}

beforeEach(() => {
  cleanup();
  useWorkflowStore.getState().clearWorkflow();
  useSchemaStore.getState().clearSchemas();
  useWorkflowStore.getState().setNodeDefinitions([CSV_DEF, FILTER_DEF]);
});

describe('PropertyPanel — CSV Source -> Filter (no subflow)', () => {
  it('loadWorkflow: Filter shows a column dropdown', async () => {
    useWorkflowStore.getState().loadWorkflow({
      schemaVersion: '1.0.0',
      metadata: { id: 'p', name: 'p', createdAt: '', updatedAt: '' },
      nodes: [
        { id: 'csv', type: 'beamflow:csv-source', settings: { schemaColumns: COLS } } as any,
        { id: 'flt', type: 'beamflow:filter', settings: {} } as any,
      ],
      connections: [
        { id: 'e', sourceNodeId: 'csv', sourcePortId: 'out', targetNodeId: 'flt', targetPortId: 'in' } as any,
      ],
    } as SerializedWorkflowDTO);
    await flush();
    useWorkflowStore.getState().setSelectedNode('flt');
    render(<PropertyPanel />);
    await waitFor(() => expect(screen.getByText('Field Name')).toBeInTheDocument());
    expect(fieldNameIsDropdown()).toBe(true);
  });

  it('interactive: add csv, add filter, connect, THEN set schemaColumns → dropdown updates', async () => {
    const s = useWorkflowStore.getState();
    s.addNode('beamflow:csv-source', { x: 0, y: 0 });
    s.addNode('beamflow:filter', { x: 300, y: 0 });
    await flush();
    const csv = idOf('beamflow:csv-source');
    const flt = idOf('beamflow:filter');
    s.onConnect({ source: csv, target: flt, sourceHandle: 'out', targetHandle: 'in' } as any);
    await flush();
    // Columns arrive AFTER the edge (e.g. CSV auto-detect on file pick).
    s.updateNodeSettings(csv, { schemaColumns: COLS });
    await flush();

    useWorkflowStore.getState().setSelectedNode(flt);
    render(<PropertyPanel />);
    await waitFor(() => expect(screen.getByText('Field Name')).toBeInTheDocument());
    expect(fieldNameIsDropdown()).toBe(true);
  });

  it('interactive: set schemaColumns BEFORE connecting → dropdown appears after connect', async () => {
    const s = useWorkflowStore.getState();
    s.addNode('beamflow:csv-source', { x: 0, y: 0 });
    await flush();
    const csv = idOf('beamflow:csv-source');
    s.updateNodeSettings(csv, { schemaColumns: COLS });
    s.addNode('beamflow:filter', { x: 300, y: 0 });
    await flush();
    const flt = idOf('beamflow:filter');
    s.onConnect({ source: csv, target: flt, sourceHandle: 'out', targetHandle: 'in' } as any);
    await flush();

    useWorkflowStore.getState().setSelectedNode(flt);
    render(<PropertyPanel />);
    await waitFor(() => expect(screen.getByText('Field Name')).toBeInTheDocument());
    expect(fieldNameIsDropdown()).toBe(true);
  });
});
