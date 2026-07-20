/**
 * CLI command integration tests — headless, over real fixture JSON.
 *
 * These lock the PURE param-derivation + generation behavior the CLI exists to
 * make fast to iterate on: a required inner setting FILLED inside a subflow
 * must expose NO parameter; left EMPTY must expose exactly one required one.
 */
import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRegistry } from './registry.js';
import { loadWorkflow, loadSubflowIndex } from './workflow-io.js';
import { inspectParams, generate } from './commands.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, '..', 'test', 'fixtures');
const registry = buildRegistry();
const subflows = loadSubflowIndex(FIX);

describe('beamflow params', () => {
  it('exposes NO parameter when the required inner setting is filled', () => {
    const wf = loadWorkflow(path.join(FIX, 'parent-filled.json'));
    const reports = inspectParams(wf, subflows, registry);
    expect(reports).toHaveLength(1);
    expect(reports[0].nodeId).toBe('sf');
    expect(reports[0].parameters).toEqual([]);
  });

  it('exposes exactly one required parameter when the inner setting is empty', () => {
    const wf = loadWorkflow(path.join(FIX, 'parent-empty.json'));
    const reports = inspectParams(wf, subflows, registry);
    expect(reports).toHaveLength(1);
    expect(reports[0].parameters).toHaveLength(1);
    const p = reports[0].parameters[0];
    expect(p.required).toBe(true);
    expect(p.targetNodeId).toBe('inner_filter');
    expect(p.targetSettingKey).toBe('field');
    expect(p.id).toBe('auto_inner_filter_field');
  });
});

describe('beamflow generate', () => {
  it('generates Apache Beam Python for the filled subflow workflow', () => {
    const wf = loadWorkflow(path.join(FIX, 'parent-filled.json'));
    const result = generate(wf, subflows, registry);
    expect(result.code).toContain('import apache_beam as beam');
    expect(result.code).toContain('def run():');
  });
});
