// @vitest-environment jsdom
/**
 * Component test for the exact reported structure: a Filter downstream of a
 * subflow whose child is sql-source → subflow-output, with a duplicate proxy-out
 * edge in the parent. Asserts the RENDERED PropertyPanel shows a column dropdown.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import type { SerializedWorkflowDTO, NodeDef } from '../api/client';

const child: SerializedWorkflowDTO = {
  schemaVersion: '1.0.0',
  metadata: { id: 'child_q', name: 'child', isSubflow: true, createdAt: '', updatedAt: '' },
  nodes: [
    {
      id: 'sql', type: 'beamflow:sql-source',
      settings: { schemaColumns: [
        { name: 'RespondentId', type: 'integer', nullable: true },
        { name: 'Answer', type: 'string', nullable: true },
      ] },
    } as any,
    { id: 'sout', type: 'system:subflow-output', settings: { outputName: 'Output 1' } } as any,
  ],
  connections: [{ id: 'ce', sourceNodeId: 'sql', sourcePortId: 'out', targetNodeId: 'sout', targetPortId: 'in' } as any],
};

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>();
  return { ...actual, api: { ...actual.api, getPipeline: vi.fn(async () => child) } };
});

const { useWorkflowStore } = await import('../store/workflow-store');
const { useSchemaStore } = await import('../lib/schema-store');
const { PropertyPanel } = await import('./PropertyPanel');

const FILTER_DEF: NodeDef = {
  type: 'beamflow:filter', name: 'Filter', category: 'transform', icon: 'filter', description: 'Filter.',
  ports: [{ id: 'in', name: 'In', direction: 'input' }, { id: 'out', name: 'Out', direction: 'output' }],
  settings: [{ key: 'field', label: 'Field Name', type: 'text', group: 'Condition', order: 1, placeholder: 'age' }],
} as any;

async function flush() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

beforeEach(() => {
  cleanup();
  useWorkflowStore.getState().clearWorkflow();
  useSchemaStore.getState().clearSchemas();
  useWorkflowStore.getState().setNodeDefinitions([
    { type: 'system:subflow', name: 'Subflow', category: 'custom', icon: 'boxes', ports: [], settings: [] } as any,
    FILTER_DEF,
    { type: 'beamflow:csv-output', name: 'CSV Output', category: 'output', icon: 'out', ports: [], settings: [] } as any,
  ]);
});

describe('PropertyPanel — Filter downstream of a sql-source subflow', () => {
  it('renders a column dropdown with the subflow columns', async () => {
    useWorkflowStore.getState().loadWorkflow({
      schemaVersion: '1.0.0',
      metadata: { id: 'parent_y', name: 'parent', isSubflow: false, createdAt: '', updatedAt: '' },
      nodes: [
        { id: 'flt', type: 'beamflow:filter', settings: {} } as any,
        { id: 'out', type: 'beamflow:csv-output', settings: {} } as any,
        { id: 'sf', type: 'system:subflow', settings: { subflowId: 'child_q' } } as any,
      ],
      connections: [
        { id: 'e1', sourceNodeId: 'sf', sourcePortId: 'Output 1', targetNodeId: 'flt', targetPortId: 'in' } as any,
        { id: 'e2', sourceNodeId: 'sf', sourcePortId: 'out', targetNodeId: 'flt', targetPortId: 'in' } as any,
        { id: 'e3', sourceNodeId: 'flt', sourcePortId: 'out', targetNodeId: 'out', targetPortId: 'in' } as any,
      ],
    } as SerializedWorkflowDTO);
    await flush();
    useWorkflowStore.getState().setSelectedNode('flt');

    render(<PropertyPanel />);
    await waitFor(() => expect(screen.getByText('Field Name')).toBeInTheDocument());

    expect(screen.queryByRole('combobox')).not.toBeNull();
    const optionTexts = screen.getAllByRole('option').map((o) => o.textContent || '');
    const joined = optionTexts.join(' | ');
    expect(joined).toContain('RespondentId');
    expect(joined).toContain('Answer');
    // The duplicate proxy→filter edge must NOT list columns twice.
    const respondentCount = optionTexts.filter((t) => t.includes('RespondentId')).length;
    expect(respondentCount).toBe(1);
  });
});
