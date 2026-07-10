import { describe, it, expect, vi } from 'vitest';
import { executePipeline } from './executor.js';
import { ExecutionStatus } from '@beamflow/shared';
import * as childProcess from 'node:child_process';
import * as fs from 'node:fs/promises';

vi.mock('node:child_process', () => {
  return {
    spawn: vi.fn(),
  };
});

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    rm: vi.fn().mockResolvedValue(undefined),
  };
});

describe('Execution Package', () => {
  it('handles successful execution', async () => {
    const mockChild = {
      stdout: {
        on: vi.fn((event, callback) => {
          if (event === 'data') {
            callback(Buffer.from('Pipeline started\nDone\n'));
          }
        }),
      },
      stderr: {
        on: vi.fn(),
      },
      on: vi.fn((event, callback) => {
        if (event === 'close') {
          callback(0); // Exit code 0
        }
      }),
      kill: vi.fn(),
    };

    vi.mocked(childProcess.spawn).mockReturnValue(mockChild as any);

    const pipeline = {
      code: 'print("hello")',
      filename: 'pipeline.py',
      language: 'python' as const,
      requirements: [],
      irPipeline: {},
    };

    const result = await executePipeline(pipeline, { installDeps: false });
    expect(result.status).toBe(ExecutionStatus.Completed);
    expect(result.exitCode).toBe(0);
    expect(result.logs).toContain('Pipeline started');
    expect(result.logs).toContain('Done');
    expect(fs.writeFile).toHaveBeenCalled();
  });

  it('handles execution failures', async () => {
    const mockChild = {
      stdout: {
        on: vi.fn(),
      },
      stderr: {
        on: vi.fn((event, callback) => {
          if (event === 'data') {
            callback(Buffer.from('SyntaxError: invalid syntax\n'));
          }
        }),
      },
      on: vi.fn((event, callback) => {
        if (event === 'close') {
          callback(1); // Exit code 1
        }
      }),
      kill: vi.fn(),
    };

    vi.mocked(childProcess.spawn).mockReturnValue(mockChild as any);

    const pipeline = {
      code: 'invalid python code',
      filename: 'pipeline.py',
      language: 'python' as const,
      requirements: [],
      irPipeline: {},
    };

    const result = await executePipeline(pipeline, { installDeps: false });
    expect(result.status).toBe(ExecutionStatus.Failed);
    expect(result.exitCode).toBe(1);
    expect(result.errors).toContain('SyntaxError: invalid syntax');
  });

  it('cleans up the workDir after execution (no leftover temp state across runs)', async () => {
    // Leftover exec_* / beam-temp-* directories from never cleaning up
    // workDir caused Beam's FileBasedSink to collide with stale finalize-
    // write state on Windows ("src and dst files do not exist") when an
    // output path was reused across runs. workDir must always be swept.
    const mockChild = {
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn((event, callback) => {
        if (event === 'close') callback(0);
      }),
      kill: vi.fn(),
    };
    vi.mocked(childProcess.spawn).mockReturnValue(mockChild as any);

    const pipeline = {
      code: 'print("hello")',
      filename: 'pipeline.py',
      language: 'python' as const,
      requirements: [],
      irPipeline: {},
    };

    await executePipeline(pipeline, { installDeps: false });
    expect(fs.rm).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ recursive: true, force: true }),
    );
  });
});
