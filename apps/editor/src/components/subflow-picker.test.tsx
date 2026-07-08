// @vitest-environment jsdom
/**
 * Tests for Option C:
 *  (1) the palette hides system:subflow-input / -output but keeps system:subflow
 *  (2) selecting a system:subflow node renders a picker of the current project's
 *      subflows; choosing one sets subflowId and relabels the node.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import type { NodeDef, PipelineSummary } from '../api/client';

const PIPELINES: PipelineSummary[] = [
  { id: 'wf_regular', name: 'Regular WF', isSubflow: false, createdAt: '', updatedAt: '', nodeCount: 2, connectionCount: 1 },
  { id: 'sf_a', name: 'Subflow A', isSubflow: true, createdAt: '', updatedAt: '', nodeCount: 2, connectionCount: 1 },
  { id: 'sf_b', name: 'Subflow B', isSubflow: true, createdAt: '', updatedAt: '', nodeCount: 3, connectionCount: 2 },
  { id: 'self', name: 'This One', isSubflow: true, createdAt: '', updatedAt: '', nodeCount: 1, connectionCount: 0 },
];

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>();
  return {
    ...actual,
    api: { ...actual.api, listPipelines: vi.fn(async () => ({ pipelines: PIPELINES })), getPipeline: vi.fn(async () => { throw new Error('x'); }) },
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
  (api.listPipelines as any).mockClear();
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

describe('Subflow node picker', () => {
  function addSubflowNode() {
    useWorkflowStore.setState({
      nodes: [
        { id: 'sf', type: 'custom', position: { x: 0, y: 0 }, data: { nodeType: 'system:subflow', label: 'Subflow', category: 'custom', icon: 'boxes', settings: {} } } as any,
      ],
      pipelineId: 'self', // the workflow currently open (excluded from the picker)
    });
    useWorkflowStore.getState().setSelectedNode('sf');
  }

  it('lists only current-project subflows (excludes regular WFs and self)', async () => {
    addSubflowNode();
    render(<PropertyPanel />);

    // Picker is a combobox with the subflow options.
    await waitFor(() => expect(screen.getByRole('combobox')).toBeInTheDocument());
    const options = Array.from(screen.getByRole('combobox').querySelectorAll('option')).map((o) => o.textContent);
    expect(options).toContain('Subflow A');
    expect(options).toContain('Subflow B');
    expect(options).not.toContain('Regular WF'); // not a subflow
    expect(options).not.toContain('This One');   // self-reference excluded
  });

  it('picking a subflow sets subflowId and relabels the node', async () => {
    addSubflowNode();
    render(<PropertyPanel />);
    await waitFor(() => expect(screen.getByRole('combobox')).toBeInTheDocument());

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'sf_a' } });

    const node = useWorkflowStore.getState().nodes.find((n) => n.id === 'sf')!;
    expect(node.data.settings.subflowId).toBe('sf_a');
    expect(node.data.label).toBe('Subflow A');
  });

  it('fetched subflows with includeSubflows scoped to the current project', async () => {
    addSubflowNode();
    render(<PropertyPanel />);
    await waitFor(() => expect(api.listPipelines).toHaveBeenCalled());
    expect(api.listPipelines).toHaveBeenCalledWith('proj_1', true);
  });
});
