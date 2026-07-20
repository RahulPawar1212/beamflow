#!/usr/bin/env node
/**
 * @beamflow/cli — headless workflow tooling.
 *
 * A thin third consumer of the pure engine packages (graph → ir →
 * beam-generator), alongside the editor and server. No HTTP/DB/auth — it reads
 * workflow JSON from disk and runs the identical generate / param-derivation
 * logic, so core changes can be exercised and tested fast without the UI.
 *
 * Usage:
 *   beamflow params   <workflow.json> [--subflow-dir DIR]
 *   beamflow generate <workflow.json> [--subflow-dir DIR] [-o OUT.py]
 */
import * as fs from 'node:fs';
import { buildRegistry } from './registry.js';
import { loadWorkflow, loadSubflowIndex } from './workflow-io.js';
import { inspectParams, generate } from './commands.js';

interface ParsedArgs {
  command: string | undefined;
  workflow: string | undefined;
  subflowDir: string | undefined;
  out: string | undefined;
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv;
  const parsed: ParsedArgs = { command, workflow: undefined, subflowDir: undefined, out: undefined };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--subflow-dir') parsed.subflowDir = rest[++i];
    else if (a === '-o' || a === '--out') parsed.out = rest[++i];
    else if (!a.startsWith('-') && parsed.workflow === undefined) parsed.workflow = a;
  }
  return parsed;
}

const USAGE = `beamflow — headless BeamFlow workflow tooling

Commands:
  params   <workflow.json> [--subflow-dir DIR]           Inspect subflow parameters (stored + live-derived)
  generate <workflow.json> [--subflow-dir DIR] [-o OUT]  Generate Apache Beam Python

Options:
  --subflow-dir DIR   Directory of subflow *.json docs, indexed by metadata.id
  -o, --out FILE      Write generated Python to FILE (default: stdout)
`;

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  if (!args.command || args.command === 'help' || args.command === '--help') {
    process.stdout.write(USAGE);
    return;
  }

  if (!args.workflow) {
    process.stderr.write(`error: missing <workflow.json>\n\n${USAGE}`);
    process.exitCode = 2;
    return;
  }

  const registry = buildRegistry();
  const workflow = loadWorkflow(args.workflow);
  const subflowIndex = loadSubflowIndex(args.subflowDir);

  switch (args.command) {
    case 'params': {
      const reports = inspectParams(workflow, subflowIndex, registry);
      if (reports.length === 0) {
        process.stdout.write('No system:subflow nodes in this workflow.\n');
        return;
      }
      for (const r of reports) {
        process.stdout.write(`\nSubflow node "${r.nodeId}" → subflowId=${r.subflowId ?? '(unset)'}\n`);
        if (r.parameters.length === 0) {
          process.stdout.write('  (no exposed parameters)\n');
          continue;
        }
        for (const p of r.parameters) {
          const req = p.required ? ' [required]' : '';
          process.stdout.write(
            `  - ${p.name} (id=${p.id}, type=${p.type}${req}) → ${p.targetNodeId}.${p.targetSettingKey}\n`,
          );
        }
      }
      return;
    }
    case 'generate': {
      const result = generate(workflow, subflowIndex, registry);
      if (args.out) {
        fs.writeFileSync(args.out, result.code, 'utf8');
        process.stdout.write(`Wrote ${result.code.length} bytes to ${args.out}\n`);
      } else {
        process.stdout.write(result.code);
      }
      return;
    }
    default:
      process.stderr.write(`error: unknown command "${args.command}"\n\n${USAGE}`);
      process.exitCode = 2;
  }
}

try {
  main();
} catch (err) {
  process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
}
