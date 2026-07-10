# Continuous Integration (CI)

How BeamFlow's CI works, why each step exists, and how to work with it. The
workflow lives at [`.github/workflows/ci.yml`](../.github/workflows/ci.yml).

CI is the machine that answers "does a fresh checkout of this code actually build
and pass its tests?" — a question local runs can't answer reliably, because your
machine has stale build outputs, cached dependencies, and leftover state. It's the
safety net for an AI-grown codebase: it catches the *plausible-but-wrong* change
that looks fine locally. (See [maintaining-and-growing-beamflow.md](maintaining-and-growing-beamflow.md).)

---

## 1. When it runs

```yaml
on:
  push:
    branches: ['**']
  pull_request:
```
- **Every push to any branch** — so you get a red/green signal on feature branches
  before you ever open a PR.
- **Every pull request** — the check that gates merging (once branch protection is
  enabled; see §7).

There is one job, `build-and-test`, on `ubuntu-latest` (Linux — the cheapest/
fastest GitHub runner; see §6 on cost).

---

## 2. The steps, in order, and why each exists

```yaml
- uses: actions/checkout@v4          # 1. get the code
- uses: pnpm/action-setup@v4         # 2. install pnpm (version from packageManager)
- uses: actions/setup-node@v4        # 3. Node 20 + pnpm dependency cache
  with: { node-version: 20, cache: pnpm }
- run: pnpm install --frozen-lockfile  # 4. exact, reproducible deps
- run: pnpm build                    # 5. build = full TypeScript typecheck + bundle
- run: pnpm test                     # 6. all test suites incl. the mount smoke test
```

### 1. `checkout` — a *clean* tree, every time
CI starts from a bare clone: **no `dist/`, no `.tsbuildinfo`, no `.turbo` cache, no
`node_modules`.** This is the whole point — it reproduces what a new teammate (or a
production build) sees, not what your incrementally-built machine sees. This clean
slate is exactly what caught a real build-ordering bug local runs had masked (§8).

### 2. `pnpm/action-setup@v4` — pnpm at the pinned version
Installs pnpm. The version comes from the root `package.json`
`"packageManager": "pnpm@9.15.4"` — no version is hardcoded in the workflow, so
bumping pnpm is a one-line change in `package.json` that CI automatically follows.

### 3. `setup-node@v4` — Node 20 + dependency cache
Installs Node 20 (the repo's supported version). `cache: pnpm` caches the pnpm
store keyed on `pnpm-lock.yaml`, so unchanged dependencies don't re-download on
every run — this is the main thing that keeps CI fast. The cache is an
*optimization only*; it never changes correctness (a cache miss just installs
fresh).

### 4. `pnpm install --frozen-lockfile` — reproducible installs
Installs the **exact** dependency tree recorded in `pnpm-lock.yaml`. `--frozen-lockfile`
means: do not update anything, and **fail if `package.json` and `pnpm-lock.yaml`
disagree.** This guarantees CI tests the same dependency versions you committed, and
it catches the mistake of changing a dependency in `package.json` without committing
the regenerated lockfile. (This is why the lockfile is committed — see the
`pnpm-lock.yaml` discussion in the project history.)

### 5. `pnpm build` — this *is* the typecheck
There is no separate `typecheck` step, on purpose. Every package/app builds with
`tsc` (the editor with `tsc -b && vite build`), and `tsc` fails on any type error.
So a green `pnpm build` means **the whole monorepo type-checks and bundles**. A bad
AI edit that breaks a type surfaces here. See §3 for how the monorepo builds in the
right order.

### 6. `pnpm test` — every suite, including the smoke test
Runs all package/app test suites (see §4). Includes the **App mount smoke test**,
which is the guard against "green tests, blank page" (§5).

### Not present: a lint step
`turbo run lint` is currently a **no-op** — there is no ESLint config and no package
has a real `lint` script. Adding a lint step now would be a misleading green, so the
workflow deliberately omits it, with a `# TODO` noting to add it once ESLint is set
up. That's the documented next follow-up.

---

## 3. How `pnpm build` / `pnpm test` fan out (Turbo)

`pnpm build` → `turbo run build`; `pnpm test` → `turbo run test`. Turbo orchestrates
the monorepo:

- **`build` depends on `^build`** (`turbo.json`): the `^` means *build this package's
  workspace dependencies first*. So `@beamflow/shared` builds before `@beamflow/core`
  builds before `@beamflow/ir`, etc. **Turbo derives this order from each package's
  declared `dependencies` in its `package.json`.** If a package imports another but
  doesn't *declare* it as a dependency, Turbo doesn't know to build it first — which
  is precisely the bug CI caught (§8).
- **`test` depends on `build`**: tests run against built output, so everything is
  compiled first.
- **Caching**: Turbo caches task outputs (`dist/**`) keyed on inputs. In CI the cache
  starts empty each run (fresh checkout), so CI always does a real, from-scratch
  build — no stale-output masking.

This is why local builds can pass while CI fails: locally you have prior `dist/`
folders sitting around, so a missing build-order dependency is invisible. CI's empty
tree exposes it.

---

## 4. What the test suites need (and don't)

Every package with a `test` script runs `vitest run`. Crucially for CI, **no suite
needs Python, a real database, or a network**:

| Suite | Environment | Notes |
|---|---|---|
| `apps/editor` | node + jsdom | `*.test.ts` = node; `*.test.tsx` opt into jsdom via a top-of-file `// @vitest-environment jsdom`. Includes the smoke test. |
| `apps/server` | node + **in-memory SQLite** | `NODE_ENV=test` (vitest default) makes the DB `file::memory:?cache=shared`; migrations run in-process. `@beamflow/execution` (Python/Beam) is mocked. |
| `packages/*` | node | pure logic (shared, core, graph, ir, beam-generator, nodes, schema, execution). `execution` mocks `child_process`, so **no real Python runs**. |

So CI needs only Node + pnpm. No services to stand up, nothing to install beyond npm
deps — which is what keeps the workflow a single, fast Linux job.

---

## 5. The App mount smoke test (the highest-value check)

`apps/editor/src/App.smoke.test.tsx` renders `<App/>` in jsdom and asserts:
1. it **mounts** (React actually renders; root isn't empty), and
2. **zero `console.error`** during mount.

Why it matters: unit tests verify *logic in isolation*, but the app can still fail to
**boot** — an import cycle, a module that throws at load, a broken bundle. Twice in
this project's history a change was green on every unit test yet shipped a **blank
page** (an import-cycle TDZ crash; HMR staleness). This test reproduces that class:
if the module graph is broken, the render throws or logs and the test fails — **in
CI, before merge**. It runs unauthenticated (renders the login page), so it needs no
backend. Its ceiling: jsdom proves *modules load + React mounts*, not pixel layout —
a real-browser Playwright journey is the documented next step.

---

## 6. Cost

- **Public repo (this one): free, unlimited minutes.** No cap.
- Private repos: 2,000 free Linux minutes/month (Free plan), then usage-based —
  but GitHub won't charge without an explicit spending limit > $0; it just stops
  running past the quota.
- We use **Linux** (`ubuntu-latest`) = 1× minute multiplier (macOS = 10×, Windows =
  2×). Our run is ~1–2 minutes. Keep it on Linux.

---

## 7. Working with CI

- **Red on a feature branch is normal and useful** — push freely; CI tells you what a
  clean environment thinks. It does **not** block the push.
- **Blocking bad code from `main`** is done with **branch protection**, not by blocking
  pushes: GitHub repo → Settings → Branches → add a rule for `main` → "Require status
  checks to pass before merging" → select the `build-and-test` check. Then a red PR
  can't merge. *(Not enabled yet — recommended now that CI exists.)*
- **Reproduce a CI failure locally** — the clean-tree build is the key. Local builds
  reuse stale output; to match CI:
  ```bash
  # from repo root — mimic a fresh checkout
  find . -path ./node_modules -prune -o -name "*.tsbuildinfo" -print | xargs rm -f
  find packages apps -maxdepth 2 -name dist -type d -exec rm -rf {} +
  rm -rf .turbo
  pnpm install --frozen-lockfile
  pnpm build && pnpm test
  ```
  If that passes, CI will pass. If it fails, you've reproduced the CI failure.
- **Definition of done** (mirrors CI + what CI can't see): planned & understood →
  `pnpm build` clean → `pnpm test` green → **the real app driven/observed** (CI's smoke
  test covers the mount; a browser check covers layout) → docs updated.

---

## 8. Case study: the bug CI caught on day one

The first CI run **failed at `pnpm build`** while local builds were green. Cause, in
two layers:
1. `@beamflow/execution` **imported** `@beamflow/{graph,ir,core,beam-generator}` but
   only **declared** `@beamflow/shared` in its `package.json`. Turbo orders builds by
   declared dependencies (§3), so on a clean tree those four weren't built before
   `execution` → "Cannot find module". Locally, stale `dist/` folders hid it.
2. The shared tsconfig set `composite`/`incremental`, but no package uses TS project
   references and build scripts run plain `tsc` — that combination intermittently
   skipped emitting `.d.ts` files, so dependents saw "implicitly any / no declaration
   file."

Both were **pre-existing** and invisible to every local build and all green unit
tests. Only a from-scratch environment surfaced them — which is exactly what CI is
for. Fix: declare the missing workspace deps; drop `composite`/`incremental`. CI then
went green.

The lesson this encodes: **"passes locally" is not "builds from clean."** CI is the
thing that enforces the difference.

---

*Related: [maintaining-and-growing-beamflow.md](maintaining-and-growing-beamflow.md) ·
[debugging.md](debugging.md) · [architecture.md](architecture.md)*
