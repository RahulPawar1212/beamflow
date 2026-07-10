# Maintaining & Growing BeamFlow — an owner's guide

> For the person who **owns** this codebase but doesn't write most of its code.
> BeamFlow is largely AI-generated. That is fine — the architecture is sound — but
> it changes *what your job is*. Your job is not to out-type the AI. It is to stay
> in control: to understand the shape of the system, to review changes well enough
> that you can't be fooled, and to keep the guardrails (tests, CI, docs) that let
> AI churn the code without rotting it.
>
> This document is: (1) what to learn and why, level by level; (2) how to maintain
> the project short- and long-term; (3) the specific traps this codebase has
> already hit, so you recognize them next time.

---

## 0. The core principle — why "it looks right" is not enough

The failure mode of an AI-grown project is **not** ugly code. It is *plausible code
that is subtly wrong in ways no one with authority over the codebase notices.* During
the work that produced this guide, we hit several bugs that were **green on tests but
broken in the real app**:

- An **import cycle** that crashed the browser with a blank page — *every unit test
  passed*, because Vitest resolves modules differently than the browser.
- **Vite HMR staleness**: a fix was correct in the code but the running browser kept
  an old copy of a Zustand store, so "the fix didn't work" three times in a row.
- A **sticky boolean flag** (`isSubflow`) that drifted out of sync with reality, then
  an over-correction that *derived* it from the graph and broke a different way.
- The **same "empty dropdown" bug reappearing in new places** because schema-sync was
  triggered from ~8 scattered spots instead of one.

None of these were "bad code." They were **design/runtime issues invisible to a quick
read and to green tests.** So the whole point of learning and of your guardrails is:
**be able to catch the wrong-but-plausible.** That is the skill. Everything below
serves it.

**Why you can't just trust the AI (or any single test run):**
- AI optimizes for "produces a plausible diff," not "the running system is correct."
- It cannot see your running browser, your DB state, or last week's decision.
- It will confidently hand you green tests over a broken app (we proved this).
- It has no memory of *why* something is the way it is unless it's written down.
- Therefore: **you** are the continuity and the judgment. Tooling catches what your
  eyes miss; your eyes catch what tooling can't; the AI fills in between.

---

## 1. Code level — what to learn (the specific slice, not "all of React")

You do **not** need to become a React expert. You need enough to **review and verify**.
Target ~20–30 focused hours on this slice; skip the rest and delegate it.

### 1a. TypeScript — your single best defense against AI drift (highest ROI)
A good type error catches a bad AI edit *for free, before it runs*. Learn to **read**
types fluently (writing them is secondary):
- interfaces & types, unions, optional (`?`), `readonly`
- generics at a **reading** level (`Map<string, X>`, `Promise<T>`) — enough to follow, not author
- `strict` mode and why `any` is a red flag (it disables the safety net)
- how a type flows: e.g. this repo's `IWorkflowMetadata` → `SerializedWorkflowDTO`
  → store → component. When you change a shared type, the compiler shows you every
  place that must change. That is your map.
- **Why it matters:** the compiler is a reviewer that never gets tired. Most "the AI
  edited the wrong thing" bugs surface as a type error if types are strict.

### 1b. JavaScript module system & the runtime/bundler model (the scariest bugs live here)
This is where the *invisible* failures hide. Learn:
- **ESM imports and import cycles.** Module A imports B imports A → one of them sees
  the other half-initialized → `Cannot access X before initialization` (TDZ). This is
  exactly the crash we hit. Rule of thumb: **a leaf module wires two modules together;
  the two modules don't import each other.** (We fixed the cycle by moving the wiring
  into `App.tsx`, a leaf.)
- **Why Vitest ≠ the browser.** The test runner and the browser's native ESM loader
  resolve/evaluate modules differently. *Tests passing does not prove the browser
  loads.* This is why a **headless mount check** (§5) is non-negotiable.
- What a **bundle** is (Vite/Rollup), `import.meta.env`, dev vs prod builds.
- **Why it matters:** these bugs produce a blank page or a crash with green tests. If
  you understand module evaluation order, you can spot the setup that causes them.

### 1c. Zustand + React hooks — this app's actual logic model
Most of BeamFlow's *logic* is in Zustand stores, not in fancy components. Learn:
- A Zustand store is a **module-level singleton**; components subscribe with selectors
  (`useWorkflowStore(s => s.nodes)`). State lives outside React.
- **Why HMR leaves it stale:** editing the store file doesn't always reset the live
  singleton in the browser → you see old behavior. Fix: full restart + hard refresh
  (see `docs/debugging.md`). Recognizing this saves hours.
- React `useEffect`: *when* it runs, dependency arrays, cleanup. Enough to review an
  effect and spot a missing dep or an infinite loop.
- Reading a component + hooks well enough to review a diff. **Not** enough to hand-roll
  complex UI — let the AI do that.
- **Why it matters:** the store (`apps/editor/src/store/workflow-store.ts`) is the heart.
  If you understand actions → state → subscribers, you understand the app.

### 1d. What you can safely NOT learn (delegate to AI)
- Deep React internals, advanced hooks/patterns, Suspense, concurrent rendering.
- CSS / Tailwind depth, animations, layout math (the toolbar-overlap class of work).
- The Python/Apache Beam generation internals — unless you're changing *how code is
  generated*. Treat `packages/beam-generator` and `packages/execution` as black boxes
  guarded by their IR contract and tests.

### The review skill (the real deliverable of §1)
Given an AI's diff, can you answer:
- Does it mutate **shared state** in a surprising place?
- Will this `useEffect` loop, or miss a dependency?
- Does this new import create a **cycle**?
- Is there a **type escape** (`any`, `as any`) hiding a mismatch?
- Does derived state (schema, `isSubflow`) get computed in **one** place or scattered?
If you can read a diff and ask these, you're in control regardless of who typed it.

---

## 2. Architecture level — the shape you must protect

You own the architecture; the AI owns the implementation *within* it. Never let AI make
a **structural** decision (like "are subflows project-scoped or global?") without you
understanding and choosing it. The plan → approve → implement loop we used exists for
exactly this.

### The load-bearing decisions (know these cold)
- **The IR is the decoupling seam.** `Graph → IR → Generator → Execution`. The editor
  never talks to the code generator directly. This is why alternate generators are
  possible and why the editor can change without touching codegen. **Protect this
  boundary** — if an AI change makes the editor reach into the generator, reject it.
- **Everything is a plugin.** Node types register through `@beamflow/core`; built-ins in
  `packages/nodes` use the same path as external plugins. Don't let node types get
  hardcoded into the editor.
- **One source of truth for derived state.** Schema/columns are a *pure function of
  {nodes, edges, subflowCache}*, recomputed from **one** subscriber
  (`apps/editor/src/lib/schema-sync.ts`). This was the fix for the recurring
  empty-dropdown bug. **The smell to watch:** the same class of bug reappearing in new
  places → it means logic is scattered and should be centralized. That recognition is
  worth more than any framework fact.
- **Identity vs. derived.** `isSubflow` is *explicit identity set at creation*, not
  derived from the current graph (we tried derived — it broke when a node was deleted).
  Know the difference: some facts are decided once and preserved; some are computed live.
- **Shared pure logic goes in `packages/shared`.** e.g. `resolveSubflowOutputs` is one
  classifier used by both the server and the editor, so runtime and design-time can't
  diverge. Duplicated logic across server/editor is a bug waiting to happen.

### The seams to keep clean (if these stay typed + tested, AI can churn the rest safely)
- the IR contract (`packages/ir`, `packages/shared` types)
- the schema engine (`packages/schema`) and its single trigger (`schema-sync.ts`)
- the store's action surface (`workflow-store.ts`)
- the storage interface (`apps/server/src/storage.ts`) — swappable backend

### Architecture red flags in an AI diff
- editor importing from the generator/execution packages directly
- a new hardcoded node type in the editor instead of a plugin
- derived state computed in a new ad-hoc place (should route through the one owner)
- server and editor each growing their *own* copy of the same rule
- a store↔store import cycle (see §1b)

---

## 3. Maintenance level — keeping entropy out (short & long term)

### Short term (do these in the next couple of weeks)
1. **Stand up CI** (GitHub Actions) that runs on every push: `pnpm build`, `pnpm lint`,
   `pnpm test`, `tsc`. This alone catches broken builds and type regressions before they
   reach you. (There is **no CI today** — this is the biggest single gap.)
2. **Add a headless mount smoke test to CI** (§5). Two bugs this session were invisible
   to unit tests and only a mount check catches them.
3. **Fix the known-broken tests.** The server suite has ~4 stale failures (node-count
   assertions, and `MemoryStorage` vs the DB-backed repos). **Broken tests train you to
   ignore red** — which is exactly how a real failure slips by. Green must mean green.
4. **Keep the docs + memory discipline.** `docs/` (architecture, subflows, projects,
   schema-propagation, debugging) and the assistant's memory are your control surface:
   they're how the *next* session doesn't re-break what this one fixed. This is not
   overhead — it is the mechanism.

### Long term (staying in a good state as it grows)
1. **You approve structure; AI implements.** Use the loop: *plan → you approve →
   implement → verify in the real app → test → document.* This loop is why the project
   is still healthy despite being AI-grown. Do not drop it under time pressure — that's
   precisely when regressions get in.
2. **Every feature ships with a test that would fail if it regressed.** A feature without
   that isn't done. This is your regression contract; it's what lets change N+1 not
   silently break change N.
3. **Review the diff, don't rewrite it.** Grow the §1 review skill. Your leverage is
   judgment per line read, not lines typed.
4. **Watch for recurring-bug smell → refactor to one owner.** When the same bug shows up
   twice, stop patching and centralize (as we did with schema-sync). One well-tested
   trigger beats ten patches.
5. **Prune, don't just add.** AI adds readily and deletes reluctantly. Periodically ask
   it to find dead code, duplicate logic, and stale docs/tests. Entropy you can't see is
   the long-term killer.
6. **Keep dependencies boring and few.** Each new lib is surface area you must trust.
   Prefer the stack you have.

### A definition of done for this repo
A change is done when: it's planned & you understood it → typechecks → lint passes →
tests (incl. a new regression test) pass → **the real app was driven and observed** (not
just tests) → docs/memory updated if behavior or architecture changed.

---

## 4. Tests level — what good testing looks like here

Tests are your **regression contract**, not decoration. The repo already has a solid
base (~49 editor tests + shared + server) built up feature-by-feature — keep that habit.

### The kinds of tests in this repo and when to use each
- **Pure-logic unit tests** (fastest, most valuable). Example:
  `packages/shared/src/subflow-outputs.test.ts` exhaustively tests the output classifier
  with no I/O. **Rule:** any pure decision function (schema rules, IR transforms,
  classifiers) gets exhaustive unit tests. This is the cheapest correctness you can buy.
- **Store/logic integration tests** (node env, fast). Drive the *real* Zustand +
  schema stores, mock only the API. Example: `apps/editor/src/lib/subflow-schema.test.ts`
  asserts the exact value a component reads. **Rule:** state-flow bugs (like the empty
  dropdown) are caught here.
- **Component/DOM tests** (jsdom). Render the real component, assert what the user sees.
  Example: `apps/editor/src/components/PropertyPanel.test.tsx` — "the Filter shows a
  column dropdown, not a text input." **Rule:** logic-to-UI bugs need this; store tests
  alone won't catch a rendering regression.
- **Server route/e2e** (real temp SQLite DB). The repo's `MemoryStorage` route tests
  can't exercise the DB-backed repos (cascade, references), so **drive a real server on
  a temp DB with HTTP requests** for those — that's how we verified project-delete
  sparing subflows and the ambiguity error.

### When you fix a bug
Write the test that **fails before the fix and passes after** — *first* if you can. This
session's most reliable fixes came from reproducing the exact scenario as a test, then
fixing until it went green. A fix without such a test will regress.

### What tests do NOT prove (know the ceiling)
- Green tests ≠ the app loads (import cycles, HMR). → need §5.
- Node-env tests ≠ the browser renders it. → need jsdom/DOM tests for UI.
- Passing ≠ correct if the test asserts the wrong thing. Read the assertion.

### Running them
`pnpm test` (all, via turbo) · `pnpm --filter @beamflow/editor test` ·
`pnpm --filter @beamflow/server test`. New editor tests: `*.test.ts` (node) or
`*.test.tsx` (jsdom, add `// @vitest-environment jsdom` at top). See `docs/debugging.md`.

---

## 5. Smoke tests level — the cheapest insurance against AI regressions

A **smoke test** answers one question: *does the app actually come up and work at all?*
It is the guard against the class of bug that passes every unit test and still ships a
blank page. This session that class hit us **twice** (import-cycle crash, HMR staleness).
Do not skip it.

### The minimum viable smoke test (highest value)
"**The app mounts and there are zero console errors.**" We ran this by hand with headless
Chrome — it caught the blank-page crash that 40 passing tests missed:
- serve the built editor, load `/` in headless Chrome
- assert the root element has content (React mounted, not `<div id="root"></div>`)
- assert **no** `console.error` / uncaught exceptions
This is ~30 lines and belongs in CI so *the machine* catches it, not you.

### The next level (worth it as the app grows)
A tiny **Playwright** E2E suite driving the real stack for the few critical journeys:
log in → create a workflow → connect nodes → the column dropdown populates → generate
code succeeds. This is the only thing that catches full-stack seam bugs and CSS/layout
regressions (like the toolbar overlap) that jsdom can't see. Keep it *small* — 3–5
journeys — so it stays fast and you actually run it.

### Why smoke tests matter more than more unit tests
Unit tests get *deep* on logic you already understand. Smoke tests get *broad* — they
prove the pieces still connect. AI is good at making each piece pass in isolation; the
**seams** are where its work fails silently. Smoke tests watch the seams. **Rule of
thumb:** before trusting any "it works now" from an AI (including me), the app should
have been *driven and observed*, or a smoke test should have.

---

## 6. Your 30-day plan (concrete)

**Week 1 — safety net (mostly tooling, I can do most with you):**
- Add GitHub Actions CI: build + lint + typecheck + test on every push.
- Add the headless "mount + no console errors" smoke test to CI.
- Fix the ~4 stale server tests so green means green.

**Weeks 2–3 — the learning slice (~20–30 hrs):**
- TypeScript: strict types, reading generics, following a type through the codebase.
- JS modules & bundlers: import cycles, ESM, why browser ≠ Vitest, what a bundle is.
- Zustand + React hooks/effects: store singletons, selectors, when effects run, HMR.
- Practice by **reviewing** real diffs in this repo (read the last ~15 commits and ask
  the §1 review questions of each).

**Week 4 — process:**
- Adopt the definition-of-done (§3) for every change.
- Add a small Playwright smoke suite for the 3–5 critical journeys.
- Do a first "prune" pass: ask AI to find dead code / duplicate logic / stale docs.

---

## 7. The one-paragraph version

The architecture here is good; the risk is invisible entropy and plausible-but-wrong AI
changes. You don't need to master React — you need enough **TypeScript, JS modules, and
Zustand/hooks to review and verify**, plus **CI + a headless smoke test** so the machine
catches what your eyes miss, plus the **plan→approve→implement→verify→test→document**
loop so structure stays yours. Tests are your regression contract; smoke tests guard the
seams; docs are your continuity. Do that, and AI accelerates you without owning you.

---

*Related: [architecture.md](architecture.md) · [debugging.md](debugging.md) ·
[subflows.md](subflows.md) · [schema-propagation.md](schema-propagation.md) ·
[projects.md](projects.md)*
