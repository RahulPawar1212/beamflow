# Debugging BeamFlow — logs, flow tracing & tests

This guide shows how to see **exactly what happens on every UI action**, where the
logs are, and how to reproduce/guard bugs with tests. It's the doc to open when
"something in the editor isn't updating" and you need to find *where* the flow breaks.

Related: [architecture.md](architecture.md), [schema-propagation.md](schema-propagation.md),
[subflows.md](subflows.md), [preview-and-troubleshooting.md](preview-and-troubleshooting.md).

---

## 1. The flow tracer (start here)

Every meaningful UI action, schema recompute, and API call can be traced to the
browser console with timing and nesting. It's **off by default** and has zero cost
when off.

### Turn it on
In the browser console (editor open):
```js
beamflow.trace.on()      // persists in localStorage, survives reloads
beamflow.trace.off()
beamflow.trace.toggle()
beamflow.trace.status()
```
Or build-time: `VITE_TRACE=1 pnpm dev`.

Then **repeat the action** you're debugging and read the console.

### What a trace looks like
Connecting a subflow node to a Filter, for example, prints:
```
[Trace] ▼ onConnect { source: 'sf', target: 'flt' }
[Trace]   action refreshSubflowCache { force: false, subflowNodes: 1 }
[Trace]   api → GET /pipelines/child_1
[Trace]   api ← GET /pipelines/child_1 → 200 (12.4ms)
[Trace]   schema sub_sf_c_csv = [GroupId:double, VariableId:boolean]
[Trace]   schema sub_sf_c_out = [GroupId:double, VariableId:boolean]
[Trace]   schema sf          = [GroupId:double, VariableId:boolean]
[Trace]   schema flt         = [GroupId:double, VariableId:boolean]   ← Filter now has columns
```
Indentation groups an action with the effects it triggered. `▼` marks the start of a
grouped action; `api →`/`api ←` are request/response; `schema <nodeId> = [...]` is one
node's recomputed output columns.

### What's instrumented
- **Store actions** (`apps/editor/src/store/workflow-store.ts`): `onConnect`,
  `addNode`, `updateNodeSettings`, `removeNode`, `loadWorkflow`, `saveWorkflow`,
  `refreshSubflowCache`, `createSubflowFromSelection`, `enterSubflow`, `exitSubflow`.
- **Schema engine** (`apps/editor/src/lib/schema-store.ts`): every node recompute.
- **API** (`apps/editor/src/api/client.ts`): every request through `request()` (method,
  path, status, ms). `uploadFile` is the one call that bypasses this wrapper.

The tracer lives in `apps/editor/src/lib/trace.ts`. To trace something new, import
`trace` and call `trace.action('name', detail)`.

---

## 2. Reading the flow: what each UI action does

Store actions just **mutate the graph** (`nodes` / `edges` / `subflowCache`). Schema
recompute is **not** triggered by the actions themselves — a single central subscriber
(`apps/editor/src/lib/schema-sync.ts`) watches the store and re-syncs whenever a
schema-relevant part of the graph changes. So a trace of one action reads:

```
[Trace] action <name> …            ← the action mutated the graph
[Trace] ▼ schemaSync (central)     ← the ONE subscriber fired (microtask later)
[Trace]   schema <nodeId> = […]    ← each recomputed node
```

| UI action | Store action | What it mutates (schema resyncs centrally after) |
|---|---|---|
| Drag a node from palette | `addNode` | adds node; if subflow, `refreshSubflowCache` (fetch → cache bump) |
| Draw an edge | `onConnect` | adds edge; if source is a subflow, `refreshSubflowCache` |
| Edit a setting | `updateNodeSettings` | merges settings; if subflow `subflowId` changed, `refreshSubflowCache(true)` |
| Delete a node | `removeNode` / `removeSelectedNodes` / `onNodesChange(remove)` | drops node + edges |
| Delete an edge | `onEdgesChange(remove)` | drops edge |
| Undo / Redo | `undo` / `redo` | restores a graph snapshot |
| Save (Ctrl+S) | `saveWorkflow` | `PUT` (existing) or `POST` (new; stamps `projectId`, `isSubflow`) — no schema effect |
| Open a workflow | `loadWorkflow` | sets nodes/edges + `refreshSubflowCache` |
| New Workflow | `clearWorkflow` | empties graph (+ explicit `clearSchemas`) |
| Group as node | `createSubflowFromSelection` | replaces selection with a proxy + `refreshSubflowCache` |
| Enter / exit subflow | `enterSubflow` / `exitSubflow` | swaps the canvas graph |
| Switch project | `setCurrentProject` + `clearWorkflow` | blank canvas |

### The golden rule of schema updates
Schema is a **pure function of `{nodes, edges, subflowCache}`**, resynced from ONE place
(`schema-sync.ts`). An action never needs to "trigger" schema — it just mutates the graph.
The subscriber recomputes on a **schema-relevant fingerprint change** (node id/type/
settings, edge endpoints/handles, `subflowCacheVersion`) and skips cosmetic churn
(drag/selection). `subflowCache` is a hidden input to expansion, so fetching a subflow
bumps `subflowCacheVersion` to force a resync.

If a downstream node shows no columns: turn on the tracer and look for
`schema <nodeId> = […]`. Empty/missing → the fingerprint didn't change (did the graph
actually change?), or the subflow cache isn't populated (look for a `refreshSubflowCache`
action and its `GET /pipelines/:id` fetch in the trace).

---

## 3. Existing logs (independent of the tracer)

### Editor
All are raw `console.*`. Errors are `console.error` in `catch` blocks — search for the
message. Notable: save failures (`workflow-store.ts`), subflow fetch failures
(`refreshSubflowCache`), node-def/project load failures (`App.tsx`), preview/schema
detection failures (`PropertyPanel.tsx`, `PreviewPanel.tsx`).

### Server (`apps/server`)
- Fastify's logger is **off by default** and enabled in prod startup with
  `logger: { level: process.env.LOG_LEVEL || 'info' }` (`index.ts`). Set `LOG_LEVEL=debug`
  for verbose request logs (raw pino JSON — pipe through `pino-pretty` if desired).
- Error handler logs only unexpected 500s (`errors.ts` → `request.log.error`); 4xx
  `ApiError`s are not logged.
- Always-on tagged startup logs: `[BeamFlow]`, `[Database]`, `[Migrations]`, `[Storage]`,
  `[buildApp]`.

### Inspecting the database directly
The dev DB is SQLite at `apps/server/beamflow.db`. To see what actually persisted
(e.g. is a workflow flagged `is_subflow`? which `project_id`?):
```bash
python - <<'EOF'
import sqlite3, json
con = sqlite3.connect('apps/server/beamflow.db')
for r in con.execute("SELECT name,is_subflow,project_id FROM workflows ORDER BY updated_at DESC LIMIT 10"):
    print(r)
EOF
```
Or `npx drizzle-kit studio` from `apps/server` for a GUI.

---

## 4. Common failure signatures

| Symptom | Likely cause | Where to look |
|---|---|---|
| Filter/downstream column dropdown empty | subflow not re-inlined; `subflowCache` empty or no full re-sync | trace for `schema <filterId>`; `refreshSubflowCache` in `workflow-store.ts` |
| New workflow "not saved" / not in list | saved as `isSubflow=1` (stale flag) or wrong project scope | DB `is_subflow`/`project_id`; `clearWorkflow` reset; Workflows modal filter |
| "Target node not found" on preview | preview triggered before save | `PropertyPanel.tsx` preview handler must `await saveWorkflow()` first |
| Preview shows stale data / stuck error | preview cache `stale`/`failed` state | [preview-and-troubleshooting.md](preview-and-troubleshooting.md) |
| Subflow code-gen fails "Required input port not connected" | proxy rewiring uses wrong port id | server `expandSubflows` in `routes/pipelines.ts` |
| UI change "doesn't show up" | duplicate Vite servers / stale bundle / HMR kept old store | check ports 517x, clear `apps/editor/node_modules/.vite`, hard-refresh |
| **Drop/add does nothing; or one component's state change never reaches another** | **duplicate store instance from mismatched import specifiers** (see §4.1) | `grep` the store's import strings; unify them |

> **Stale-bundle warning (important):** Zustand stores are module singletons. Vite HMR
> often keeps the *old* store instance in memory after you edit `workflow-store.ts` or
> `schema-store.ts`, so a fix appears not to work. When a store change "isn't taking
> effect": stop the dev server, `rm -rf apps/editor/node_modules/.vite`, restart one
> server, hard-refresh (Ctrl+Shift+R).

### 4.1 Duplicate store from mismatched import specifiers

**Signature:** an action clearly runs but has no effect — e.g. dropping a palette node does
nothing, or state you set in one component is never seen by another. No error is thrown.

**Cause:** a store module's identity IS its store — the top-level `export const useX =
create(...)` runs *once per loaded module*. Vite/ESM key the module cache by the **exact
import string**, resolved *before* it maps to a file. So importing the same file two ways —
`'../store/workflow-store'` in one file and `'../store/workflow-store.js'` in another —
loads it **twice**, runs `create(...)` **twice**, and yields **two independent stores**.
Components then split across the two: whoever writes state (e.g. `App.tsx` calling
`setNodeDefinitions`) may land on store B while whoever reads it (Canvas/NodePalette) is on
store A. The classic failure was drop-does-nothing: `addNode` on store A found an empty
`nodeDefinitions` and silently hit `if (!def) return`. Same hazard for any editor singleton
(`schema-store`) and, for `api/client`, a cross-copy `instanceof` failure (e.g. `ConflictError`).

**How to check (do this first when the signature matches):**
```bash
# From apps/editor/src — one specifier per singleton means one line of output.
grep -rn "store/workflow-store\(\.js\)\?['\"]" --include=*.ts --include=*.tsx . | grep -v test
grep -rn "schema-store\(\.js\)\?['\"]"        --include=*.ts --include=*.tsx . | grep -v test
grep -rn "api/client\(\.js\)\?['\"]"          --include=*.ts --include=*.tsx . | grep -v test
```
If you see **both** `.../x` and `.../x.js` for the same module, that's the bug. To confirm at
runtime, temporarily log in the reading component: `console.warn(useWorkflowStore.getState().nodeDefinitions.length)`
— `0` while the palette shows nodes proves the reader is on the empty duplicate store.

**Fix:** normalize every app-code import of that module to ONE specifier (the repo standard
is **extensionless** — `'../store/workflow-store'`, the form Canvas/NodePalette/schema-store
use). Never add a `.js` variant of a store/singleton import. After fixing, **hard-refresh** —
a duplicate store lingers in browser memory until a full reload (see the stale-bundle box).

**Prevent:** when adding a new import of any shared singleton, copy the exact specifier an
existing render-critical file uses; don't hand-type `.js`.

---

## 5. Tests

### Run them
```bash
pnpm --filter @beamflow/editor test          # editor unit + component tests
pnpm --filter @beamflow/server test          # server route/storage tests
pnpm test                                     # everything (turbo)
```

### Two kinds of editor test
- **Store / logic tests — `*.test.ts` (node env, fast).** Drive the real Zustand
  stores + schema engine headlessly; mock only `api`. Example:
  `apps/editor/src/lib/subflow-schema.test.ts` asserts the exact value PropertyPanel
  reads (`schemas.get(subflowNodeId).outputSchema.columns`) across load and interactive
  build paths, plus regression guards for the warm-cache and connect-from-subflow bugs.
- **Component / visual tests — `*.test.tsx` (jsdom).** Render real components and assert
  the DOM the user sees. Example: `apps/editor/src/components/PropertyPanel.test.tsx`
  asserts the Filter downstream of a subflow renders a column `<select>` (with the
  subflow's columns as options), and falls back to a text input when there's no upstream
  schema. Component tests opt into jsdom with a top-of-file docblock:
  ```ts
  // @vitest-environment jsdom
  ```
  Setup (jest-dom matchers + React Flow DOM stubs) is in `apps/editor/src/test/setup.ts`;
  config is in `apps/editor/vite.config.ts` (`test` block).

### Writing a new component test
1. Name it `*.test.tsx` and add `// @vitest-environment jsdom` at the top.
2. `vi.mock('../api/client', …)` to stub network calls; import the store AFTER the mock.
3. Populate the stores (`loadWorkflow` / `addNode` / `setSelectedNode`), `await flush()`
   for async effects, then `render(<Component/>)` and assert with `screen.getByRole(...)`.
4. React Flow canvas rendering needs the stubs in `setup.ts`; for pure panels (like
   PropertyPanel) no canvas is required.

### When to add which
- Fixed a **store/schema propagation** bug → add a `*.test.ts` regression guard.
- Fixed a **rendering / what-the-user-sees** bug → add a `*.test.tsx` component test.
- Both, when the bug spanned store and UI (like the empty-dropdown regression).
