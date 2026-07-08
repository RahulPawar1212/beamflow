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
`trace` and call `trace.action('name', detail)` or wrap effects in
`trace.group('name'); …; trace.groupEnd();`.

---

## 2. Reading the flow: what each UI action does

When a UI action "doesn't update", these are the internal steps to expect. If the
trace stops early, the break is at that step.

| UI action | Store action | Key effects (in order) |
|---|---|---|
| Drag a node from palette | `addNode` | pushHistory → add node → `syncFromWorkflow` (full schema rebuild) → if subflow, `refreshSubflowCache` |
| Draw an edge | `onConnect` | pushHistory → add edge → **if source is a subflow** `refreshSubflowCache` (full re-sync) **else** `onEdgeAdded` (incremental) |
| Edit a setting in the panel | `updateNodeSettings` | pushHistory → merge settings → **subflow node**: full `syncFromWorkflow` (+ refetch on `subflowId`); **other**: `onNodeSettingsChanged` (incremental) |
| Delete a node | `removeNode` | pushHistory → drop node + edges → `syncFromWorkflow` |
| Save (Ctrl+S / button) | `saveWorkflow` | `toWorkflow()` → `PUT` (existing) or `POST` (new, stamps `projectId`, `isSubflow`) |
| Open a workflow | `loadWorkflow` | map DTO → set nodes/edges → reset history → `refreshSubflowCache` |
| New Workflow | `clearWorkflow` | reset pipelineId/name/**isSubflow**/params/navStack + graph → `clearSchemas` |
| Group as node | `createSubflowFromSelection` | build sub-workflow → `POST` (isSubflow, projectId) → replace selection with proxy → `syncFromWorkflow` → `refreshSubflowCache` |
| Double-click a subflow node | `enterSubflow` | push nav stack → `loadWorkflow(child, clearStack=false)` |
| Breadcrumb back | `exitSubflow` | pop nav stack → restore parent → `syncFromWorkflow` → `refreshSubflowCache(true)` |
| Switch project | `setCurrentProject` + `clearWorkflow` | set project → blank canvas (open pipeline belonged to old project) |

### The golden rule of schema updates
Schema only propagates correctly after a **full `syncFromWorkflow`** (which re-inlines
subflows). The incremental paths (`onEdgeAdded`, `onNodeSettingsChanged`) do **not**
re-inline subflows. Any action that touches a subflow boundary must route through
`refreshSubflowCache`/`syncFromWorkflow` — this is the root cause of past "empty column
dropdown" bugs. If a downstream node shows no columns, check the trace for a `schema`
line for that node; if it's missing or empty, a re-sync didn't fire.

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

> **Stale-bundle warning (important):** Zustand stores are module singletons. Vite HMR
> often keeps the *old* store instance in memory after you edit `workflow-store.ts` or
> `schema-store.ts`, so a fix appears not to work. When a store change "isn't taking
> effect": stop the dev server, `rm -rf apps/editor/node_modules/.vite`, restart one
> server, hard-refresh (Ctrl+Shift+R).

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
