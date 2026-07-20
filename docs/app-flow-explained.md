# BeamFlow — App Flow Explained (plain-programming terms)

For someone who knows programming but not React. No fluff, real file references.

## The big picture: three programs talking to each other

Think of it as client / server / worker, same as any web app:

1. **Browser app** (`apps/editor`) — a single-page UI. Runs on `:5173` in dev.
2. **API server** (`apps/server`) — a Fastify REST server on `:3001`. Stores data, generates Python code, runs it.
3. **Generated Python** — actual Apache Beam pipeline code, executed as a subprocess by the server.

The browser talks to the server only over HTTP (`fetch`), same as any React/Vue/vanilla-JS app would. Nothing exotic there.

## What React actually is

Forget the marketing. React is: **a function that re-runs and re-draws the screen whenever some tracked variable changes.** That's it.

- A "component" = a function that returns a description of HTML (JSX — looks like HTML embedded in JS/TS, e.g. `<Toolbar />` in `App.tsx`).
- React calls that function again automatically whenever its tracked inputs change, and patches the real DOM to match the new output. You never manually call `document.querySelector` and mutate elements — you just say "here's what the UI should look like given this data" and React diffs it for you.
- `useEffect(() => {...}, [deps])` = "run this side-effect function once after render, and again whenever anything in the `[deps]` array changes." It's the mechanism for things that aren't pure rendering — API calls, timers, subscriptions.

## Entry point: `main.tsx` → `App.tsx`

`main.tsx` is the actual `<script>` entry — it just mounts the `App` component into the page's root `<div>`. Nothing interesting there.

`App.tsx` is the real root. Walking it top to bottom, like a `main()` function:

```
if (!token) return <LoginPage />        // App.tsx:86-88 — not logged in? Show login, stop.

useEffect: initTheme()                   // load dark/light/mid theme from storage
useEffect: loadCustomNodeDefs()          // load user's custom node types from localStorage
useEffect: fetch('/api/nodes')           // ask server "what node types exist?" (built-ins + plugins)
useEffect: fetch('/api/projects')        // ask server "what project should be active?"

return (
  <Toolbar />          // top bar: save/run/undo/export buttons
  <NodePalette />       // left sidebar: draggable list of node types
  <AIPanel />           // AI-assisted flow builder panel
  <Canvas />            // the middle drag-and-drop diagram surface
  <PropertyPanel />     // right sidebar: settings form for selected node
  <Toasts />            // popup notifications
)
```

That's the whole shell. Each of those is a separate function/file under `components/`. This is the equivalent of a `main()` that wires up a window with 5 panels — nothing more magical than that.

## Where is "state" actually stored?

This is the part that replaces React's normal per-component state. BeamFlow uses **Zustand** — think of it as a global, plain-JS singleton object with functions attached, that any component can read from or call into. Not React-specific machinery, just a shared mutable store with a subscribe mechanism.

`store/workflow-store.ts` is the single source of truth: it's one big object holding:

- `nodes` / `edges` — literally the diagram: an array of node objects (id, position, type, settings) and an array of edges (`{source, target}`) — this is the DAG.
- `selectedNodeId` — which node is currently clicked (drives whether `PropertyPanel` renders).
- `history` / `historyIndex` — an array of full snapshots for undo/redo (literally: `[{nodes, edges}, {nodes, edges}, ...]` plus a pointer).
- `nodeDefinitions` — the catalog of available node *types* (CSV source, Filter, GroupBy...), merged from server built-ins + user custom nodes.
- `isGenerating` / `isExecuting` / `executionLogs` / `executionStatus` — flags and data for the "Generate Python" and "Run" buttons.

Any component calls `useWorkflowStore((s) => s.nodes)` to read a slice of it, and Zustand handles "only re-render this component if `.nodes` specifically changed." Any component (or plain code, via `useWorkflowStore.getState()`) can call an action like `setCurrentProject(...)` to mutate it. It's a shared object with pub/sub — same idea as Redux, or honestly like a global with an event emitter attached.

## The actual pipeline flow, end to end

```
1. You drag a node from NodePalette onto Canvas
      -> workflow-store.addNode(...) pushes into `nodes` array
      -> React Flow (the canvas library) re-renders the box on screen

2. You connect two nodes with a line
      -> workflow-store.onConnect(...) pushes into `edges` array

3. You click a node -> PropertyPanel shows a form
      -> form edits write into node.data.settings (plain JS object, per node)

4. You click "Generate Code" in Toolbar
      -> store serializes {nodes, edges} -> calls api.generateCode(workflow)
      -> HTTP POST to the Fastify server

5. SERVER SIDE (apps/server):
      graph-model (packages/graph) turns {nodes, edges} into a validated DAG
          v
      IR builder (packages/ir) turns the DAG into an intermediate step-list
      (this is the decoupling point -- editor doesn't know Python exists)
          v
      beam-generator (packages/beam-generator) turns IR into an actual .py file
          v
      response: generated Python source text sent back to browser

6. You click "Run"
      -> server's execution engine (packages/execution) spawns the Python
        file as a subprocess (Beam DirectRunner), streams stdout back
      -> browser shows it live in executionLogs
```

Nothing here needs React beyond "when `executionLogs` changes in the store, re-render the log panel." The actual engineering — graph validation, IR, codegen, subprocess execution — is plain TypeScript/Python, no framework involved.

## Subflows

A **subflow** is just a saved pipeline that can be embedded as a single node inside another pipeline (like calling a function you wrote earlier). The editor's `navigationStack` in the store is literally a stack of `{nodes, edges, history}` snapshots — "drilling into" a subflow pushes the parent's current diagram onto that stack and loads the subflow's diagram in its place; "back" pops it. Same mental model as pushing/popping a call stack, just for UI state instead of function calls.

See `docs/subflows.md` for the deep dive.
