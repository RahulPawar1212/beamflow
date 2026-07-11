# Projects — grouping workflows

A **project** is an **org-owned** container for a set of workflows (and subflows). Every
member of the organization sees and works in the same projects (see
[db-auth-architecture.md](db-auth-architecture.md) for the org model). Users switch
between projects and see the (regular) workflows belonging to the active project. Every
regular workflow belongs to exactly one project.

**Subflows ARE project-scoped** (this changed with the org model — they used to be a
user-global library). A subflow belongs to a project like any workflow, its library
listing is per-project, and it is deleted with its project. See
[subflows.md §9](subflows.md#9-project-scoped-library-picker-references). Where this
document says "workflow" below, it means a regular (non-subflow) workflow unless noted.

This complements [architecture.md](architecture.md), [subflows.md](subflows.md), and
[db-auth-architecture.md](db-auth-architecture.md).

---

## 1. Data model

A `projects` table owns workflows via a nullable `project_id` FK on `workflows`
(`apps/server/src/db/schema.ts`, both SQLite and Postgres dialects):

```
organizations ──1:N──▶ projects ──1:N──▶ workflows ──1:N──▶ workflow_versions
                                                   └──1:N──▶ variables
```

- `projects`: `id` (PK), `org_id` (FK → organizations, access scope), `owner_id`
  (FK → users, creator/provenance), `name`, `description`, `created_at`, `updated_at`.
- `workflows.project_id`: **nullable** FK → projects. Nullable so the migration can add
  the column to existing rows and so the startup backfill can fill it.
- **Subflows (`is_subflow = 1`) are project-scoped too** — they carry a real `project_id`
  like any workflow. `workflowsRepo.listSubflows(orgId, projectId?)` filters by project,
  `POST /api/pipelines` assigns subflows a project, the startup backfill fills them, and
  project deletion removes them
  (see [subflows.md §9](subflows.md#9-project-scoped-library-picker-references)).
- Shared type: `IProject` (has `orgId` + `ownerId`) and `IWorkflowMetadata.projectId`/
  `orgId`/`version` in `packages/shared/src/types.ts`. `projectId` also rides inside the
  workflow's `settings_json`, but the dedicated indexed column is what queries filter on.

Migrations: `apps/server/drizzle/{sqlite,postgres}/0003_*` (projects) and `0004_*` (org
scoping + `version`), generated with `drizzle-kit generate`, applied automatically on
startup by `runMigrations()`.

---

## 2. Server

- **`projects.repo.ts`** — `list / get / create / update / delete` scoped by `orgId`
  (same org-guard pattern as the other repos), plus `ensureDefaultProject(orgId, ownerId)`.
- **`routes/projects.ts`** — `GET/POST/PUT/DELETE /api/projects`, auth-guarded, scoped via
  `getOrgId(req)`, wired in `app.ts` next to the other route groups.
- **`routes/pipelines.ts`** —
  - `GET /api/pipelines?projectId=<id>` filters to a project (and still honors
    `includeSubflows`); the summary now includes `projectId`.
  - `POST /api/pipelines` accepts `projectId`; when omitted it falls back to the org's
    default project (`ensureDefaultProject`) — for subflows too.
- **`workflows.repo.ts`** — `list`'s `projectId` filter scopes regular workflows;
  `listSubflows(orgId, projectId?)` scopes the subflow library; `create` writes
  `project_id`; `update` only touches `project_id` when the caller supplies one.

### Cascade delete — done in the app, not the DB
Deleting a project deletes **all** its workflows — regular AND subflows — plus each one's
versions and variables. (Subflows used to be spared; now that they're project-scoped they
go with the project. The `getReferences` warn-but-allow guard and the same-project picker
keep cross-project references from arising.) Implemented **explicitly** (leaf rows →
workflows → project), **not** via SQLite `ON DELETE CASCADE`.

> **Why:** libSQL opens a fresh connection per statement for local files, so a one-off
> `PRAGMA foreign_keys = ON` does not reliably apply to every query — the DB-level cascade
> silently fails with `SQLITE_CONSTRAINT_FOREIGNKEY`. Explicit deletes are portable across
> SQLite and Postgres. (The pragma is still set in `db/client.ts` as defense-in-depth.)

---

## 3. Editor

- **Store** (`store/workflow-store.ts`): `currentProjectId` / `currentProjectName` +
  `setCurrentProject`. Threaded into every `createPipeline` call — `saveWorkflow`,
  `duplicateWorkflow`, and `createSubflowFromSelection` — so new work lands in the active
  project.
- **API client** (`api/client.ts`): `listProjects / createProject / updateProject /
  deleteProject`, a `ProjectDTO`, and `listPipelines(projectId?)`.
- **UI** (`components/Toolbar.tsx`): a project chip in the toolbar opens the
  **ProjectSwitcherModal** (create / rename / typed-confirm delete), modeled on the
  existing `WorkflowSwitcherModal`. The Workflows modal fetches
  `listPipelines(currentProjectId)`, so it only lists the active project's workflows.
  Switching project clears the canvas (the open pipeline belongs to the old project).
- **Startup** (`App.tsx`): after auth, fetch projects and select the first (Default) as
  active. No routing — this stays a single-view SPA (navigation via modals + store state,
  same as subflows).

---

## 4. Existing data — startup backfill

`ensureDefaultProjects()` (`projects.repo.ts`), run after migrations **and after
`ensureDefaultOrg()`** in `app.ts`, is idempotent:

1. Find **all** workflows with `project_id IS NULL` (regular AND subflows — subflows are
   project-scoped now and get backfilled too).
2. Group by `org_id`; for each org, ensure a **"Default Project"** exists.
3. Set those workflows' `project_id` to that project.

Once every workflow has a project it is a no-op. This is why the FK is nullable and the
per-org default is created in application code rather than in raw migration SQL.

---

## 5. Verification (what was exercised end-to-end)

Driven against the running server on a fresh SQLite DB:

1. `0003` migration applies on boot; backfill creates a Default project.
2. Creating a pipeline with no `projectId` auto-creates/assigns the Default project.
3. Project CRUD via `/api/projects`.
4. `GET /api/pipelines?projectId=A` returns only A's pipelines; B's are excluded.
5. A subflow created in project B carries B's `projectId`.
6. `DELETE /api/projects/B` removes B and its workflows/subflows; project A is untouched.

---

## 6. File map

| Concern | File |
|---|---|
| Schema (projects table + project_id) | `apps/server/src/db/schema.ts` |
| Migrations | `apps/server/drizzle/{sqlite,postgres}/0003_*` |
| Project repo + backfill | `apps/server/src/db/repositories/projects.repo.ts` |
| Workflow repo scoping | `apps/server/src/db/repositories/workflows.repo.ts` |
| Storage options bag | `apps/server/src/storage.ts` |
| Project routes | `apps/server/src/routes/projects.ts` |
| Pipeline route scoping + wiring | `apps/server/src/routes/pipelines.ts`, `apps/server/src/app.ts` |
| FK pragma | `apps/server/src/db/client.ts` |
| Shared types | `packages/shared/src/types.ts` (`IProject`, `IWorkflowMetadata.projectId`) |
| Editor client | `apps/editor/src/api/client.ts` |
| Editor store | `apps/editor/src/store/workflow-store.ts` |
| Project switcher UI + chip | `apps/editor/src/components/Toolbar.tsx` |
| Startup project select | `apps/editor/src/App.tsx` |
