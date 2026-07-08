/**
 * @module trace
 *
 * A zero-dependency, toggleable flow tracer for the editor.
 *
 * It answers the question "what happened, in order, when I did X on the UI?"
 * by logging store actions, schema recomputations, and API requests to the
 * browser console with a consistent `[Trace]` prefix, indentation, and timing.
 *
 * ── Turning it on ────────────────────────────────────────────────────────────
 *   • Runtime (no rebuild): in the browser console run
 *         beamflow.trace.on()      // or .off(), .toggle(), .status()
 *     then repeat the UI action. The setting persists in localStorage
 *     ('beamflow.trace') across reloads.
 *   • Build-time: set VITE_TRACE=1 in the environment before `pnpm dev`.
 *
 * When disabled, every trace call is a cheap boolean check — no formatting,
 * no console noise, no measurable overhead. Safe to leave wired in production.
 *
 * ── What gets traced ─────────────────────────────────────────────────────────
 *   • action(name, detail)   — a Zustand store action (onConnect, addNode, …)
 *   • schema(nodeId, cols)   — one node's schema recompute (from the engine)
 *   • api(method, path, …)   — an API request start
 *   • apiDone(…, status, ms) — an API response
 *   • group()/groupEnd()     — nest related events (an action and its effects)
 *
 * See docs/debugging.md for a full walkthrough.
 */

const LS_KEY = 'beamflow.trace';

function readInitialEnabled(): boolean {
  // Build-time flag wins as the initial default; localStorage can override live.
  const envFlag = (import.meta as any)?.env?.VITE_TRACE;
  if (typeof localStorage !== 'undefined') {
    const ls = localStorage.getItem(LS_KEY);
    if (ls === 'on') return true;
    if (ls === 'off') return false;
  }
  return envFlag === '1' || envFlag === 'true';
}

let enabled = readInitialEnabled();
let depth = 0;

/** High-resolution-ish timestamp; falls back to Date-free counter in tests. */
function now(): number {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : 0;
}

function pad(): string {
  return depth > 0 ? '  '.repeat(depth) : '';
}

function log(kind: string, msg: string, data?: unknown): void {
  if (!enabled) return;
  const prefix = `%c[Trace]%c ${pad()}${kind}`;
  const style1 = 'color:#818cf8;font-weight:bold';
  const style2 = 'color:inherit;font-weight:normal';
  // eslint-disable-next-line no-console
  if (data !== undefined) console.log(prefix, style1, style2, msg, data);
  // eslint-disable-next-line no-console
  else console.log(prefix, style1, style2, msg);
}

export const trace = {
  get enabled(): boolean {
    return enabled;
  },

  /** A store action fired from the UI. */
  action(name: string, detail?: unknown): void {
    log('action', name, detail);
  },

  /** One node's schema recompute. `cols` is the resulting column-name list. */
  schema(nodeId: string, cols: string[]): void {
    log('schema', `${nodeId} = [${cols.join(', ')}]`);
  },

  /** An API request is starting. Returns a token to pass to apiDone for timing. */
  api(method: string, path: string, extra?: unknown): number {
    const started = now();
    log('api →', `${method} ${path}`, extra);
    return started;
  },

  /** An API response arrived. */
  apiDone(method: string, path: string, status: number | string, started: number): void {
    if (!enabled) return;
    const ms = Math.round((now() - started) * 10) / 10;
    log('api ←', `${method} ${path} → ${status} (${ms}ms)`);
  },

  /** A plain informational trace line. */
  info(msg: string, data?: unknown): void {
    log('info', msg, data);
  },

  /** Begin an indented group of related events (e.g. an action + its effects). */
  group(name: string, detail?: unknown): void {
    if (!enabled) return;
    log('▼', name, detail);
    depth++;
  },

  /** End the current group. */
  groupEnd(): void {
    if (!enabled) return;
    depth = Math.max(0, depth - 1);
  },
};

/** Console control surface: `beamflow.trace.on()` etc. */
export const traceControl = {
  on(): string {
    enabled = true;
    try { localStorage.setItem(LS_KEY, 'on'); } catch { /* ignore */ }
    return '[Trace] ON — repeat your UI action to see the flow.';
  },
  off(): string {
    enabled = false;
    try { localStorage.setItem(LS_KEY, 'off'); } catch { /* ignore */ }
    return '[Trace] OFF';
  },
  toggle(): string {
    return enabled ? this.off() : this.on();
  },
  status(): string {
    return `[Trace] ${enabled ? 'ON' : 'OFF'}`;
  },
};

// Expose a small control surface on window so it can be toggled from the
// browser console without importing anything: `beamflow.trace.on()`.
if (typeof window !== 'undefined') {
  (window as any).beamflow = (window as any).beamflow || {};
  (window as any).beamflow.trace = traceControl;
}
