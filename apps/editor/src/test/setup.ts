/**
 * Vitest setup, shared by node- and jsdom-environment tests.
 *
 * The DOM-dependent bits (jest-dom matchers, React Flow measurement stubs,
 * Testing Library auto-cleanup) only apply when a document exists — i.e. under
 * the jsdom environment used by `*.test.tsx` component tests. Node-env
 * `*.test.ts` files load this file too but skip the DOM setup.
 */
import { afterEach, beforeEach } from 'vitest';

// Install the central schema-sync subscriber for every test (the app installs
// it from App.tsx, which tests don't import). Reset + reinstall per test so
// each starts with a clean subscription. Dynamic imports so this runs after
// each file's vi.mock hoisting.
beforeEach(async () => {
  const { __resetSchemaSyncForTests, installSchemaSync } = await import('../lib/schema-sync');
  const { useWorkflowStore } = await import('../store/workflow-store');
  const { useSchemaStore } = await import('../lib/schema-store');
  __resetSchemaSyncForTests();
  installSchemaSync(
    useWorkflowStore as any,
    (nodes: any, edges: any) => useSchemaStore.getState().syncFromWorkflow(nodes, edges),
  );
});

const hasDom = typeof window !== 'undefined' && typeof document !== 'undefined';

if (hasDom) {
  // jest-dom matchers (toBeInTheDocument, toHaveValue, …).
  await import('@testing-library/jest-dom/vitest');
  const { cleanup } = await import('@testing-library/react');
  afterEach(() => cleanup());

  // ── React Flow / jsdom shims ──────────────────────────────────────────────
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as any).ResizeObserver = (globalThis as any).ResizeObserver ?? ResizeObserverStub;

  window.matchMedia =
    window.matchMedia ||
    ((query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener() {},
        removeListener() {},
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() {
          return false;
        },
      }) as any);

  // React Flow measures node/pane geometry; give it a non-zero box.
  if (!(HTMLElement.prototype as any).__bboxPatched) {
    (HTMLElement.prototype as any).__bboxPatched = true;
    HTMLElement.prototype.getBoundingClientRect = function () {
      return { x: 0, y: 0, width: 800, height: 600, top: 0, left: 0, right: 800, bottom: 600, toJSON() {} } as DOMRect;
    };
  }

  (window as any).DOMMatrixReadOnly = (window as any).DOMMatrixReadOnly ?? class {};
}
