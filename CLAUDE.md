# CLAUDE.md — BeamFlow

Visual ETL/ML pipeline builder on Apache Beam. Design pipelines on a drag-and-drop
canvas, generate real Python Beam code, and run it locally. See `README.md` for the
user-facing pitch and `docs/architecture.md` for the deep dive.

## Monorepo layout

pnpm workspace + Turborepo. Node 20+, pnpm 9+.

```
apps/
  editor/   React + Vite + Tailwind v4 + React Flow (@xyflow/react) + Zustand. The visual editor.
  server/   Fastify REST API. Serves node defs, persists pipelines, generates & executes code.
packages/
  shared/          @beamflow/shared        Shared TS types & utilities (used everywhere).
  core/            @beamflow/core          Node registry + plugin system.
  graph/           @beamflow/graph         DAG model, topological sort, (de)serialization.
  ir/              @beamflow/ir            Intermediate Representation builder & optimizer.
  beam-generator/  @beamflow/beam-generator Python Beam code generator (consumes IR).
  execution/       @beamflow/execution     Pipeline execution engine (DirectRunner).
  nodes/           @beamflow/nodes         Built-in node definitions (CSV/JSON/Filter/Map/GroupBy/CSV-out).
  plugin-sdk/      @beamflow/plugin-sdk    Public SDK for authoring external plugins.
  tsconfig/        @beamflow/tsconfig      Shared TS configs.
```

## The core pipeline (how a diagram becomes runnable code)

```
Visual Editor (React Flow + Zustand)   apps/editor
      ↓  serialize
  Graph Model (DAG)                     packages/graph
      ↓  build
  Intermediate Representation (IR)      packages/ir
      ↓  generate
  Code Generator (Python Beam)          packages/beam-generator
      ↓  execute
  Execution Engine (DirectRunner)       packages/execution
```

The **IR layer is the key decoupling point**: the editor never talks to a code generator
directly. Everything flows Graph → IR → generator, so alternate generators (Java/TS Beam)
can be added without touching the editor. When adding a node type, its behavior is expressed
as an IR step (`toIR(settings)`), not as emitted code — see `packages/plugin-sdk` and the
plugin example in `README.md`.

## Everything is a plugin

Node types are **not hardcoded**. Built-ins live in `packages/nodes` and register through the
same `@beamflow/core` registry that external plugins use. The editor also supports
user-authored **custom nodes** stored in localStorage (see `apps/editor/src/customNodes.ts`
and `CustomNodeModal.tsx`) — expression nodes (Map/Filter/FlatMap over `element`) and
composite nodes (grouped steps).

## Editor front-end map (`apps/editor/src`)

- `App.tsx` — assembles Toolbar / NodePalette / Canvas / PropertyPanel; loads node defs from API.
- `store/workflow-store.ts` — Zustand store: nodes, edges, selection, undo/redo (50-level),
  theme, toasts, serialization (`toWorkflow`/`loadWorkflow`). Single source of truth.
- `components/Canvas.tsx` — React Flow canvas, drag/drop from palette, minimap, controls.
- `components/nodes/CustomNodes.tsx` — the on-canvas node component + per-category colors/icons.
- `components/NodePalette.tsx` — left sidebar: searchable, categorized, draggable node list.
- `components/PropertyPanel.tsx` — right sidebar: renders settings form for the selected node.
- `components/Toolbar.tsx` — top bar: save/generate/run/undo/redo/import/export/theme + modals.
- `api/client.ts` — typed fetch wrapper to the Fastify server (`/api`, proxied to :3001 in dev).

Theming: three themes (`dark` default, `light`, `mid`) driven by CSS custom properties in
`index.css` under `:root` / `html.light` / `html.mid`. Category colors are shared between the
palette and canvas nodes so a node looks the same in the list as when placed.

## Dev workflow

```bash
pnpm install
pnpm build            # turbo build across all packages
pnpm dev              # editor (:5173) + server (:3001) + package watchers
```

Per-app / focused runs (faster than the whole graph):

```bash
pnpm --filter @beamflow/editor --filter @beamflow/server dev
cd apps/editor && npx vite            # just the editor dev server
cd apps/editor && npx tsc -b && npx vite build   # typecheck + prod build
```

## UI stack

The editor uses **Tailwind CSS v4** (`@tailwindcss/vite`) + **shadcn/ui** (Radix primitives,
components vendored under `apps/editor/src/components/ui/`). `components.json` configures the
registry; `src/lib/utils.ts` has the `cn()` helper. shadcn semantic tokens (`--primary`,
`--background`, `--border`, `--muted`, …) are **mapped in `src/index.css` onto the existing
theme palette** (`--surface-*`, `--text-*`, brand colors) so shadcn components inherit the
dark/light/mid themes automatically. Prefer shadcn components (Dialog, Button, Input, Select,
Textarea, Label) for new UI instead of hand-rolling; add more with
`npx shadcn@latest add <name>`.

## Gotchas & conventions (read before styling or running)

### NEVER add a global `* { padding: 0 }` / `* { margin: 0 }` reset
This was the root cause of a long "my spacing/padding edits have no effect" bug. A bare `*`
rule is **unlayered**, and in Tailwind v4 unlayered CSS beats everything in `@layer utilities`
— so `* { padding: 0 }` silently zeroed **every** `p-*`/`px-*`/`py-*` utility in the whole app
(the rules existed in the compiled CSS but lost the cascade). Tailwind's Preflight already
resets margins/padding safely inside `@layer base`; do not re-add your own. `index.css` now
only sets `box-sizing` globally (see the comment there). Symptom to watch for: a padding
utility is present in the built CSS yet computes to `0px` in the browser.

### Prefer `flex … gap-*` over `space-y-*` for vertical rhythm
`space-y-*` in this v4 setup has been unreliable (utility not always emitted). Use
`flex flex-col gap-N` for stacked spacing and `flex gap-N` / grid `gap-N` for rows — these are
what shadcn uses too and they render reliably.

### Two dev servers = stale UI
`pnpm dev` starts many persistent tasks. If you start it more than once you can end up with
**duplicate Vite servers** (e.g. :5173 and :5174) and view stale code. If UI changes "don't
show up": check `netstat` for multiple listeners on 517x, kill extras, `rm -rf
apps/editor/node_modules/.vite`, restart one server, and hard-refresh (Ctrl+Shift+R).

### Turbo concurrency
There are 10 persistent `dev` tasks; Turbo's default concurrency (10) is one short. `turbo.json`
sets `"concurrency": "15"` so `pnpm dev` runs. If you add more persistent tasks, raise it again.

### Platform
Primary dev is on **Windows / PowerShell**. A Bash tool is also available for POSIX scripts.
Python 3.9+ and `apache-beam` are needed only to *execute* generated pipelines, not to develop
the editor.
```
