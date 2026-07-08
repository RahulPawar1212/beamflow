// @vitest-environment jsdom
/**
 * Tests the Subflow Library modal: lists the global subflow library, opens a
 * subflow, and deletes one — with a "used by N" confirmation guard.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent, within } from '@testing-library/react';
import type { PipelineSummary } from '../api/client';

const SUBFLOWS: PipelineSummary[] = [
  { id: 'sf_a', name: 'Clean CSV', description: 'trim + dedupe', isSubflow: true, usedByCount: 2, createdAt: '', updatedAt: '', nodeCount: 2, connectionCount: 1 },
  { id: 'sf_b', name: 'Enrich', description: 'joins', isSubflow: true, usedByCount: 0, createdAt: '', updatedAt: '', nodeCount: 3, connectionCount: 2 },
];

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      listSubflows: vi.fn(async () => ({ pipelines: SUBFLOWS })),
      deletePipeline: vi.fn(async () => undefined),
    },
  };
});

const { SubflowLibraryModal } = await import('./Toolbar');
const { api } = await import('../api/client');

beforeEach(() => {
  cleanup();
  (api.listSubflows as any).mockClear();
  (api.deletePipeline as any).mockClear();
  vi.restoreAllMocks();
});

describe('SubflowLibraryModal', () => {
  it('lists the global library with descriptions + used-by', async () => {
    render(<SubflowLibraryModal onClose={() => {}} onOpen={() => {}} />);
    await waitFor(() => expect(screen.getByText('Clean CSV')).toBeInTheDocument());
    expect(screen.getByText('Enrich')).toBeInTheDocument();
    expect(screen.getByText('trim + dedupe')).toBeInTheDocument();
    expect(screen.getByText('used by 2')).toBeInTheDocument();
    expect(screen.getByText('unused')).toBeInTheDocument();
    expect(api.listSubflows).toHaveBeenCalled();
  });

  it('clicking a row opens the subflow', async () => {
    const onOpen = vi.fn();
    render(<SubflowLibraryModal onClose={() => {}} onOpen={onOpen} />);
    await waitFor(() => expect(screen.getByText('Enrich')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Enrich'));
    expect(onOpen).toHaveBeenCalledWith('sf_b');
  });

  it('deleting a referenced subflow warns with the used-by count, then deletes on confirm', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<SubflowLibraryModal onClose={() => {}} onOpen={() => {}} />);
    await waitFor(() => expect(screen.getByText('Clean CSV')).toBeInTheDocument());

    // The delete button lives in the "Clean CSV" row.
    const row = screen.getByText('Clean CSV').closest('div.group') as HTMLElement;
    fireEvent.click(within(row).getByTitle('Delete subflow'));

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('used by 2'));
    await waitFor(() => expect(api.deletePipeline).toHaveBeenCalledWith('sf_a'));
    // Removed from the list.
    await waitFor(() => expect(screen.queryByText('Clean CSV')).toBeNull());
  });

  it('cancelling the confirm does not delete', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<SubflowLibraryModal onClose={() => {}} onOpen={() => {}} />);
    await waitFor(() => expect(screen.getByText('Enrich')).toBeInTheDocument());
    const row = screen.getByText('Enrich').closest('div.group') as HTMLElement;
    fireEvent.click(within(row).getByTitle('Delete subflow'));
    expect(api.deletePipeline).not.toHaveBeenCalled();
  });
});
