/**
 * @module auto-save
 *
 * Debounced auto-save: persist the open pipeline a short delay after the user
 * stops editing, and flush on tab close / navigation so a mid-edit close still
 * saves. Manual Save (Ctrl+S / the button) still works and simply saves now.
 *
 * Modeled on schema-sync: this module imports NO store — the workflow store is
 * handed in via installAutoSave() from a leaf module (App.tsx), keeping it out
 * of the store import cycle.
 *
 * Rules that keep it safe:
 *  - Only auto-saves when there's something to save (isDirty), the doc has been
 *    saved at least once (has a pipelineId — a brand-new untitled canvas isn't
 *    auto-created), and no save is already in flight.
 *  - Never auto-saves while a conflict banner is showing: the user must resolve
 *    the concurrent-edit conflict first, or auto-save would just 409 in a loop.
 *  - A conflicted/failed save leaves isDirty true; we back off (the next edit
 *    reschedules) rather than retry-spamming.
 */
import { trace } from './trace';

const DEBOUNCE_MS = 2000;

interface AutoSaveState {
  isDirty: boolean;
  isSaving: boolean;
  pipelineId: string | null;
  conflict: unknown | null;
  saveBlockedReason: string | null;
}
interface StoreLike {
  getState: () => AutoSaveState & { saveWorkflow: () => Promise<boolean> };
  subscribe: (listener: (state: AutoSaveState) => void) => () => void;
}

let store: StoreLike | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let unsubscribe: (() => void) | null = null;
let beforeUnloadHandler: (() => void) | null = null;

function canAutoSave(s: AutoSaveState): boolean {
  // Never auto-save while a conflict banner is up (would 409-loop) or while a
  // non-retryable save is blocked (e.g. a duplicate name) — the user must act first.
  return s.isDirty && !s.isSaving && !!s.pipelineId && !s.conflict && !s.saveBlockedReason;
}

function schedule(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    const s = store?.getState();
    if (s && canAutoSave(s)) {
      trace.action('autoSave', { pipelineId: s.pipelineId });
      void s.saveWorkflow();
    }
  }, DEBOUNCE_MS);
}

/** Persist immediately (used on tab close). Fire-and-forget. */
function flushNow(): void {
  if (timer) { clearTimeout(timer); timer = null; }
  const s = store?.getState();
  if (s && canAutoSave(s)) {
    trace.action('autoSaveFlush', { pipelineId: s.pipelineId });
    void s.saveWorkflow();
  }
}

/**
 * Wire debounced auto-save to the store. Idempotent — a second call tears down
 * the previous subscription first. Returns a disposer.
 */
export function installAutoSave(workflowStore: StoreLike): () => void {
  store = workflowStore;
  if (unsubscribe) unsubscribe();

  // Reschedule whenever the doc becomes/stays dirty. Zustand fires the listener
  // on every set; the debounce collapses a burst of edits into one save.
  unsubscribe = workflowStore.subscribe((state) => {
    if (canAutoSave(state)) schedule();
  });

  // Flush on tab close / navigation. visibilitychange (hidden) covers mobile /
  // tab-switch where beforeunload may not fire.
  if (typeof window !== 'undefined') {
    beforeUnloadHandler = () => flushNow();
    window.addEventListener('beforeunload', beforeUnloadHandler);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushNow();
    });
  }

  return () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    if (beforeUnloadHandler && typeof window !== 'undefined') {
      window.removeEventListener('beforeunload', beforeUnloadHandler);
      beforeUnloadHandler = null;
    }
    store = null;
  };
}
