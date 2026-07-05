# Changelog

All notable changes to BeamFlow are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); versions are pre-1.0 (Alpha).

## [Unreleased]

### UI / editor

- **Adopted shadcn/ui** (Radix primitives) as the component layer, wired to the
  existing dark/light/mid theme via CSS-variable token mapping in
  `apps/editor/src/index.css`. Components live in
  `apps/editor/src/components/ui/` (Dialog, Button, Input, Select, Textarea,
  Label, ScrollArea) with `cn()` in `src/lib/utils.ts` and `components.json`.
- **Migrated modals to the accessible shadcn `Dialog`** — the Create/Edit Custom
  Node modal (`CustomNodeModal.tsx`) and the generated-code preview
  (`Toolbar.tsx` `CodeModal`) — gaining focus-trap, ESC, and click-outside for
  free. Both reorganized into clearly-spaced sections.
- **Redesigned the node palette** (`NodePalette.tsx`): category-colored icon
  chips per node, card-style rows with hover, single-line descriptions, clearer
  category headers, and proper gutters. On-canvas nodes (`CustomNodes.tsx`) got
  a category accent bar, gradient icon chip, and refined selected/hover states.
- **Toolbar** primary actions (Generate/Run) are now filled gradient buttons.

### Fixed

- **Root-cause CSS bug: a global `* { padding: 0 }` reset was silently zeroing
  every Tailwind `p-*`/`px-*`/`py-*` utility app-wide.** In Tailwind v4 a bare
  `*` rule is unlayered and beats `@layer utilities`, so padding classes existed
  in the compiled CSS but lost the cascade (computed to `0px`). Removed it;
  `index.css` now only sets `box-sizing`. This fixed the palette hugging the
  window edge and cramped modals. See `CLAUDE.md` for the guardrail.
- Prefer `flex … gap-*` over the unreliable `space-y-*` for vertical rhythm.

### API server (`apps/server`)

- **Centralized error handling** (`errors.ts`): an `ApiError` class +
  `notFound()`/`badRequest()` helpers and a Fastify error handler rendering a
  uniform `{ error, issues? }` envelope. Routes now `throw` instead of
  hand-writing `reply.status().send()`.
- **`buildApp()` factory** (`app.ts`) owns all wiring (registry + plugins +
  storage + routes + error handler) without starting the listener, so
  production startup (`index.ts`) and tests share identical wiring.
- **Configurable startup**: `CORS_ORIGINS` env var (comma-separated, dev
  defaults preserved) and a top-level `.catch()` so startup failures aren't
  unhandled.

### API client (`apps/editor/src/api/client.ts`)

- `NodeDef` now structurally mirrors `@beamflow/shared` types (drift guard)
  rather than being a free-floating duplicate.
- Env-based base URL (`VITE_API_BASE`, defaults to the `/api` dev proxy).
- Consistent `encodeURIComponent` on all path params (was only on `getNode`).

### Nodes (`packages/nodes`)

- **Auto-registration**: `index.ts` exposes a single `builtinNodes` array as the
  source of truth; the plugin registers by iterating it. Adding a built-in node
  is now a one-line edit — create the file, import it, add to the array.
- Each node file gained a structured doc header (purpose, ports, settings,
  emitted IR op) for at-a-glance understanding.

### Tests (62 new)

- **Per-node** (37): `validate()` + `toIR()` coverage for all six built-ins,
  plus `index.test.ts` for the array + plugin registration.
- **API server** (17): route tests via Fastify `app.inject()` (nodes, pipeline
  CRUD, real Python codegen, execute with mocked `@beamflow/execution`) and
  `LocalJsonStorage` round-trip. Added a `MemoryStorage` test helper.
- **API client** (8): added Vitest to `apps/editor` (previously untested); mocks
  `fetch` and asserts URLs/methods/bodies, encoding, 204 handling, and error
  propagation.

### Tooling / docs

- Added `CLAUDE.md` — repo map, architecture flow, dev workflow, and the CSS
  gotchas above.
- `turbo.json`: bumped `concurrency` to 15 so `pnpm dev` (10 persistent tasks)
  runs without exhausting the default slot count.

### Known issues

- The editor Toolbar checks `result.status === 'success'`, but the server emits
  the shared `ExecutionStatus` values (`'completed'`/`'failed'`); execution
  currently succeeds via the `exitCode === 0` fallback. Worth reconciling the
  status semantics in a follow-up.
