# BeamFlow Architecture & Developer Onboarding Guide

Welcome to BeamFlow! This document is designed to give technical team members—from junior developers to senior architects—a comprehensive understanding of how the application works under the hood. 

BeamFlow is a visual ETL/ML pipeline builder that lets users drag and drop nodes on a canvas, connects them into a DAG (Directed Acyclic Graph), and automatically translates that visual graph into production-ready **Apache Beam Python code**.

---

## 1. High-Level Pipeline (How it works)

Understanding how a visual diagram becomes running code is the most important concept in BeamFlow. The data flows through 5 distinct layers:

1. **Visual Editor (`apps/editor`)**: The React Flow UI where users build the graph.
2. **Graph Model (`packages/graph`)**: The UI state is serialized into a standard DAG (Directed Acyclic Graph) model. It performs topological sorting to figure out which nodes run first.
3. **Intermediate Representation (`packages/ir`)**: The DAG is converted into an "IR" (Intermediate Representation). *This is the critical decoupling layer.* The visual editor knows nothing about Python. It just says "this is a filter operation".
4. **Code Generator (`packages/beam-generator`)**: Reads the IR and emits actual Python Apache Beam code (e.g., `p | beam.Map(...)`).
5. **Execution Engine (`packages/execution`)**: Takes the generated Python string, builds an isolated Python Virtual Environment (`.venv`), installs dependencies, and runs the script using Beam's `DirectRunner`.

---

## 2. Monorepo Structure

We use a **pnpm workspace** powered by **Turborepo** (`pnpm build`, `pnpm dev`). The codebase is split into `apps` (runnable servers) and `packages` (internal libraries).

### Apps
* `apps/editor`: The Frontend. React, Vite, Tailwind CSS v4, React Flow, and Zustand for state management.
* `apps/server`: The Backend. Fastify REST API. It handles saving workflows to disk, triggering code generation, and running pipelines.

### Core Packages
* `packages/core`: The Node Registry. It manages the plugin system.
* `packages/shared`: Shared TypeScript types and utilities used by both frontend and backend.
* `packages/nodes`: The actual built-in nodes (e.g., CSV Source, SQL Source, Filter, Map). **Notice how nodes are just plugins!**
* `packages/plugin-sdk`: A public SDK that allows developers to author custom nodes without touching the core engine.

---

## 3. Frontend Architecture

The visual editor (`apps/editor`) is built for high performance and premium aesthetics.

* **State Management (`Zustand`)**: Located in `store/workflow-store.ts`. This is the single source of truth for nodes, edges, selection state, and the 50-level Undo/Redo history.
* **UI Components (`shadcn/ui`)**: We use Radix primitives via `shadcn/ui` (in `src/components/ui`). They are styled using Tailwind CSS and inherit our CSS variables (from `index.css`) to support Light/Mid/Dark themes out of the box.
* **Canvas (`React Flow`)**: The interactive canvas is powered by `@xyflow/react`.
* **API Client**: `api/client.ts` is a strictly typed `fetch` wrapper that talks to the Fastify backend.

---

## 4. Backend & Execution Engine

The backend (`apps/server`) does more than just save JSON files. It actually runs Python code on the host machine.

### The Virtual Environment (`.venv`)
Every time a user clicks "Run" or "Preview", the `packages/execution` engine steps in.
1. It looks at the generated Python code and determines required pip packages (e.g., `apache-beam`, `sqlalchemy`).
2. It provisions a **Shared Virtual Environment** in the OS Temp directory (e.g., `C:\Users\<user>\AppData\Local\Temp\beamflow\shared_venv`).
3. It runs `pip install` inside this `.venv`. Because the environment is persistent, subsequent runs take milliseconds instead of minutes.
4. It executes the Python script using this `.venv` and streams `stdout/stderr` logs back to the frontend via WebSockets/Polling.

### Data Previews (Apache Arrow) & Caching Logic
When a user previews a specific node, the backend injects a `Sample.FixedSizeGlobally(100)` step into the Beam pipeline and writes the output to an **Apache Arrow `.feather` file**. 

To make the UI lightning fast, these `.feather` files are heavily cached:
1. **Storage Location:** Caches are stored locally on the server at `apps/server/.beamflow/previews/`. Each node gets its own `.feather` data file and a `metadata.json` state file.
2. **State Machine (`ready` vs `stale`):**
   * When a preview completes successfully, its cache is marked as `ready`.
   * If a user clicks "Preview Data" again, the Fastify server reads the `ready` cache instantly without triggering a new Python run.
   * **Cache Invalidation:** Whenever a user edits ANY setting in the property panel, the frontend calls `PUT /api/pipelines/:id`. The backend intercepts this and automatically marks ALL preview caches in that workflow as `stale`. 
   * When the frontend UI detects `stale` data, it displays a blue **"Stale (Upstream changed)"** warning banner next to a **Refresh** button, allowing the user to optionally trigger a fresh execution.

#### Debugging the Cache
If you ever suspect the UI is serving old data (or if the blue `Stale` banner refuses to appear):
* **Check the Network Tab:** Look at the response from `GET /api/pipelines/:id/nodes/:nodeId/preview`. You will see `"status": "ready"` or `"status": "stale"` in the metadata.
* **Force Invalidation:** Make a trivial edit to the node in the Property Panel (e.g., add and remove a space). This forces a `PUT` request to the backend which runs the `previewCache.invalidatePreviews` logic.
* **Nuclear Option:** Manually delete the `apps/server/.beamflow/previews/` directory on the server file system and restart the server. This will completely wipe all caches and force clean runs.

---

## 5. Adding New Nodes (The Plugin System)

You will never "hardcode" a new node into the React canvas. Everything is a plugin.
To add a new node (e.g., a "Postgres Source"), you define it using the `@beamflow/plugin-sdk`:

```typescript
import { defineNode, outputPort, textSetting, NodeCategory, IRStepType } from '@beamflow/plugin-sdk';

const postgresNode = defineNode({
  type: 'sql:postgres',
  name: 'Postgres Source',
  category: NodeCategory.Source,
  ports: [outputPort('out', 'Output')],
  settings: [ textSetting('query', 'SQL Query') ],
  toIR(settings) {
    return {
      operation: 'ReadFromSQL',
      stepType: IRStepType.Source,
      params: { query: settings.query }
    };
  }
});
```
The React frontend automatically reads this definition, paints the node on the palette, generates the settings form, and wires up the inputs/outputs.

---

## 6. Developer Gotchas (Read Carefully!)

Junior devs, pay close attention to these known quirks in the codebase to save yourself hours of debugging:

1. **Tailwind v4 `*` Selector Bug:** 
   * NEVER add `* { padding: 0; margin: 0; }` to `index.css`. In Tailwind v4, unlayered CSS beats `@layer utilities`. Doing this will silently break every single `p-4` or `m-2` class across the entire application!
2. **BigInt Serialization Crashes:** 
   * When pulling SQL Server `INT64` data, Apache Arrow converts it to JavaScript `BigInt`. 
   * `JSON.stringify()` (which Fastify uses) **will crash with a 500 Error** if it encounters a `BigInt`. 
   * *Fix:* The `PreviewCacheManager` (`packages/execution/src/preview/cache.ts`) must intercept and manually downcast `BigInt` objects to standard Numbers/Strings before sending payload to the frontend.
3. **Duplicate Dev Servers:** 
   * If you run `pnpm dev` twice, Vite will silently start the editor on port `:5174` instead of `:5173`. You might be staring at the `:5173` tab wondering why your UI changes aren't updating! Always check your terminal output to confirm the port.
4. **Spacing UI Components:**
   * Avoid Tailwind's `space-y-*` classes. They are notoriously unreliable in this stack. Always prefer wrapping items in a Flexbox container: `flex flex-col gap-4`.

---

## 7. Getting Started Workflow

1. Open your terminal in the root `beamflow` directory.
2. Run `pnpm install`
3. Run `pnpm build` (this ensures all internal packages are linked and compiled)
4. Run `pnpm dev`
5. Open `http://localhost:5173` in your browser.
6. The Backend server runs on `http://localhost:3001` and is automatically proxied by Vite, so your frontend code can simply call `fetch('/api/...')`.
