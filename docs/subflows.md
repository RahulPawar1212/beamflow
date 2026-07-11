# Subflows — Reusable Nested Pipelines

A **subflow** is a pipeline that is embedded inside another pipeline as a single
reusable node. The user selects a group of nodes on the canvas, "groups" them into
a subflow, and from then on the parent shows one **proxy node** in place of the group.
The subflow itself is a normal pipeline row in the database (flagged `isSubflow`), so
it can be edited independently and referenced by many parents.

Subflows are a **project-scoped shared library**: each belongs to a project (shared with
every member of the org), is reusable by any workflow in that project, and is attached to
a parent either by "Group as node" or by dragging the **Subflow** node from the palette
and picking an existing one. See
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
`?includeSubflows=true` to include them, or `?subflowsOnly=true` (optionally with
`&projectId=…`) for the project's subflow library (§9). A subflow's `projectId` is set to
its project, like any workflow (§9).

### 3.1 `isSubflow` is locked identity — guarded at every write

`isSubflow` is **explicit identity**: decided once when the pipeline is created, never
derived from the graph, and never changed by an ordinary save. Three incidents of
"my workflow turned into a subflow" (it then vanishes from the Workflows list and shows
up in the Subflow Library) taught us that every write path needs its own guard, because
the flag travels from drifting client state:

- **Update is pinned** (`workflowsRepo.update`, mirrored in `PUT /api/pipelines/:id`):
  the repo re-reads the existing row and keeps its `isSubflow` no matter what the
  request body claims. This is the single choke point for every workflow write, so a
  stale or buggy client can never flip identity on save.
- **Create is structurally validated** (`POST /api/pipelines`): creation is the only
  write where identity is taken from the request — and therefore the only place a bogus
  claim can be minted. Every legitimately created subflow has at least one
  `system:subflow-input`/`system:subflow-output` boundary node (grouping auto-adds one,
  §2). A create claiming `isSubflow: true` over a plain workflow graph is rejected with
  a 400. Note the guard applies **only at creation**: deleting boundary nodes from a
  real subflow later goes through update, which preserves identity (a subflow with no
  explicit output falls back to derived outputs, §5).
- **Duplicate copies identity from the saved record, not from session state**
  (`duplicateWorkflow` in `workflow-store.ts`): the copy is "another one of whatever
  the source pipeline *is*", and the DB is the authority on that. In-memory `isSubflow`
  has drifted before (stale dev bundles, navigation bugs), and Duplicate goes through
  create — the one write the update lock can't pin — so it fetches the source via
  `GET /api/pipelines/:id` and uses *its* flag, re-aligning the session state afterwards.
  The per-row Duplicate in the Workflows modal likewise passes `isSubflow` +
  `parameters` from the fetched record.
- **Identity is visible**: the Toolbar shows a cyan "Subflow" badge next to the pipeline
  name whenever the open pipeline is a subflow, so drift is spotted before a save
  persists it instead of after.

If a record was corrupted before these guards existed, it is identifiable by
`is_subflow = 1` with no boundary nodes in `settings_json`. Repair means flipping the
flag in **both** the `is_subflow` column and the embedded `metadata.isSubflow`, and
assigning a `project_id` — a workflow with a null project is invisible in the
project-scoped Workflows list.

Regression coverage: `apps/server/src/routes/pipelines.test.ts` (create guard, PUT
lock down to the repo) and `apps/editor/src/lib/subflow-flag.test.ts` (identity
preserved across load/serialize/navigation, duplicate-under-drift).

---

## 4. Two paths: flatten for preview/schema, compile to PTransform for code

A subflow is **inlined** (flattened) for design-time schema propagation and preview, but
**compiled to a real, nested `beam.PTransform` subclass** — not inlined — for code
generation and execution. These are deliberately different because they serve different
consumers:

| Path | Function | Purpose | Shape |
|---|---|---|---|
| Editor | `expandNodesAndEdgesForSchema` in `apps/editor/src/lib/schema-store.ts` | Design-time schema propagation. | Flattened. |
| Server (preview) | `flattenSubflowsForPreview` in `apps/server/src/routes/pipelines.ts` | Preview's truncated-DAG target-step resolution. | Flattened. |
| Server (generate/execute) | `resolveSubflowTree` + `buildIR`'s recursive composite-step compilation (`packages/ir/src/builder.ts`) | Code generation & execution. | Nested — each subflow becomes its own `class` with `expand()`. |

**Flattening** (editor schema propagation, server preview) still works exactly as before:
recursively (max depth 10, guarding against cycles), copy the subflow's internal nodes/
edges with an id prefix `sub_<proxyNodeId>_`, substitute `ISubflowParameter` values
directly into internal node settings, rewire the boundary (§5), and keep the proxy as a
passthrough so it remains addressable. This is legitimate here because schema
propagation and truncated preview don't care about the shape of generated Python — only
about "what columns/data flow through."

**Compiling to PTransform** (generate/execute) does NOT flatten:

1. `resolveSubflowTree` (server) recursively pre-fetches every referenced subflow
   document — direct and transitive — into an in-memory `id -> SerializedWorkflow` map,
   performing the same validation as flattening used to (no subflow selected / subflow
   not found / ambiguous or orphaned output boundary), throwing `badRequest` (400) errors
   with node ids exactly as before. No nodes are copied or rewired at this stage.
2. `buildIR` (`packages/ir`) is called on the **un-flattened** DAG with a `resolveSubflow`
   option backed by that map. When it encounters a `system:subflow` node, it recursively
   calls itself on the referenced subflow's own DAG (`buildCompositeStepForSubflowNode`),
   producing a **nested `IRStep`** whose `subPipeline` is the subflow's own `IRPipeline` —
   arbitrary nesting depth falls out of this recursion for free, guarded by the same
   depth-10 cap.
3. `generatePythonBeam` (`packages/beam-generator`) emits one `class <Name>(beam.PTransform)`
   per distinct subflow document (reused across multiple usage sites — one class,
   N instantiations with each site's own parameter values), whose `expand()` recursively
   emits the subflow's own internal steps (each itself a `PTransform` — leaf operations
   like Filter/Map/GroupBy are ALSO one-class-per-operation-type, reused the same way).
   A subflow's exposed `ISubflowParameter`s become real `__init__` constructor
   arguments — nested step params reference `self.<argName>` at runtime, not a
   baked-in literal — so the generated class is a genuinely reusable, parameterizable
   Beam component.

> **Gotcha carried over from flattening:** the output-boundary classifier
> (`resolveSubflowOutputs`, §6) is the single shared source of truth for a subflow's
> output arity in BOTH paths — flattening's proxy rewiring and the PTransform path's
> `expand()` return shape (a single value, or a `dict` keyed by output name for
> multi-output subflows) are both derived from it, so they can never disagree.

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
  named port for **any** resolved subflow definition (falls back to a single generic
  `in`/`out` handle when a boundary has zero named nodes — self-contained subflows, or
  auto-derived outputs with no explicit `system:subflow-output` node).

> **Gotcha: async handle resolution + React Flow's handle-position cache.**
> `subflowCache[subflowId]` loads asynchronously, so a subflow proxy first mounts with
> no resolved definition (generic handles) and only later re-renders with named handles
> once the fetch resolves. React Flow measures each `Handle`'s position once and does
> **not** automatically re-measure just because the node re-rendered with a different
> handle set — an edge referencing a handle id that didn't exist at the last measurement
> silently fails to draw (no console error). Two bugs compounded here previously: (1)
> the named-handle branch only activated with 2+ named ports, so a subflow with exactly
> one named output/input fell through to the generic branch's hardcoded `id="out"`/
> `id="in"`, and (2) even after fixing that, the handle-position cache still needed an
> explicit nudge. Both are fixed: the named-port branch now covers any resolved
> definition, and `BaseNode` calls React Flow's `useUpdateNodeInternals()(id)` in a
> `useEffect` keyed on the resolved port names, so React Flow re-measures whenever the
> handle set actually changes.

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

Preview (`packages/execution/src/preview/`) runs `flattenSubflowsForPreview` on the
server (the flattening path, §4 — unchanged from before the PTransform-compilation
work), then `generatePreviewPipeline` builds a truncated pipeline up to the target node
and appends a `PreviewFeatherSink`. Preview intentionally stays on the flattened path:
its truncated-DAG/target-step resolution assumes a flat id space, and (like schema
propagation) it doesn't care about the shape of generated Python.

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

**Preview** (flattened path, §4/§7) still inlines: the emitted Beam graph is a flat
sequence —

```
step_src                       # CSV Source
step_sub_<sf>_n_filter         # inlined Filter, value substituted with "7"
step_sf                        # proxy passthrough (system:subflow-output)
step_sink                      # CSV Output
```

Previewing the proxy node `sf` against a CSV with an `a=7` row returns exactly that row —
confirming inlining, parameter substitution, named-port wiring, and preview-sink
placement all line up.

**Generate/Execute** (PTransform path, §4) does NOT inline — the subflow compiles to its
own reusable class, instantiated at the proxy's use site with the parent's override:

```python
class FilterTransform(beam.PTransform):
    def __init__(self, field, operator, value):
        ...
    def expand(self, pcoll):
        ...

class My_Subflow(beam.PTransform):
    def __init__(self, param_1='<subflow's own default>'):
        super().__init__()
        self.param_1 = param_1

    def expand(self, pcoll):
        step_filter = pcoll | 'Filter' >> FilterTransform(field='a', operator='==', value=self.param_1)
        return step_filter

def run():
    ...
    with beam.Pipeline(options=pipeline_options) as p:
        step_src = p | 'CSV Source' >> ReadFromCSVTransform(...)
        step_sf = step_src | 'Subflow' >> My_Subflow(param_1='7')
        step_sink = step_sf | 'CSV Output' >> WriteToCSVTransform(...)
```

Running this against a CSV with an `a=7` row produces the same result as the preview
trace — confirming the two paths (flattened preview vs. compiled PTransform) agree on
behavior while differing in code shape. A subflow containing another subflow compiles
the same way recursively: the inner subflow's class is emitted before the outer one,
and the outer's `expand()` instantiates the inner class like any other PTransform.

---

## 9. Project-scoped library (picker, references)

Subflows are a **project-scoped shared library** — define once, reuse in any workflow in
the **same project**, and (because projects are org-scoped) shared with every member of
the org. A subflow belongs to its project the same way a regular workflow does.

> **History:** subflows were originally a *user-global* library (`project_id = null`,
> reusable across every project, spared by project delete). When the app moved to
> org-level projects, subflows became project-scoped like everything else — the change
> below reverses the old global-library rules.

### Scope: subflows belong to a project
- A subflow's `project_id` is set at creation. `POST /api/pipelines` assigns the requested
  project (else the org default) for subflows just like regular workflows
  (`routes/pipelines.ts`); `createSubflowFromSelection` sends the current `projectId`.
- `workflowsRepo.listSubflows(orgId, projectId?)` filters by project; the
  `?subflowsOnly=true&projectId=…` listing returns that project's library.
- Startup backfill (`ensureDefaultProjects`) re-keys **every** project-less workflow,
  subflows included, into its org's default project.

### Finding, attaching & managing subflows
- The **Subflows** toolbar button opens the **Subflow Library** modal
  (`SubflowLibraryModal` in `Toolbar.tsx`): search the **current project's** library,
  **open** a subflow to edit it, or **delete** one (with the used-by guard below).
- The **Subflow** palette node is draggable; the boundary nodes
  (`system:subflow-input` / `-output`) are hidden from the palette (they only exist
  inside a subflow being edited) — filtered by type in `NodePalette.tsx`.
- Selecting a `system:subflow` node shows a **searchable picker** in the Property Panel
  (`SubflowPicker` in `PropertyPanel.tsx`): the current project's library
  (`api.listSubflows(currentProjectId)` → `GET /api/pipelines?subflowsOnly=true&projectId=…`),
  each row showing **name + description + "used by N"**, filterable, excluding the
  currently-open workflow (no self-reference). Picking one sets `subflowId`
  (→ `refreshSubflowCache(true)` → central schema-sync) and relabels the node.

### References & the "used by N" count
- A parent references a subflow via a `system:subflow` node with
  `settings.subflowId = <child id>`, embedded in the parent's `settings_json`.
- `workflowsRepo.countReferences(orgId, subflowId)` scans the **org's** workflows for
  that reference (org-wide, since a reference can live in any of the org's workflows).
  Exposed at `GET /api/pipelines/:id/references` → `{ count, names[] }`, and folded into
  the `subflowsOnly` list as `usedByCount`.

### Deletion semantics
- **Deleting a project deletes its subflows too.** `projectsRepo.delete` removes all of
  the project's workflows including subflows (the old "spare subflows / null-out
  projectId" carve-out is gone). The `getReferences` warn-but-allow guard still protects
  against orphaning a referenced subflow, and the picker only offers same-project
  subflows so cross-project references shouldn't arise in normal use.
- **Deleting a subflow** is done from the Subflow Library modal (`Toolbar.tsx`).
  Referenced subflows warn but are allowed (user's choice): if `usedByCount > 0` the
  delete confirms with "Used by N workflow(s) … delete anyway?". (Warn-but-allow, not
  hard-block.)
- **The output boundary is auto-derived.** A subflow doesn't strictly need an explicit
  `system:subflow-output` node: the shared classifier `resolveSubflowOutputs`
  (`packages/shared/src/subflow-outputs.ts`, used by the server's `flattenSubflowsForPreview`,
  `resolveSubflowTree`/`buildIR`, and the editor's `expandNodesAndEdgesForSchema`) resolves
  the boundary — if there's no output node but exactly one **terminal** (a node with nothing
  after it), that terminal's output is used automatically. Grouping a "tail" selection also
  auto-adds one output up front. Deleting the output node of such a subflow therefore
  doesn't break it — it re-derives. Genuinely ambiguous cases (0 or >1 terminals with no
  output node, or an **orphaned** terminal in a multi-output subflow) raise a **clear,
  node-named error** on generate/run ("add a Subflow Output node…"); design-time schema
  **degrades gracefully** — valid outputs still propagate their columns downstream, and the
  offending node just carries a validation issue (nothing blanks).
- **A workflow referencing a deleted subflow fails gracefully.** `resolveSubflowTree`
  (generate / execute) and `flattenSubflowsForPreview` (preview) each throw a `badRequest`
  (400) with a clear, node-named message — *"Subflow node \"<label>\" (<id>) references a
  subflow that no longer exists. Pick a different subflow or remove the node."* — plus a
  structured `issues` entry (`nodeId`) so the editor can pinpoint the node. It is NOT a bare
  500. Preview records the same message as a `failed` status so the panel shows it.

---

## 10. File map

| Concern | File |
|---|---|
| Output-boundary classifier (auto-derive/ambiguity) | `packages/shared/src/subflow-outputs.ts` (`resolveSubflowOutputs`) |
| System node defs | `packages/nodes/src/system/{subflow,subflow-input,subflow-output}.ts` |
| Boundary schema nodes | `packages/nodes/src/schema/{subflow-input,subflow-passthrough}.schema.ts`, registered in `schema/index.ts` |
| Grouping + save + re-expand | `apps/editor/src/store/workflow-store.ts` |
| Editor-side expansion (flattened, schema propagation only) | `apps/editor/src/lib/schema-store.ts` (`expandNodesAndEdgesForSchema`) |
| Proxy handle rendering | `apps/editor/src/components/nodes/CustomNodes.tsx` |
| Palette filter (hide boundary nodes) | `apps/editor/src/components/NodePalette.tsx` |
| Subflow picker (searchable library) | `apps/editor/src/components/PropertyPanel.tsx` (`SubflowPicker`) |
| Subflow Library modal (browse/open/delete) + delete guard + project-delete copy | `apps/editor/src/components/Toolbar.tsx` (`SubflowLibraryModal`) |
| API client | `apps/editor/src/api/client.ts` (`listSubflows`, `getReferences`) |
| Server-side flattening (preview only) + CRUD + references + subflowsOnly | `apps/server/src/routes/pipelines.ts` (`flattenSubflowsForPreview`) |
| Server-side subflow-document pre-resolution for codegen (no flattening) | `apps/server/src/routes/pipelines.ts` (`resolveSubflowTree`) |
| Recursive composite-step IR compilation (nested `subPipeline`, arbitrary depth) | `packages/ir/src/builder.ts` (`buildIR`'s `system:subflow` branch, `buildCompositeStepForSubflowNode`) |
| Nested IR types (`subPipeline`, `compositeParams`, `compositeOutputs`, `compositeInputNames`) | `packages/ir/src/types.ts` |
| PTransform class emission (leaf operations AND composite/subflow steps, unified) | `packages/beam-generator/src/generator.ts` (`collectClassPlans`, `emitCompositeClass`, `emitStepInstantiation`) |
| Global list + reference count | `apps/server/src/db/repositories/workflows.repo.ts` (`listSubflows`, `countReferences`) |
| Project-delete sparing subflows | `apps/server/src/db/repositories/projects.repo.ts` |
| Metadata types | `packages/shared/src/types.ts` (`ISubflowParameter`, `IWorkflowMetadata`) |
| Preview pipeline (flattened path) | `packages/execution/src/preview/generator.ts` (`generatePreviewPipeline`) |
