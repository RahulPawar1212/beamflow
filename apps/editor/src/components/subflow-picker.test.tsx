// @vitest-environment jsdom
/**
 * Tests for the shared-subflow-library feature:
 *  (1) the palette hides system:subflow-input / -output but keeps system:subflow
 *  (2) the Subflow node's picker collapses to a compact "Using: X" row + a
 *      Change/Choose… button; clicking it opens a modal with the searchable
 *      list of the user-GLOBAL subflow library (all projects), showing name +
 *      description + "used by N"; choosing one sets subflowId, relabels the
 *      node, and closes the modal; self is excluded.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent, within } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import type { NodeDef, PipelineSummary } from '../api/client';

// listSubflows returns the global library (subflows only, with usedByCount).
const SUBFLOWS: PipelineSummary[] = [
  { id: 'sf_a', name: 'Clean CSV', description: 'trim + dedupe', isSubflow: true, usedByCount: 2, createdAt: '', updatedAt: '', nodeCount: 2, connectionCount: 1 },
  { id: 'sf_b', name: 'Enrich', description: 'join lookups', isSubflow: true, usedByCount: 0, createdAt: '', updatedAt: '', nodeCount: 3, connectionCount: 2 },
  { id: 'self', name: 'This One', isSubflow: true, usedByCount: 0, createdAt: '', updatedAt: '', nodeCount: 1, connectionCount: 0 },
];

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      listSubflows: vi.fn(async () => ({ pipelines: SUBFLOWS })),
      getPipeline: vi.fn(async () => { throw new Error('x'); }),
    },
  };
});

const { useWorkflowStore } = await import('../store/workflow-store');
const { useSchemaStore } = await import('../lib/schema-store');
const { PropertyPanel } = await import('./PropertyPanel');
const { NodePalette } = await import('./NodePalette');
const { api } = await import('../api/client');

const SUBFLOW_DEF: NodeDef = {
  type: 'system:subflow', name: 'Subflow', category: 'custom', icon: 'boxes', description: 'A subflow.',
  ports: [{ id: 'in', name: 'In', direction: 'input' }, { id: 'out', name: 'Out', direction: 'output' }],
  settings: [{ key: 'subflowId', label: 'Subflow ID', type: 'text', fixed: true, required: true, group: 'Internal' }],
} as any;
const INPUT_DEF: NodeDef = { type: 'system:subflow-input', name: 'Subflow Input', category: 'source', icon: 'in', description: '', ports: [], settings: [] } as any;
const OUTPUT_DEF: NodeDef = { type: 'system:subflow-output', name: 'Subflow Output', category: 'output', icon: 'out', description: '', ports: [], settings: [] } as any;
const CSV_DEF: NodeDef = { type: 'beamflow:csv-source', name: 'CSV Source', category: 'source', icon: 'file', description: '', ports: [], settings: [] } as any;

beforeEach(() => {
  cleanup();
  useWorkflowStore.getState().clearWorkflow();
  useSchemaStore.getState().clearSchemas();
  useWorkflowStore.getState().setNodeDefinitions([SUBFLOW_DEF, INPUT_DEF, OUTPUT_DEF, CSV_DEF]);
  useWorkflowStore.getState().setCurrentProject('proj_1', 'Project 1');
  (api.listSubflows as any).mockClear();
});

describe('NodePalette hides subflow boundary nodes', () => {
  it('shows Subflow but not Subflow Input / Subflow Output', async () => {
    render(<ReactFlowProvider><NodePalette /></ReactFlowProvider>);
    expect(screen.getByText('Subflow')).toBeInTheDocument();
    expect(screen.getByText('CSV Source')).toBeInTheDocument();
    expect(screen.queryByText('Subflow Input')).toBeNull();
    expect(screen.queryByText('Subflow Output')).toBeNull();
  });
});

describe('Subflow picker (shared library)', () => {
  function addSubflowNode() {
    useWorkflowStore.setState({
      nodes: [
        { id: 'sf', type: 'custom', position: { x: 0, y: 0 }, data: { nodeType: 'system:subflow', label: 'Subflow', category: 'custom', icon: 'boxes', settings: {} } } as any,
      ],
      pipelineId: 'self', // the workflow currently open (excluded from the picker)
    });
    useWorkflowStore.getState().setSelectedNode('sf');
  }

  it('collapsed state shows a "Choose…" button and no list until opened', async () => {
    addSubflowNode();
    render(<PropertyPanel />);

    expect(screen.getByText('No subflow selected')).toBeInTheDocument();
    expect(screen.getByText('Choose…')).toBeInTheDocument();
    expect(screen.queryByText('Clean CSV')).toBeNull();
    expect(screen.queryByPlaceholderText('Search subflows…')).toBeNull();
    // The list is not fetched until the modal opens.
    expect(api.listSubflows).not.toHaveBeenCalled();
  });

  it('opening the modal lists global subflows with description + used-by, excludes self', async () => {
    addSubflowNode();
    render(<PropertyPanel />);

    fireEvent.click(screen.getByText('Choose…'));
    await waitFor(() => expect(screen.getByText('Clean CSV')).toBeInTheDocument());
    expect(screen.getByText('Enrich')).toBeInTheDocument();
    expect(screen.getByText('trim + dedupe')).toBeInTheDocument(); // description shown
    expect(screen.getByText('used by 2')).toBeInTheDocument();      // usage count shown
    expect(screen.queryByText('This One')).toBeNull();              // self excluded
    // Fetched from the GLOBAL library (not project-scoped).
    expect(api.listSubflows).toHaveBeenCalled();
  });

  it('search filters the list', async () => {
    addSubflowNode();
    render(<PropertyPanel />);
    fireEvent.click(screen.getByText('Choose…'));
    await waitFor(() => expect(screen.getByText('Clean CSV')).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText('Search subflows…'), { target: { value: 'enrich' } });
    expect(screen.queryByText('Clean CSV')).toBeNull();
    expect(screen.getByText('Enrich')).toBeInTheDocument();
  });

  it('picking a subflow sets subflowId, relabels the node, and closes the modal', async () => {
    addSubflowNode();
    render(<PropertyPanel />);
    fireEvent.click(screen.getByText('Choose…'));
    await waitFor(() => expect(screen.getByText('Clean CSV')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Clean CSV'));

    const node = useWorkflowStore.getState().nodes.find((n) => n.id === 'sf')!;
    expect(node.data.settings.subflowId).toBe('sf_a');
    expect(node.data.label).toBe('Clean CSV');

    // Modal closes and the collapsed row now shows the selection.
    await waitFor(() => expect(screen.queryByPlaceholderText('Search subflows…')).toBeNull());
    expect(await screen.findByText('Clean CSV')).toBeInTheDocument(); // in the collapsed "Using:" row
    expect(screen.getByText('Change')).toBeInTheDocument();
  });
});
