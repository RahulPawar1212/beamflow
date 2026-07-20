/**
 * Filesystem loading of workflow / subflow JSON documents.
 *
 * Replaces the server's DB-backed `storage.get` + `resolveSubflowTree`: the CLI
 * reads a workflow JSON file, and resolves referenced subflows from sibling
 * `*.json` files in a directory, indexed by their `metadata.id`.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SerializedWorkflow } from '@beamflow/shared';
import type { ResolvedSubflowDoc, SubflowResolver } from '@beamflow/ir';

export function loadWorkflow(file: string): SerializedWorkflow {
  const raw = fs.readFileSync(file, 'utf8');
  return JSON.parse(raw) as SerializedWorkflow;
}

/**
 * Index every `*.json` in `dir` by its `metadata.id` so subflow references
 * resolve headlessly. Missing dir → empty index (a flat workflow needs none).
 */
export function loadSubflowIndex(dir: string | undefined): Map<string, SerializedWorkflow> {
  const index = new Map<string, SerializedWorkflow>();
  if (!dir || !fs.existsSync(dir)) return index;
  for (const entry of fs.readdirSync(dir)) {
    if (!entry.endsWith('.json')) continue;
    try {
      const doc = JSON.parse(fs.readFileSync(path.join(dir, entry), 'utf8')) as SerializedWorkflow;
      if (doc?.metadata?.id) index.set(doc.metadata.id, doc);
    } catch {
      // Skip unparseable files rather than aborting the whole run.
    }
  }
  return index;
}

/** A SubflowResolver backed by an in-memory id → document index. */
export function makeSubflowResolver(index: Map<string, SerializedWorkflow>): SubflowResolver {
  return (id: string): ResolvedSubflowDoc | undefined => {
    const doc = index.get(id);
    return doc ? { workflow: doc } : undefined;
  };
}
