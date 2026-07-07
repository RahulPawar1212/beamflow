# BeamFlow Architecture & Troubleshooting Guide

This guide is designed for developers (junior to senior) working on the BeamFlow project. It covers the core execution model, how the frontend and backend synchronize state, how preview caching works, and how to debug common issues.

## 1. Core Execution Model

BeamFlow is a visual node-based editor that generates Apache Beam pipelines. 

**Frontend (`apps/editor`)**:
- Uses `react-flow-renderer` to manage the visual Directed Acyclic Graph (DAG) (nodes and edges).
- Uses `zustand` (`workflow-store.ts`) for global state management.
- Handles user interactions, updates node settings, and manages the `isDirty` flag.

**Backend (`apps/server`)**:
- Exposes REST APIs for pipeline CRUD (`/api/pipelines`).
- Manages pipeline execution and code generation (`POST /execute`, `POST /generate`).
- Uses `Drizzle ORM` with SQLite (`workflows` table) to store pipeline state (`settingsJson`).

**Execution Packages**:
- `packages/graph`: Serializes and deserializes the workflow between the frontend React Flow state and the backend graph (`DAG` class).
- `packages/ir`: Converts the DAG into an Intermediate Representation (IR).
- `packages/execution`: Takes the IR and generates Python Apache Beam code (`generatePythonBeam`), then executes it via the Python DirectRunner.

---

## 2. State Synchronization and Auto-Save

A common source of bugs in node-based editors is a mismatch between the frontend state and the backend state.

### The `isDirty` Flag
Whenever a user modifies the graph (adds a node, changes a connection, edits a node setting in the Property Panel), the `isDirty` flag in `workflow-store.ts` is set to `true`.

### Action Triggers (Run, Generate, Preview)
When the user clicks an action button (e.g., "Run", "Generate Code", or "Preview Data"), the frontend must **always** ensure the backend has the latest graph.
- **Run/Generate (`Toolbar.tsx`)**: The UI checks if `isDirty` is true. If it is, it calls `handleSave()` which sends a `PUT /api/pipelines/:id` request to the backend *before* triggering the execution.
- **Preview Data (`PropertyPanel.tsx`)**: Similar logic is applied. Clicking "Preview Data" forces a `saveWorkflow()` if `isDirty` is true.

**Important Rule**: *Never trigger a backend execution or preview generation without ensuring the frontend state is saved first.* If you do, the backend will attempt to process a graph that doesn't contain the user's latest nodes or settings, leading to "Target node not found" or stale data errors.

---

## 3. Preview Caching Architecture

To avoid running expensive Apache Beam pipelines repeatedly for the same data, BeamFlow employs a sophisticated preview caching layer.

### How Preview Works
1. **Triggering**: When a user clicks "Preview Data" on a node, `api.triggerPreview()` sends a `POST /api/pipelines/:id/nodes/:nodeId/preview` request.
2. **Background Execution**: The backend returns `202 Accepted` immediately and starts a background job via `PreviewManager`.
3. **Graph Truncation**: The backend generates a *truncated DAG* that only includes the target node and its upstream dependencies. It attaches a `PreviewFeatherSink` to the target node.
4. **Feather Storage**: The Apache Beam pipeline executes and writes the output directly to a local Apache Arrow (Feather) file on the server.
5. **Polling**: The frontend `PreviewPanel` polls the `GET /api/pipelines/:id/nodes/:nodeId/preview` endpoint every 2 seconds.

### The Cache State Machine
The cache metadata is managed by `PreviewCacheManager` (`packages/execution/src/preview/cache.ts`) and stores the status of each preview:
- `running`: The background Python job is executing.
- `success`: The job finished and the Feather file is ready to be read.
- `failed`: The job failed (e.g., invalid SQL query, python exception, or missing node). The error is stored permanently in the cache.
- `stale`: The cache was previously successful, but the pipeline has since been updated.

### Cache Invalidation (`PUT /api/pipelines/:id`)
When the frontend saves the workflow (e.g., when `isDirty` is true and auto-save triggers), the backend's `PUT` route automatically invalidates the cache for all nodes in the pipeline by changing their status from `success`/`failed` to `stale`. 

---

## 4. Troubleshooting Guide

### Issue: "Target node not found in workflow"
**Symptoms**: The user clicks "Preview Data" on a newly added node, and the preview panel shows "Preview Generation Failed: Target node not found in workflow".
**Root Cause**: The frontend triggered the `POST /preview` endpoint *before* saving the workflow. The backend read the old workflow from the SQLite database, which didn't have the new node. 
**Solution**: Ensure `saveWorkflow()` is awaited successfully before calling `api.triggerPreview()`. (This was fixed in `PropertyPanel.tsx`).

### Issue: Preview Panel shows "Stale (Upstream changed)" but continues showing old data
**Symptoms**: The user changes a setting, but the preview data doesn't update.
**Root Cause**: When the cache status is `stale`, the `GET` route still returns the old Feather file data so the user can look at it. However, if the UI doesn't explicitly call the `POST /preview` endpoint (triggering a fresh run), it will never update.
**Solution**: The "Preview Data" button in the Property Panel must *always* fire a `POST` request to force a fresh run, rather than just opening the panel.

### Issue: The Preview Panel is permanently stuck on an Error
**Symptoms**: A preview failed once. The user fixes the issue, clicks "Preview Data", but the same error instantly appears without the loading spinner.
**Root Cause**: The error state (`status: 'failed'`) is permanently stored in the `PreviewCacheManager`. If the UI only opens the panel (triggering a `GET` request) without firing a new `POST` request, it will just read the cached error.
**Solution**: Always ensure that user-initiated "Preview Data" clicks force a fresh `POST /preview` request. (This was fixed by removing the `wasDirty` check constraint on `api.triggerPreview` in `PropertyPanel.tsx`).

### Debugging Steps for Future Issues
1. **Check the Network Tab**: 
   - Ensure a `PUT` request is sent (saving the workflow).
   - Ensure a `POST` request is sent (triggering the preview).
   - Ensure `GET` requests are polling and look at the `status` field in the JSON response.
2. **Check Backend Logs**: 
   - The backend runs `tsx watch src/index.ts`. Look for Python execution errors or missing node errors here.
3. **Inspect the SQLite Database**: 
   - Run `npx drizzle-kit studio` or use a local script to read `apps/server/beamflow.db`. 
   - Check the `workflows` table to ensure the `settings_json` matches what you expect.
