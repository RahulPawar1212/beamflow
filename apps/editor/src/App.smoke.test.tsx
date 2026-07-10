// @vitest-environment jsdom
/**
 * Smoke test — the cheapest, broadest guard for this app.
 *
 * It answers ONE question: "does the app actually boot?" This is the class of
 * failure that unit tests miss but ships a blank page — twice this project hit
 * exactly this (an import-cycle TDZ crash, and HMR staleness). If the module
 * graph is broken, an import cycle exists, or a top-level throw sneaks in, the
 * render below throws or logs an error and this test fails — in CI, before merge.
 *
 * Ceiling (know it): jsdom proves the modules load and React mounts without
 * errors. It does NOT prove pixel layout or full browser behavior — a real
 * browser Playwright journey is the documented next step (see
 * docs/maintaining-and-growing-beamflow.md §5). For catching the crash-class,
 * this is the high-value, zero-dependency check.
 *
 * Unauthenticated, App renders <LoginPage/> and makes ZERO API calls
 * (see App.tsx: `if (!token) return <LoginPage/>`), so no server/mock is needed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

// Ensure no auth token → the app takes the backend-free login path.
beforeEach(() => {
  localStorage.clear();
});
afterEach(() => cleanup());

describe('App smoke test', () => {
  it('mounts without throwing and logs no console errors', { timeout: 15000 }, async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Import App AFTER localStorage is cleared so the auth store initializes tokenless.
    const { default: App } = await import('./App');
    const { container } = render(<App />);

    // React actually rendered something (not a blank root).
    expect(container.firstChild).not.toBeNull();
    // The unauthenticated login surface is present (queryAllByText — the page has
    // more than one "sign in" element, e.g. a heading + a button; ≥1 is enough).
    const loginBits = [
      ...screen.queryAllByText(/sign in/i),
      ...screen.queryAllByText(/log in/i),
      ...screen.queryAllByText(/beamflow/i),
    ];
    expect(loginBits.length).toBeGreaterThan(0);

    // No error was logged during mount (an import-cycle/TDZ crash would surface here).
    const realErrors = errorSpy.mock.calls.filter(
      // Ignore React's benign act()/environment warnings if any slip through.
      (args) => !String(args[0] ?? '').includes('act('),
    );
    expect(realErrors).toEqual([]);

    errorSpy.mockRestore();
  });
});
