// @vitest-environment jsdom
/**
 * While editing a subflow document, PropertyPanel used to show a link/unlink
 * toggle next to EVERY setting so the user could manually expose it as a
 * subflow parameter. For a REQUIRED setting this was redundant and confusing:
 * required-but-empty settings are ALWAYS auto-exposed (deriveAutoParameters),
 * regardless of whether anyone ever clicks the link icon, and un-toggling it
 * did nothing (the next sync just re-derived it). The toggle is now hidden
 * for required settings — replaced by a small "Auto" indicator — and stays
 * for optional ones the author wants to expose voluntarily.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import type { NodeDef } from '../api/client';

const { useWorkflowStore } = await import('../store/workflow-store');
const { useSchemaStore } = await import('../lib/schema-store');
const { PropertyPanel } = await import('./PropertyPanel');

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
    {
      key: 'field', label: 'Field Name', type: 'text', group: 'Condition', order: 1,
      validation: [{ type: 'required', message: 'Field Name is required.' }],
    },
    { key: 'comment', label: 'Comment', type: 'text', group: 'Condition', order: 2 },
  ],
} as any;

function loadSubflowWithFilter() {
  useWorkflowStore.getState().loadWorkflow({
    schemaVersion: '1.0.0',
    metadata: { id: 'sf_1', name: 'sub', isSubflow: true, createdAt: '', updatedAt: '' } as any,
    nodes: [{ id: 'flt', type: 'beamflow:filter', settings: {} } as any],
    connections: [],
  });
  useWorkflowStore.getState().setSelectedNode('flt');
}

beforeEach(() => {
  cleanup();
  useWorkflowStore.getState().clearWorkflow();
  useSchemaStore.getState().clearSchemas();
  useWorkflowStore.getState().setNodeDefinitions([FILTER_DEF]);
});

describe('PropertyPanel — link-to-expose toggle inside a subflow document', () => {
  it('hides the manual expose toggle for a required setting, showing an "Auto" indicator instead', () => {
    loadSubflowWithFilter();
    render(<PropertyPanel />);

    // Scope to the "Field Name" (required) setting's own label row.
    const fieldRow = screen.getByText('Field Name').closest('label')!;
    expect(within(fieldRow).queryByTitle('Expose as parameter on Subflow node')).toBeNull();
    expect(within(fieldRow).getByText('Auto')).toBeInTheDocument();
  });

  it('keeps the manual expose toggle for a non-required setting, with no Auto badge', () => {
    loadSubflowWithFilter();
    render(<PropertyPanel />);

    // Scope to the "Comment" (optional) setting's own label row.
    const commentRow = screen.getByText('Comment').closest('label')!;
    expect(within(commentRow).getByTitle('Expose as parameter on Subflow node')).toBeInTheDocument();
    expect(within(commentRow).queryByText('Auto')).toBeNull();
  });

  it('does not show the toggle or the Auto badge outside a subflow document', () => {
    // Same Filter, but NOT a subflow (isSubflow: false/absent) — no manual
    // exposure applies at all here.
    useWorkflowStore.getState().loadWorkflow({
      schemaVersion: '1.0.0',
      metadata: { id: 'p_1', name: 'plain', createdAt: '', updatedAt: '' } as any,
      nodes: [{ id: 'flt', type: 'beamflow:filter', settings: {} } as any],
      connections: [],
    });
    useWorkflowStore.getState().setSelectedNode('flt');
    render(<PropertyPanel />);

    expect(screen.queryByTitle('Expose as parameter on Subflow node')).toBeNull();
    expect(screen.queryByText('Auto')).toBeNull();
  });
});
