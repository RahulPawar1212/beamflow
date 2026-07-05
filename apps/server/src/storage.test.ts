import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SCHEMA_VERSION } from '@beamflow/shared';
import type { SerializedWorkflow } from '@beamflow/shared';
import { LocalJsonStorage } from './storage.js';

function makeWorkflow(id: string, name = 'WF'): SerializedWorkflow {
  const now = '2024-01-01T00:00:00.000Z';
  return {
    schemaVersion: SCHEMA_VERSION,
    metadata: { id, name, description: '', createdAt: now, updatedAt: now },
    nodes: [],
    connections: [],
  };
}

describe('LocalJsonStorage', () => {
  let dir: string;
  let storage: LocalJsonStorage;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'beamflow-storage-'));
    storage = new LocalJsonStorage(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('saves and retrieves a workflow (round-trip)', async () => {
    const wf = makeWorkflow('pipeline_1', 'My Pipeline');
    await storage.save(wf);
    const loaded = await storage.get('pipeline_1');
    expect(loaded).toEqual(wf);
  });

  it('returns null for a missing id', async () => {
    expect(await storage.get('nope')).toBeNull();
  });

  it('lists all saved workflows', async () => {
    await storage.save(makeWorkflow('a'));
    await storage.save(makeWorkflow('b'));
    const list = await storage.list();
    expect(list.map((w) => w.metadata.id).sort()).toEqual(['a', 'b']);
  });

  it('deletes a workflow and reports success/failure', async () => {
    await storage.save(makeWorkflow('gone'));
    expect(await storage.delete('gone')).toBe(true);
    expect(await storage.get('gone')).toBeNull();
    // Deleting again returns false (nothing to unlink).
    expect(await storage.delete('gone')).toBe(false);
  });

  it('skips corrupt JSON files when listing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await storage.save(makeWorkflow('good'));
    await writeFile(join(dir, 'broken.json'), '{ not valid json', 'utf-8');

    const list = await storage.list();
    expect(list.map((w) => w.metadata.id)).toEqual(['good']);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
