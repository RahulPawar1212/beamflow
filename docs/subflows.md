# Subflows — Reusable Nested Pipelines

A **subflow** is a pipeline that is embedded inside another pipeline as a single
reusable node. The user selects a group of nodes on the canvas, "groups" them into
a subflow, and from then on the parent shows one **proxy node** in place of the group.
The subflow itself is a normal pipeline row in the database (flagged `isSubflow`), so
it can be edited independently and referenced by many parents.

Subflows are a **user-global shared library**: they are *not* tied to a project, are
reusable from any project, and are attached to a parent either by "Group as node" or
by dragging the **Subflow** node from the palette and picking an existing one. See
[§10 Shared library](#10-shared-library-global-scope-picker-references).

This document describes how subflows are represented, persisted, expanded for schema
propagation and code generation, previewed, and reused. It complements
[architecture.md](architecture.md), [schema-propagation.md](schema-propagation.md),
and [db-auth-architecture.md](db-auth-architecture.md).

---

## 1. The three system node types

Subflows are built entirely out of three built-in node types registered by
`@beamflow/nodes` (`packages/nodes/src/system/`). They are ordinary plugin nodes — the
subflow machinery is not special-cased in the registry.

| Type | Lives in | Ports | Key settings | Role |
|---|---|---|---|---|
| `system:subflow` | the **parent** pipeline | `in` (multi), `out` (multi) | `subflowId` | Proxy standing in for the whole nested pipeline. |
| `system:subflow-input` | **inside** the subflow | `out` | `inputName`, `mockColumns` | Boundary: data entering the subflow from the parent. Acts as a *source* within the subflow. |
| `system:subflow-output` | **inside** the subflow | `in` | `outputName` | Boundary: data leaving the subflow back to the parent. Acts as a *sink* within the subflow. |

The `inputName` / `outputName` settings double as **port identifiers** — see
[§5 Multi-input / multi-output](#5-multi-input--multi-output-port-mapping).

---

## 2. Creating a subflow (grouping)

`createSubflowFromSelection` in `apps/editor/src/store/workflow-store.ts` does the work:

1. Split the selected nodes' edges into **internal** (both ends selected),
   **inbound** (only target selected), and **outbound** (only source selected).
2. Build the subflow document: the selected nodes, their internal edges, plus one
   `system:subflow-input` per inbound edge (`inputName = "Input N"`) and one
   `system:subflow-output` per outbound edge (`outputName = "Output N"`).
3. `POST /api/pipelines` with `isSubflow: true` → the subflow is persisted and gets its
   own id.
4. Replace the selected nodes in the parent with a single `system:subflow` proxy whose
   `settings.subflowId` points at the new subflow.
5. Rewire the parent's boundary edges onto the proxy, **carrying the boundary port name
   as the handle** (`targetHandle = "Input N"`, `sourceHandle = "Output N"`), so the
   port mapping survives (§5).

---

## 3. Persistence — what must round-trip

A subflow is a normal `SerializedWorkflow` with two extra pieces of metadata
(`packages/shared/src/types.ts`):

```ts
interface IWorkflowMetadata {
  // …
  isSubflow?: boolean;                          // "this pipeline is meant to be nested"
  parameters?: ReadonlyArray<ISubflowParameter>; // internal settings exposed to the parent
}

interface ISubflowParameter {
  id: string;             // e.g. "param_1" — also the proxy setting key on the parent
  name: string;           // human label
  type: 'string' | 'number' | 'boolean' | 'enum';
  targetNodeId: string;   // internal node whose setting this drives
  targetSettingKey: string; // the setting key on that internal node
}
```

Both fields must survive **create and update**. Historically the create path dropped
them (the editor sent only `{name, nodes, connections}` and the server's POST body type
didn't even mention `parameters`), so a freshly-saved subflow silently lost its
`isSubflow` flag and every exposed parameter. The save path now forwards both:

- `saveWorkflow` / `duplicateWorkflow` (`workflow-store.ts`) pass
  `isSubflow` + `parameters` to `api.createPipeline`.
- `api.createPipeline` (`apps/editor/src/api/client.ts`) accepts them.
- `POST /api/pipelines` (`apps/server/src/routes/pipelines.ts`) reads and stores both
  (defaulting to `false` / `[]`).
- The DB has a dedicated `is_subflow` column (`apps/server/src/db/schema.ts`, migrations
  `0002_*`) alongside the full workflow JSON.

The main pipeline **list** (`GET /api/pipelines`) hides subflows by default; pass
`?includeSubflows=true` to include them, or `?subflowsOnly=true` for the shared library
(§10). A subflow's `projectId` is **null** — subflows are not project-scoped (§10).

---

## 4. Expansion — inlining a subflow

A subflow is never executed as a black box; it is **inlined** into its parent before
anything downstream runs. Expansion exists in **two places** that intentionally mirror
each other:

| Where | Function | Purpose |
|---|---|---|
| Editor | `expandNodesAndEdgesForSchema` in `apps/editor/src/lib/schema-store.ts` | Design-time schema propagation. |
| Server | `expandSubflows` in `apps/server/src/routes/pipelines.ts` | Code generation, execution, and preview. |

Both do the same core steps, recursively (max depth 10, guarding against cycles):

1. Find a `system:subflow` node and fetch the referenced subflow document
   (editor: from `subflowCache`; server: from `storage`).
2. Copy the subflow's internal nodes/edges with an id prefix `sub_<proxyNodeId>_`
   (nested subflows compound the prefix, outermost-first).
3. **Substitute parameters**: for each `ISubflowParameter`, if the proxy carries a value
   under `settings[param.id]`, write it into `internalNode.settings[targetSettingKey]`.
4. **Rewire the boundary** (§5).
5. Keep the proxy node as a **passthrough** so it remains addressable (e.g. for preview):
   - Editor: retype it to `system:subflow-proxy` and register a passthrough schema node.
   - Server: retype it to `system:subflow-output` (a passthrough sink) — every internal
     output edge is rewired to feed the proxy's single required `in` port.

> **Gotcha (server side):** the proxy becomes `system:subflow-output`, whose `in` port is
> `required`. Internal-output → proxy edges **must** target port id `in` — not the output
> *name* — or graph validation fails with *"Required input port "Data" is not connected"*.
> Per-output fan-out to the parent's downstream nodes rides on the restored parent-out
> edges, which keep their original `sourcePortId` (the output name).

---

## 5. Multi-input / multi-output port mapping

Because the proxy declares only generic `in`/`out` ports, distinguishing *which* of
several inputs/outputs an edge belongs to relies on the boundary **port names** as
handles. The scheme is name-based end-to-end, with an **index-0 fallback** so subflows
saved before this scheme still expand:

- **Grouping** stamps `targetHandle = inputName` / `sourceHandle = outputName` on the
  rewired parent edges.
- **Editor expansion** builds `inputName → internal-input-node-id` and
  `outputName → internal-output-node-id` maps and rewires each parent edge to the input
  node matching its `targetHandle`; unmatched → input `[0]`.
- **Server expansion** matches `parentEdge.targetPortId` against each input node's
  `inputName`, and only fans a parent input into the internal edges originating at that
  matched input node; unmatched → input `[0]`.
- **Canvas rendering** (`apps/editor/src/components/nodes/CustomNodes.tsx`) reads the
  referenced subflow's boundary node names from `subflowCache` and draws one handle per
  named port when a subflow has more than one input or output.

---

## 6. Schema propagation across the boundary

The design-time schema engine (see [schema-propagation.md](schema-propagation.md)) runs
on the **expanded** editor graph, so schema flows through the inlined internal nodes
like any other subgraph. Two things make this correct:

- **Boundary schema nodes are registered** (`packages/nodes/src/schema/index.ts`):
  `system:subflow-input` uses `SubflowInputSchemaNode`; `system:subflow-output` and
  `system:subflow` use a `SubflowPassthroughSchemaNode` (`inputs[0] ?? emptySchema()`).
  Propagation is therefore explicit, not an accident of the "unknown node type"
  passthrough stub.
- **`SubflowInputSchemaNode` prefers the real upstream schema.** When the input node is
  wired to a parent upstream (an incoming edge exists), it forwards that schema **even if
  it is currently empty** — it only falls back to the design-time `mockColumns` when
  editing the subflow standalone (no incoming edge). This prevents fabricated columns
  from masking the real schema.

**Re-expansion on change.** The engine's incremental `onNodeSettingsChanged` touches only
the single proxy node — it does *not* re-inline. So when a `system:subflow` node's
settings change (a new `subflowId` **or** an exposed parameter value), `updateNodeSettings`
triggers a full `syncFromWorkflow` (re-expansion) instead, so downstream schema reflects
the new parameter substitution.

---

## 7. Preview

Preview (`packages/execution/src/preview/`) runs the same `expandSubflows` on the server,
then `generatePreviewPipeline` builds a truncated pipeline up to the target node and
appends a `PreviewFeatherSink`.

- **Target step resolution.** The preview sink must attach to the target node's IR step.
  It is resolved explicitly (step whose `id === targetNodeId`, else the last
  `${targetNodeId}__s<n>` step for composite nodes, else the last step) rather than
  assuming the target's step is last — which breaks on multi-branch DAGs.
- **Previewing the proxy** works because expansion keeps the proxy's id while retyping it
  to a passthrough; the target still resolves and shows the subflow's output data.
- **Previewing an internal node** would require sending its prefixed id
  (`sub_<proxyId>_<origId>`). `api.internalPreviewId` builds that id, but nothing calls it
  yet — the canvas has no "drill into subflow" UI, so this is plumbing left in place for
  a future feature.

---

## 8. End-to-end trace (worked example)

Parent: `CSV Source → [Subflow] → CSV Output`, where the subflow is
`Input 1 → Filter → Output 1` and exposes the filter's `value` setting as `param_1`. The
parent proxy sets `param_1 = "7"`.

After `expandSubflows` and code generation the emitted Beam graph is:

```
step_src                       # CSV Source
step_sub_<sf>_n_filter         # inlined Filter, value substituted with "7"
step_sf                        # proxy passthrough (system:subflow-output)
step_sink                      # CSV Output
```

Previewing the proxy node `sf` against a CSV with an `a=7` row returns exactly that row —
confirming inlining, parameter substitution, named-port wiring, and preview-sink
placement all line up.

---

## 9. Shared library (global scope, picker, references)

Subflows are a **user-global shared library** — define once, reuse in any workflow in
any project. This is deliberate: a subflow is like a shared function, so it is decoupled
from project ownership and lifecycle.

### Scope: subflows are not project-owned
- A subflow's `project_id` is **null**. The `POST /api/pipelines` route skips the
  default-project assignment when `isSubflow` is true (`routes/pipelines.ts`), and
  `createSubflowFromSelection` no longer sends a `projectId`.
- `workflowsRepo.list` applies a `projectId` filter to **regular workflows only** — it
  never hides subflows (`workflows.repo.ts`).
- Startup backfill (`ensureDefaultProjects`) excludes `is_subflow=1`, so subflows are
  never re-attached to a project on boot.

### Finding, attaching & managing subflows
- The **Subflows** toolbar button opens the **Subflow Library** modal
  (`SubflowLibraryModal` in `Toolbar.tsx`): search the library, **open** a subflow to
  edit it, or **delete** one (with the used-by guard below).
- The **Subflow** palette node is draggable; the boundary nodes
  (`system:subflow-input` / `-output`) are hidden from the palette (they only exist
  inside a subflow being edited) — filtered by type in `NodePalette.tsx`.
- Selecting a `system:subflow` node shows a **searchable picker** in the Property Panel
  (`SubflowPicker` in `PropertyPanel.tsx`): the whole library
  (`api.listSubflows` → `GET /api/pipelines?subflowsOnly=true`), each row showing
  **name + description + "used by N"**, filterable, excluding the currently-open
  workflow (no self-reference). Picking one sets `subflowId` (→ `refreshSubflowCache(true)`
  → central schema-sync) and relabels the node to the subflow's name.

### References & the "used by N" count
- A parent references a subflow via a `system:subflow` node with
  `settings.subflowId = <child id>`, embedded in the parent's `settings_json`.
- `workflowsRepo.countReferences(ownerId, subflowId)` scans the owner's workflows for
  that reference. Exposed at `GET /api/pipelines/:id/references` → `{ count, names[] }`,
  and folded into the `subflowsOnly` list as `usedByCount`.

### Deletion semantics
- **Deleting a project keeps its subflows.** `projectsRepo.delete` only deletes regular
  workflows (`is_subflow=0`) of that project and null-outs any subflow's `projectId` so
  the DB-level FK cascade can't take it either. The project-delete confirmation copy says
  so.
- **Deleting a subflow** is done from the Subflow Library modal (`Toolbar.tsx`).
  Referenced subflows warn but are allowed (user's choice): if `usedByCount > 0` the
  delete confirms with "Used by N workflow(s) … delete anyway?". (Warn-but-allow, not
  hard-block.)
- **The output boundary is auto-derived.** A subflow doesn't strictly need an explicit
  `system:subflow-output` node: the shared classifier `resolveSubflowOutputs`
  (`packages/shared/src/subflow-outputs.ts`, used by both the server `expandSubflows` and
  the editor's `expandNodesAndEdgesForSchema`) resolves the boundary — if there's no output
  node but exactly one **terminal** (a node with nothing after it), that terminal's output
  is used automatically. Grouping a "tail" selection also auto-adds one output up front.
  Deleting the output node of such a subflow therefore doesn't break it — it re-derives.
  Genuinely ambiguous cases (0 or >1 terminals with no output node, or an **orphaned**
  terminal in a multi-output subflow) raise a **clear, node-named error** on generate/run
  ("add a Subflow Output node…"); design-time schema **degrades gracefully** — valid
  outputs still propagate their columns downstream, and the offending node just carries a
  validation issue (nothing blanks).
- **A workflow referencing a deleted subflow fails gracefully.** `expandSubflows`
  (generate / execute / preview) throws a `badRequest` (400) with a clear, node-named
  message — *"Subflow node \"<label>\" (<id>) references a subflow that no longer exists.
  Pick a different subflow or remove the node."* — plus a structured `issues` entry
  (`nodeId`) so the editor can pinpoint the node. It is NOT a bare 500. Preview records
  the same message as a `failed` status so the panel shows it.

---

## 10. File map

| Concern | File |
|---|---|
| Output-boundary classifier (auto-derive/ambiguity) | `packages/shared/src/subflow-outputs.ts` (`resolveSubflowOutputs`) |
| System node defs | `packages/nodes/src/system/{subflow,subflow-input,subflow-output}.ts` |
| Boundary schema nodes | `packages/nodes/src/schema/{subflow-input,subflow-passthrough}.schema.ts`, registered in `schema/index.ts` |
| Grouping + save + re-expand | `apps/editor/src/store/workflow-store.ts` |
| Editor-side expansion | `apps/editor/src/lib/schema-store.ts` (`expandNodesAndEdgesForSchema`) |
| Proxy handle rendering | `apps/editor/src/components/nodes/CustomNodes.tsx` |
| Palette filter (hide boundary nodes) | `apps/editor/src/components/NodePalette.tsx` |
| Subflow picker (searchable library) | `apps/editor/src/components/PropertyPanel.tsx` (`SubflowPicker`) |
| Subflow Library modal (browse/open/delete) + delete guard + project-delete copy | `apps/editor/src/components/Toolbar.tsx` (`SubflowLibraryModal`) |
| API client | `apps/editor/src/api/client.ts` (`listSubflows`, `getReferences`) |
| Server expansion + CRUD + preview + references + subflowsOnly | `apps/server/src/routes/pipelines.ts` |
| Global list + reference count | `apps/server/src/db/repositories/workflows.repo.ts` (`listSubflows`, `countReferences`) |
| Project-delete sparing subflows | `apps/server/src/db/repositories/projects.repo.ts` |
| Metadata types | `packages/shared/src/types.ts` (`ISubflowParameter`, `IWorkflowMetadata`) |
| Preview pipeline | `packages/execution/src/preview/generator.ts` (`generatePreviewPipeline`) |
