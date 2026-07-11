# Database & User Auth Architecture

This document describes the design-time data persistence, authentication structure, and security isolation layers implemented in BeamFlow.

---

## 1. High-Level Architectural View

BeamFlow has a decoupled architecture where the visual designer persists metadata (diagram structures, user variables, and version control) to a SQL database, while the runtime execution engine runs on independent workers (Apache Beam).

```
 ┌─────────────────────────────────────────────────────────┐
 │                      VISUAL EDITOR                      │
 │                  (React + Zustand UI)                   │
 └────────────────────────────┬────────────────────────────┘
                              │
                              │ HTTP + JWT (Bearer)
                              ▼
 ┌─────────────────────────────────────────────────────────┐
 │                   FASTIFY REST SERVER                   │
 │                                                         │
 │  ┌────────────────┐ ┌────────────────┐ ┌─────────────┐  │
 │  │  Public Routes │ │  Auth Routes   │ │ Auth Hook   │  │
 │  │  (/nodes)      │ │  (/auth/*)     │ │ (Verify)    │  │
 │  └────────────────┘ └────────────────┘ └──────┬──────┘  │
 │                                               │         │
 │  ┌────────────────────────────────────────────▼──────┐  │
 │  │            Protected Routes Namespace             │  │
 │  │      (/pipelines/*, /variables/*, /versions/*)    │  │
 │  └────────────────────────────────────┬──────────────┘  │
 └───────────────────────────────────────┼─────────────────┘
                                         │
                                         ▼
 ┌─────────────────────────────────────────────────────────┐
 │                    REPOSITORIES LAYER                   │
 │       (Users, Workflows, Variables, Versions Repos)     │
 └───────────────────────────────┬─────────────────────────┘
                                 │
                                 ▼
 ┌─────────────────────────────────────────────────────────┐
 │                       DRIZZLE ORM                       │
 └───────────────────────────────┬─────────────────────────┘
                                 │
                 ┌───────────────┴───────────────┐
                 │ (Development)                 │ (Production)
                 ▼                               ▼
      ┌─────────────────────┐         ┌─────────────────────┐
      │    LibSQL/SQLite    │         │     PostgreSQL      │
      │   (Local DB File)   │         │ (DATABASE_URL Cloud)│
      └─────────────────────┘         └─────────────────────┘
```

---

## 2. Technical Stack

- **ORM:** [Drizzle ORM](https://orm.drizzle.team/) (dialect-agnostic schemas, lightweight runtime, fully type-safe SQL query generation).
- **SQLite Engine:** `@libsql/client` (native LibSQL client wrapper. It provides robust precompiled binaries for Windows/PowerShell environments, avoiding native compilation failures with standard `node-gyp`).
- **PostgreSQL Engine:** `postgres` (highly optimized PostgreSQL client for production connections).
- **Auth Tokens:** `@fastify/jwt` (HMAC SHA-256 signed JSON Web Tokens).
- **Encryption:** `bcryptjs` (password hashing with 10 salt rounds).

---

## 3. Database Schema Design

The tables are configured in `apps/server/src/db/schema.ts`. The schema uses structure-equivalent definitions for SQLite and PostgreSQL:

```mermaid
erDiagram
    users {
        text id PK
        text email UK
        text password_hash
        text name
        text gemini_api_key
        text created_at
    }
    organizations {
        text id PK
        text name
        text created_at
        text updated_at
    }
    memberships {
        text id PK
        text org_id FK
        text user_id FK
        text role
        text created_at
    }
    projects {
        text id PK
        text org_id FK
        text owner_id FK
        text name
        text description
        text created_at
        text updated_at
    }
    workflows {
        text id PK
        text org_id FK
        text owner_id FK
        text project_id FK
        text name
        text description
        text settings_json
        integer is_subflow
        integer version
        text created_at
        text updated_at
    }
    workflow_versions {
        text id PK
        text workflow_id FK
        text version
        text snapshot_json
        text created_at
        text label
    }
    variables {
        text id PK
        text workflow_id FK
        text environment
        text name
        text value
        integer is_secret
    }

    organizations ||--o{ memberships : has
    users ||--o{ memberships : joins
    organizations ||--o{ projects : scopes
    organizations ||--o{ workflows : scopes
    users ||--o{ projects : created
    users ||--o{ workflows : created
    projects ||--o{ workflows : groups
    workflows ||--o{ workflow_versions : snapshotted_in
    workflows ||--o{ variables : configures
```

**Notes on recent columns/tables:**
- **Organizations are the access scope.** `organizations` + `memberships` (user↔org,
  with `role`) were added so members of an org share its projects/workflows/subflows.
  `projects.org_id` and `workflows.org_id` carry the scope; `owner_id` is retained as
  **creator/provenance only**, no longer the access gate. A single "Default Organization"
  is backfilled on startup (`ensureDefaultOrg`), every user auto-joins it (earliest =
  `owner`), and registration mints a JWT carrying `orgId`. The schema models multiple
  orgs even though one is used today — multi-tenant is data, not a migration.
- `projects` groups an **org's** workflows and subflows; see [projects.md](projects.md).
- `workflows.project_id` is a **nullable** FK, backfilled to the org's "Default Project"
  on startup. **Subflows are now project-scoped too** (they used to be a global library);
  see [subflows.md §9](subflows.md#9-project-scoped-library-picker-references).
- `workflows.version` is a monotonic integer used as the optimistic-concurrency token:
  a save carries the version it was based on, the server 409s if the stored version moved
  on, and bumps it on a clean write (see §4.D).
- `workflows.is_subflow` marks reusable nested pipelines; see [subflows.md](subflows.md).
- `users.gemini_api_key` stores the user's own Gemini key for the AI Flow Maker.

**Cascade caveat:** although FKs declare `ON DELETE CASCADE`, libSQL does not reliably
honor `PRAGMA foreign_keys` across its per-statement local-file connections, so
project→workflow deletion is performed **explicitly in `projects.repo.ts`** rather than
relying on the DB cascade. That explicit delete also **spares subflows** (`is_subflow=0`
only) and null-outs any subflow's `projectId`, so a project delete never removes a shared
subflow. The pragma is still enabled in `db/client.ts` as a backstop.

---

## 4. Key Security & Implementation Patterns

### A. Encapsulated Authentication Scopes
Fastify handles plugins by creating scoped contexts. In `app.ts`, the authentication hook is registered using:
```typescript
app.decorate('authenticate', async (request, reply) => { ... });
```
Inside the routes, protected endpoints are nested inside an `app.register(...)` block, applying the `preHandler` hook *locally*:
```typescript
app.register(async (appWithAuth) => {
  appWithAuth.addHook('preHandler', app.authenticate);
  appWithAuth.get('/api/pipelines', ...); // Secured
});
```
This isolates the auth guard, keeping metadata routes (`/api/nodes`) and health checks public.

### B. Org-Scoped Data Fetching (Row-Level Security)
Every repository operation takes the caller's **organization id** as a mandatory
parameter, and every query `AND`s `eq(table.orgId, orgId)` into its `WHERE`:
```typescript
// workflows.repo.ts
async get(id: string, orgId: string): Promise<SerializedWorkflow | null> {
  const results = await db
    .select()
    .from(workflowsTable)
    .where(and(eq(workflowsTable.id, id), eq(workflowsTable.orgId, orgId)));
  ...
}
```
Routes resolve the scope via `getOrgId(req)` (`auth-context.ts`), which reads `orgId`
from the JWT — the single place the token shape is read, so org-switching / per-project
access later touches only that helper. A request for a pipeline in another org returns no
rows → `404`. Members of the **same** org share full read/write/delete access to its data
(that is the point). `owner_id` still travels on each row but only records who created it;
`getUserId(req)` supplies it where provenance is written (create). Leaf tables
(`workflow_versions`, `variables`) have no org column — they authorize transitively by
looking up the parent workflow scoped by `orgId`.

### D. Optimistic-Concurrency Saves (no lost updates)
Because org members can edit the same pipeline, `PUT /api/pipelines/:id` is
version-guarded. The client sends the `version` it loaded; `workflowsRepo.update` writes
only if the stored `version` still matches (a conditional `UPDATE … WHERE version=?`,
atomic against a concurrent writer), returning `{ ok:false, currentVersion }` otherwise.
The route then responds **409** with the authoritative current state — nothing is
clobbered — and the editor shows a reload/keep banner (`ConflictError` in `api/client.ts`).
Every successful save bumps the version and writes a `workflow_versions` snapshot, so the
version-history feature (previously dormant) is now populated and browsable/restorable in
the editor's History panel. The editor also auto-saves (debounced ~2s, flush on tab close).

### C. Dynamic Database Routing
The connection manager `src/db/client.ts` detects the driver format on initialization:

```typescript
const dbUrl = process.env.DATABASE_URL;
const isPg = !!(dbUrl?.startsWith('postgresql://') || dbUrl?.startsWith('postgres://'));

if (isPg) {
  // postgres-js client for PostgreSQL
} else if (process.env.NODE_ENV === 'test') {
  // SQLite in-memory client for Vitest isolation
} else {
  // LibSQL client for local file 'beamflow.db'
}
```

### E. Client-Side JWT Lifecycle
1. **Attachment:** The API client interceptor in `api/client.ts` automatically extracts `bf_token` from `localStorage` and appends it to request headers:
   ```typescript
   headers['Authorization'] = `Bearer ${token}`;
   ```
2. **Rejection Hook:** If the API returns `401 Unauthorized` (expired or invalid token), the interceptor clears local cache and dispatches a global event:
   ```typescript
   window.dispatchEvent(new Event('bf-unauthorized'));
   ```
3. **Reactive Re-route:** The Zustand `auth-store.ts` listens to the event, transitions state to unauthenticated, and mounts the login form immediately.
