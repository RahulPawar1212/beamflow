/**
 * @module @beamflow/execution/executor
 *
 * Pipeline execution engine.
 *
 * Manages the lifecycle of pipeline runs:
 * 1. Write generated code to a temp directory
 * 2. Install dependencies
 * 3. Spawn the Python process
 * 4. Stream stdout/stderr back to the caller
 * 5. Track execution state
 *
 * Extension point: implement IRunner for different execution backends
 * (local, Dataflow, Flink, etc.)
 */

import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { nanoid } from 'nanoid';
import type { GeneratedPipeline, ExecutionResult } from '@beamflow/shared';
import { ExecutionStatus } from '@beamflow/shared';

/** Configuration for an execution run. */
export interface ExecutionConfig {
  /** Working directory override (default: system temp). */
  readonly workDir?: string;
  /** Python executable path (default: 'python'). */
  readonly pythonPath?: string;
  /** Whether to install requirements before running (default: true). */
  readonly installDeps?: boolean;
  /** Timeout in milliseconds (default: 300000 = 5 minutes). */
  readonly timeoutMs?: number;
  /** Extra environment variables. */
  readonly env?: Record<string, string>;
  /** AbortSignal to cancel execution. */
  readonly signal?: AbortSignal;
}

/** Callback for receiving execution log lines in real time. */
export type ExecutionLogCallback = (line: string, stream: 'stdout' | 'stderr') => void;

/**
 * A handle to a running or completed execution.
 */
export class ExecutionHandle {
  public status: ExecutionStatus = ExecutionStatus.Pending;
  public readonly logs: string[] = [];
  public readonly errors: string[] = [];
  public startedAt: string = '';
  public completedAt?: string;
  public exitCode?: number;

  constructor(
    public readonly id: string,
    public readonly workDir: string,
  ) {}

  toResult(): ExecutionResult {
    return {
      id: this.id,
      status: this.status,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      logs: [...this.logs],
      errors: [...this.errors],
      exitCode: this.exitCode,
    };
  }
}

class Mutex {
  private _promise: Promise<void> | null = null;
  async lock(): Promise<() => void> {
    while (this._promise) {
      await this._promise;
    }
    let resolveFn!: () => void;
    this._promise = new Promise(r => { resolveFn = r; });
    return () => {
      this._promise = null;
      resolveFn();
    };
  }
}

const envMutex = new Mutex();

import { stat } from 'node:fs/promises';
import { platform } from 'node:os';

const SHARED_VENV_DIR = join(tmpdir(), 'beamflow', 'shared_venv');

async function ensureVirtualEnv(basePythonPath: string, onLog?: ExecutionLogCallback): Promise<string> {
  const isWindows = platform() === 'win32';
  const venvPythonPath = join(SHARED_VENV_DIR, isWindows ? 'Scripts' : 'bin', isWindows ? 'python.exe' : 'python');

  try {
    await stat(venvPythonPath);
    return venvPythonPath;
  } catch {
    onLog?.('[BeamFlow] Creating persistent virtual environment for pipeline runs...', 'stdout');
    await runProcess(basePythonPath, ['-m', 'venv', `"${SHARED_VENV_DIR}"`], tmpdir(), 300_000, (line, stream) => {
      onLog?.(`[VENV] ${line}`, stream);
    });
    return venvPythonPath;
  }
}

/**
 * Execute a generated pipeline locally.
 *
 * @param pipeline - The generated pipeline code to execute.
 * @param config - Execution configuration options.
 * @param onLog - Optional callback for real-time log streaming.
 * @returns A promise that resolves to the execution result.
 */
export async function executePipeline(
  pipeline: GeneratedPipeline,
  config: ExecutionConfig = {},
  onLog?: ExecutionLogCallback,
): Promise<ExecutionResult> {
  const executionId = `exec_${nanoid(10)}`;
  const basePythonPath = config.pythonPath || 'python';
  const timeoutMs = config.timeoutMs || 300_000;

  // Create temp working directory
  const workDir =
    config.workDir || join(tmpdir(), 'beamflow', executionId);
  await mkdir(workDir, { recursive: true });

  const handle = new ExecutionHandle(executionId, workDir);
  handle.startedAt = new Date().toISOString();
  handle.status = ExecutionStatus.Running;

  try {
    let pythonPath = basePythonPath;
    
    // Acquire lock for environment setup
    const unlock = await envMutex.lock();
    try {
      try {
        pythonPath = await ensureVirtualEnv(basePythonPath, onLog);
      } catch (err) {
        onLog?.('[BeamFlow] Failed to create or use virtual environment, falling back to global Python.', 'stderr');
      }

      // Write pipeline code
      const pipelinePath = join(workDir, pipeline.filename);
      await writeFile(pipelinePath, pipeline.code, 'utf-8');

      // Write requirements.txt
      if (pipeline.requirements.length > 0) {
        const requirementsPath = join(workDir, 'requirements.txt');
        await writeFile(
          requirementsPath,
          pipeline.requirements.join('\n') + '\n',
          'utf-8',
        );

        // Install dependencies
        if (config.installDeps !== false) {
          handle.logs.push('[BeamFlow] Checking/installing dependencies...');
          onLog?.('[BeamFlow] Checking/installing dependencies...', 'stdout');

          await runProcess(
            pythonPath,
            ['-m', 'pip', 'install', '-r', 'requirements.txt', '--quiet', '--disable-pip-version-check'],
            workDir,
            timeoutMs,
            (line, stream) => {
              if (stream === 'stderr') {
                handle.errors.push(line);
              } else {
                handle.logs.push(line);
              }
              onLog?.(line, stream);
            },
            config.env,
            config.signal,
          );
        }
      }
    } finally {
      unlock();
    }

    // Execute pipeline
    handle.logs.push(`[BeamFlow] Executing pipeline: ${pipeline.filename}`);
    onLog?.(`[BeamFlow] Executing pipeline: ${pipeline.filename}`, 'stdout');

    const exitCode = await runProcess(
      pythonPath,
      [pipeline.filename],
      workDir,
      timeoutMs,
      (line, stream) => {
        if (stream === 'stderr') {
          handle.errors.push(line);
        } else {
          handle.logs.push(line);
        }
        onLog?.(line, stream);
      },
      config.env,
      config.signal,
    );

    handle.exitCode = exitCode;
    handle.status = exitCode === 0 ? ExecutionStatus.Completed : ExecutionStatus.Failed;
    handle.logs.push(
      `[BeamFlow] Pipeline ${handle.status} with exit code ${exitCode}`,
    );
    onLog?.(
      `[BeamFlow] Pipeline ${handle.status} with exit code ${exitCode}`,
      'stdout',
    );
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      handle.status = ExecutionStatus.Cancelled;
      handle.logs.push('[BeamFlow] Execution cancelled by user');
      onLog?.('[BeamFlow] Execution cancelled by user', 'stdout');
    } else {
      handle.status = ExecutionStatus.Failed;
      const message =
        error instanceof Error ? error.message : String(error);
      handle.errors.push(`[BeamFlow] Execution error: ${message}`);
      onLog?.(`[BeamFlow] Execution error: ${message}`, 'stderr');
    }
  } finally {
    handle.completedAt = new Date().toISOString();
    // In production we would clean up the workDir here
    // await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }

  return handle.toResult();
}

/**
 * Internal helper to run a process and capture output.
 *
 * @returns Exit code of the process.
 */
function runProcess(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  onLine: (line: string, stream: 'stdout' | 'stderr') => void,
  env?: Record<string, string>,
  signal?: AbortSignal,
): Promise<number> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const err = new Error('Aborted');
      err.name = 'AbortError';
      return reject(err);
    }

    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      shell: true,
    });

    let timeout: NodeJS.Timeout | undefined;

    const onAbort = () => {
      child.kill('SIGTERM');
      const err = new Error('Aborted');
      err.name = 'AbortError';
      reject(err);
    };

    if (signal) {
      signal.addEventListener('abort', onAbort);
    }

    timeout = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort);
      child.kill('SIGTERM');
      reject(new Error(`Process timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout?.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        onLine(line, 'stdout');
      }
    });

    child.stderr?.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        onLine(line, 'stderr');
      }
    });

    child.on('close', (code) => {
      if (timeout) clearTimeout(timeout);
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve(code ?? 1);
    });

    child.on('error', (err) => {
      if (timeout) clearTimeout(timeout);
      if (signal) signal.removeEventListener('abort', onAbort);
      reject(err);
    });
  });
}
