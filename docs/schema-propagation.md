# Schema Propagation Engine

## The Core Idea

BeamFlow separates execution runtime from visual design-time validation. The schema propagation engine lives entirely in the design-time world. It answers the question *"what columns does this node output?"* — without reading any actual data or executing Apache Beam.

```
┌──────────────┐      PipelineSchema       ┌──────────┐      PipelineSchema       ┌─────────────┐
│  CSV Source  ├──────────────────────────►│  Filter  ├──────────────────────────►│   Formula   │
│ (Defines input)                          │(Passthrough)                         │(Appends new)│
└──────────────┘                           └──────────┘                           └─────────────┘
```

---

## 1. Implementation Code Structure

The schema propagation logic is implemented across three key folders:

### A. The Core Engine (`packages/schema/src/`)
- [types.ts](file:///c:/Users/rahul.pawar/source/repos/beamflow/packages/schema/src/types.ts) — Holds datatype enums (`ColumnDataType` like STRING, DOUBLE) and structures (`ColumnSchema`, `PipelineSchema`).
- [propagation-engine.ts](file:///c:/Users/rahul.pawar/source/repos/beamflow/packages/schema/src/propagation-engine.ts) — The core dependency graph driver. It traverses the DAG in topological order using Kahn's algorithm and recomputes descendants selectively.
- [formula-parser.ts](file:///c:/Users/rahul.pawar/source/repos/beamflow/packages/schema/src/formula-parser.ts) — Type-checks node formulas at design-time (e.g. `Price * Quantity` resolves to `DOUBLE`).
- [validation.ts](file:///c:/Users/rahul.pawar/source/repos/beamflow/packages/schema/src/validation.ts) — Validation rules for Joins, Unions, and Column mappings.
- [lineage.ts](file:///c:/Users/rahul.pawar/source/repos/beamflow/packages/schema/src/lineage.ts) — Tracks stable column IDs across renames to resolve column lineage.

### B. Schema Node Definitions (`packages/nodes/src/schema/`)
Each canvas node implements the `ISchemaNode` interface to calculate its own column transformation output:
- [csv-source.schema.ts](file:///c:/Users/rahul.pawar/source/repos/beamflow/packages/nodes/src/schema/csv-source.schema.ts) — **The origin node.** Reads the user-defined `schemaColumns` list and emits the primary starting schema.
- [filter.schema.ts](file:///c:/Users/rahul.pawar/source/repos/beamflow/packages/nodes/src/schema/filter.schema.ts) — Passthrough helper.
- [formula.schema.ts](file:///c:/Users/rahul.pawar/source/repos/beamflow/packages/nodes/src/schema/formula.schema.ts) — Evaluates formulas and appends new columns.
- [rename.schema.ts](file:///c:/Users/rahul.pawar/source/repos/beamflow/packages/nodes/src/schema/rename.schema.ts) — Alters column name keys while retaining stable lineage IDs.
- [aggregate.schema.ts](file:///c:/Users/rahul.pawar/source/repos/beamflow/packages/nodes/src/schema/aggregate.schema.ts) — Groups columns and drops un-aggregated columns.
- [join.schema.ts](file:///c:/Users/rahul.pawar/source/repos/beamflow/packages/nodes/src/schema/join.schema.ts) — Combines schemas from left and right incoming branches.

### C. UI Zustand Hook Store (`apps/editor/src/lib/`)
- [schema-store.ts](file:///c:/Users/rahul.pawar/source/repos/beamflow/apps/editor/src/lib/schema-store.ts) — Zustand store wrapping the engine. Its `syncFromWorkflow(nodes, edges)` does a full rebuild (reads `subflowCache`, inlines subflows, `engine.recomputeAll()`).
- [schema-sync.ts](file:///c:/Users/rahul.pawar/source/repos/beamflow/apps/editor/src/lib/schema-sync.ts) — **the single trigger.** Rather than each store action calling `syncFromWorkflow`, one subscriber watches the workflow store and re-syncs whenever a *schema-relevant* fingerprint changes (node id/type/settings, edge endpoints/handles, `subflowCacheVersion`). Cosmetic churn (drag/selection) is ignored. This makes schema a pure function of `{nodes, edges, subflowCache}` and is why "empty dropdown" bugs from a forgotten trigger can't recur. See [debugging.md](debugging.md).

---

## 2. Step-by-Step Propagation Flow

When the visual editor loads or changes:

1. **Trigger:** a store action mutates `nodes`/`edges`/`subflowCache`. The central subscriber in `schema-sync.ts` detects the schema-relevant change and calls `syncFromWorkflow` (microtask-debounced).
2. **Topological Order:** The engine sorts the graph using **Kahn's Topological Sort** starting from the source nodes.
3. **Invalidation:** Descendants of the modified node are marked stale in the cache.
4. **Calculations:** The engine traverses downstream nodes. For each node, it takes the output schemas of upstream dependencies, feeds them as input, and calls:
   ```typescript
   const outputSchema = schemaNode.getOutputSchema(upstreamSchemas);
   ```
5. **State Sync:** Computed schemas are updated in the React Zustand store, updating downstream nodes instantly.

---

## 3. Schema Ingestion & Auto-Detection

To bridge the gap between design-time settings and actual local/remote datasets:

### A. Local CSV Preview Endpoint
The REST server registers an authenticated preview route in `apps/server/src/routes/pipelines.ts` which uses Node streams to read the first **64KB** of the file to extract preview lines without loading huge files into memory:
* Route: `POST /api/pipelines/preview-csv`
* Body: `{ filePath: string, delimiter: string }`
* Response: `{ headers: string[], sampleRows: string[][] }`

### B. Database Query Preview Endpoint (SQL Source)
The REST server exposes a SQL design-time metadata analysis endpoint in `apps/server/src/routes/pipelines.ts` that dynamically queries database column definitions:
* Route: `POST /api/pipelines/preview-sql`
* Body: `{ connectionString: string, sqlQuery: string }`
* Flow:
  - **PostgreSQL:** Connects using the `postgres` package, executes a dry-run wrapped in `SELECT * FROM (${sqlQuery}) AS t LIMIT 0`, and maps PG OID types (such as `20`, `23`, `701`, etc.) to standard column types (`integer`, `double`, `boolean`, `date`, `datetime`, `time`, or `string`).
  - **SQLite/LibSQL:** Connects using `@libsql/client`, queries the query using `LIMIT 1`, and dynamically infers runtime column types based on Javascript runtime objects (`number` -> `integer` or `double`, `boolean`, `Date` instance, etc.).
* Response: `{ columns: Array<{ name: string, type: string }> }`

### C. Client Type Inference Engine
When the user clicks **`Detect Schema`** on a Source node (CSV Source or SQL Source) in the editor properties panel:
1. For CSV: The editor fetches the preview rows and executes regex checks (e.g. integer: `/^-?\d+$/`, double: `/^-?\d+\.\d+$/`, date: `/^\d{4}-\d{2}-\d{2}$/`) on column values.
2. For SQL: The editor requests `/api/pipelines/preview-sql` which executes database column and metadata analysis and returns type maps.
3. Instantly registers these columns under the `schemaColumns` node setting, which triggers a downstream graph recomputation.

---

## 4. Dynamic Downstream Input Fields

Downstream nodes (like **Filter** or **Group By**) require field name references to function. To eliminate manual typings:
- The property panel `PropertyPanel.tsx` fetches the parent nodes' computed schemas via `useSchemaStore`.
- If the node has incoming connections carrying columns, text settings (like `field` or `aggregateField`) automatically transition into a **Select Dropdown** list.
- Selecting a field immediately populates the node setting and triggers validation checks (like verifying compatibility and alerting on type mismatches) at design-time.
