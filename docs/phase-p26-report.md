# Phase P26 — AI Copilot Element-Tree Context & In-Place Direct Editing (closeout report)

Branch: `phase-p22-canva-elements`
Specification: `docs/phase-p26-spec.md` (commit `6450727`)
Status date: 2026-09-21
Scope of this report: **validation / closeout of the P26 implementation.** No product behaviour was
redesigned during closeout; no implementation change was required by the gate evidence.

Commits in this phase:

| Commit | What |
| --- | --- |
| `6450727` | `docs: add Phase P26 specification for AI copilot element-tree editing` |
| `3c44cb1` | `feat(ai-copilot): resolve selected element context from durable section trees (P26 Slice 1)` |
| *(this closeout)* | `docs: close out Phase P26 AI copilot element-tree editing` |

Delivered-scope note (honest): the phase ships spec **Slice 1** — target generalization (D1), the digest
tree fix (D2), and the unified durable commit path (D7). The geometry digest field and the
`update-element-geometry` operation (spec D3/D4, REQ-3/REQ-5, Slice 2) were **not** part of this delivery —
the implementation commit states it explicitly ("No new geometry operations, no schema/version/cap change")
and the code search confirms no such op or digest field exists. OQ-3 (absolute vs relative geometry) remains
open and gates that slice. See §7.

---

## 1. Outcome

**P26 is COMPLETE** for its committed scope. The AI element-scope pipeline is no longer `custom-block`-only:
a user can select an element on **any** section that owns an element surface — a Phase-P24-B durable
`section.tree` (the sections P25 made canvas-renderable and inspector-routable) or a legacy `custom-block` —
and the copilot both **sees** that element (a real element digest reaches the model) and can **edit it in
place**, with the write landing on the durable tree the canvas renders, not in a props fold that would
silently discard geometry / viewport / animation / interaction / custom code.

This discharges the P24-C follow-up #8 asymmetry recorded verbatim in the P25 report §7 item 7:

> **Element-scoped AI entry remains `custom-block`-only** — `useElementEditTarget` /
> `resolveElementEditTarget` still reject non-`custom-block` sections, so the canvas element focus now
> reachable on durable sections is not yet offered to the element-scoped AI composer (OQ-3).

The spec's sharpest correctness trap (F6/R1 — a second, nested history entry per plan) did not materialize:
the apply boundary composition follows D7 exactly, with the simulator's element arm writing through the
**same** durable preparation the editor store uses, and `applyAiEditPlan` remaining the single
transaction boundary (§3).

Nothing in this phase changed persistence, schemas, versions (`formatVersion: 3`, `DATABASE_VERSION = 9`),
the sandbox, the message protocol, the caps, the plan caps, or the export pipeline (spec §1.3). The legacy
`custom-block` whole-tree `props.tree` fold is untouched.

---

## 2. Verified changes

All three changes below were read from the working tree at `3c44cb1` and are pinned by unit tests.

### 2.1 Target element resolver widened (spec F1/D1, REQ-1)

`src/features/ai-editing/selected-element.ts:97` — the P22-H hard rejection
`if (!isCustomBlockSection(section)) return null;` is replaced by:

```ts
if (!sectionHasDurableTree(section) && !isCustomBlockSection(section)) return null;
```

- OQ-1 is **answered**: the predicate is `sectionHasDurableTree(section) || isCustomBlockSection(section)`,
  the disjunctive form the spec §3 D1 required if `sectionHasDurableTree` does not cover `custom-block`.
  The shared predicate `sectionHasDurableTree` (`section-element-adapter.ts:170`) is the same one the
  inspector routing and the P25 canvas render switch consult — no private re-implementation.
- The guards the spec made non-negotiable are preserved: `targetFor` still filters through
  `isRenderableElementType` (R-1a), and only a single canvas element selection is accepted (R-1b).
- The tree is read through `sectionToElementTree(section)` — the single materialization entry, which prefers
  the durable tree and reconciles bound text from current props; custom-block projects `props.tree`.
- `getElementEditTarget` / `useElementEditTarget` inherit the widening unchanged (REQ-1).
- Evidence: `src/features/ai-editing/__tests__/selected-element.test.ts` (target resolution incl. durable
  sections), and the widened targeting exercised end-to-end by the simulator suite.

### 2.2 Element digest resolves via `sectionToElementTree` (spec F2/D2, REQ-2)

`src/features/ai-copilot/context/context-builder.ts:244` — `buildElementDigest` reads the tree through
`sectionToElementTree(section)` instead of poking `(section.props as { tree?: unknown })?.tree`, which
silently resolved `null` for a durable regular section and degraded the copilot to the inline-field digest
while *looking* context-aware (the F1+F2 atomicity trap, R2).

- The function remains **pure and store-free** (takes `project` + an element scope), so the existing
  determinism and boundedness contract holds unchanged; the digest stays bounded by the existing caps
  (8 keys / 120-char values / 300-char metadata) and `COPILOT_LIMITS.maxContextBytes` (REQ-4).
- No new digest field was added — `geometry` (spec D3/REQ-3) is deliberately not in this delivery (§1).
- Evidence: `src/features/ai-copilot/__tests__/context-builder.test.ts`, "P26 Slice 1" suite — a durable
  regular section (hero with `section.tree` materialized) produces a real element digest for a nested
  element, alongside the unchanged legacy custom-block digest assertions.

### 2.3 Shared `prepareDurableSectionCommit` — one durable write path (spec D7/D8, REQ-6)

New `src/features/elements/adapters/section-tree-commit.ts` exports `prepareDurableSectionCommit(section,
tree)`, the **regular-section half of the durable commit contract**, extracted into one pure function so
the editor store and the AI plan simulator cannot drift:

- **Simulator apply path** (`plan-simulator.ts:566`): the element arm's durable branch calls the helper
  after `applyFn(tree)`; the obsolete `custom-block`-only restriction (`plan-simulator.ts:481-488` of the
  P26 baseline) is lifted to "any section that owns an element surface"
  (`!isCustom && !sectionHasDurableTree(section)` → structured op error, never a silent drop), and the
  rationale comment was replaced with the accurate remaining constraint per D8.
- **Store commit path** (`editor-store.ts:525`, inside `prepareSectionTreeCommit`): the regular-section
  branch delegates to the same helper, replacing the store's private durable preparation.
- **Write shape**: the resulting section carries `{ ...section, tree: normalized, props, styles }` — the
  normalized tree written **directly to `section.tree`**, with folded props/styles kept in sync for legacy
  renderers. No-op detection is key-order-insensitive deep equality against the stored durable tree (or, for
  a legacy section, against what the current props already materialize to), so a no-op never eagerly
  materializes a legacy section and never creates a useless history entry.
- **Legacy `custom-block` untouched** (REQ-13): it does not come through the helper — both callers keep the
  existing whole-tree `props.tree` fold (`elementTreeToSection` + the `isCustom` branch), byte-identical.
- Fail-closed (REQ-14): an unnormalizable tree or a failed fold returns a structured `{ ok: false, reason }`
  — never a thrown error, never a partial apply.
- Evidence: `src/features/ai-editing/services/__tests__/element-plan-simulator.test.ts` (element ops on a
  durable regular section persist to `section.tree`; legacy custom-block unchanged) and
  `src/features/editor/store/__tests__/editor-store-section-tree.test.ts` (kept green — the suite that
  catches an accidental double-commit, R1).

### 2.4 Non-goals honoured

No change to: `plan-schemas.ts` (no new operation type), `element-schemas.ts`, `block-style-to-css.ts`
(never promoted to a validation boundary, D5), the export pipeline, the sandbox capability model, the
capsule caps, `PLAN_LIMITS`, `formatVersion` / `DATABASE_VERSION`, or the server-side rate limiters /
Gemini fallback (§1.3 items 1–7).

---

## 3. Invariant verification

| Invariant | Evidence |
| --- | --- |
| **Single history entry per AI plan application** (REQ-9, D7, R1) | `applyAiEditPlan` (`editor-store.ts:1095`) remains the ONLY AI-plan transaction boundary: identity → stale-revision → selection-closure → no-op → destructive guards, then step 6 simulates the whole selected set on a **clone** (`simulatePlan(state.project, selected, { captureSnapshots: false })`), then step 7 commits the result as exactly ONE `set(withHistory(state, …))` (`editor-store.ts:1199-1204`). No `commitSectionTree`/`commitElementTree` call exists inside the apply path, so no nested `withHistory` entry is possible. The element arm's durable write happens inside the simulation (on the clone) via the shared helper; history is created once, afterwards, by the store. `editor-store-ai-plan.test.ts` (one entry per plan; no-op plans add none) and `editor-store-section-tree.test.ts` (kept green) pin this. |
| **Input project immutability during simulation** (plan purity, D9) | `simulatePlan` (`plan-simulator.ts:877`) never touches the caller's project: it starts from `cloneProject(source)` (`:894`) and every applied operation replaces the section on a fresh `cloneProject` (`applyElementOp`, `plan-simulator.ts:572`) before returning `{ project: updated }`. `prepareDurableSectionCommit` is pure — it builds a new section object and mutates nothing. The live store project is read once (`state.project`) and never written until the single `withHistory` commit. Spec §2 "Plan purity" contract ("NEVER mutate the store, NEVER persist, NEVER create history") holds for the widened element arm. |
| **Zero transient state leakage into durable schemas** (REQ-11, Invariant 1) | The durable write shape is exactly `{ ...section, tree: normalized, props, styles }` — no selection, viewport, or UI key can enter it, because the helper's output type has no such field. Element targeting samples `useCanvasInteractionStore` imperatively at prompt-generation time (`getElementEditTarget`) — the pre-existing P22-H behaviour, preserved; no `selectedElementId` / `selection` / `anchorId` key was added to the editor store, and `serializeProject()` is unaffected by selection. The P25 `canvas-interaction-store.test.ts` transience suite remains green. |
| **Single materialization entry** | `sectionToElementTree` stays the only section→tree entry in every AI path: targeting (`selected-element.ts:101`), the digest (`context-builder.ts:244`), the simulator (`plan-simulator.ts:534`), the diff builder, and the store — so `reconcileDurableTreeWithProps` stays active. The P26 work removed the one divergent lookup (`props.tree` in the digest) rather than adding one. |
| **Legacy `custom-block` frozen** (REQ-13) | Both commit callers branch `isCustom` → `elementTreeToSection` whole-tree `props.tree` fold, unchanged; the helper explicitly documents "custom-block sections do NOT come through here". `custom-block` targeting, digest, planning and applying behave as before (existing custom-block suites green). |
| **Non-element plans frozen** (REQ-10) | Only the element arm of the simulator changed; site/page/section operation types, validation, dependency ordering and caps are untouched (`editor-store-ai-plan.test.ts` remains the frozen contract). |
| **Versions / caps / sandbox frozen** (REQ-12) | No change to `CURRENT_FORMAT_VERSION` (3), `DATABASE_VERSION` (9), any schema, migration, cap or the `allow-scripts` sandbox. `npm run build` and `npm run test:export-build` are green. |
| **Shared predicate** (D1) | Targeting (`selected-element.ts:97`), simulation (`plan-simulator.ts:527`) both consult `sectionHasDurableTree` from `section-element-adapter.ts` — the same predicate P24-C/P25 use for inspector routing and canvas rendering. |

---

## 4. Gate results

| Gate | Command | Result |
| --- | --- | --- |
| TypeScript | `npm run typecheck` | ✅ **PASS** — clean, exit 0 |
| ESLint | `npm run lint` | ✅ **PASS** — 0 errors, 1 pre-existing warning (`reviewAndApply`, `e2e/ai-element-editing.spec.ts:310`, untouched) |
| Unit / component | `npm test` (Vitest, `testTimeout: 10_000`) | ✅ **PASS** — **378 files / 5,281 tests** |
| Production build | `npm run build` | ✅ **PASS** — clean, `✓ Generating static pages (9/9)` |
| Export compilation | `npm run test:export-build` | ✅ **PASS** — 54 s |
| E2E — core suite | Playwright, `--workers=1` | ⚠️ **157 passed / 1 failed** — the single failure is the pre-existing `workspace-version-history` environmental failure; see §5 |

**Unit suite composition note.** The phase added 1 file / 18 tests over the P25 baseline (377 files /
5,263 tests). P26-relevant coverage: the new "P26 Slice 1 — durable section element digest" suite in
`ai-copilot/__tests__/context-builder.test.ts`, the element target-resolution suite
(`ai-editing/__tests__/selected-element.test.ts`), and the element-plan simulator suite
(`ai-editing/services/__tests__/element-plan-simulator.test.ts`, extended for durable-section targets and
the shared commit shape).

**Gate order** followed spec §6.3: typecheck → lint → vitest → build → export-build → E2E, sequential.

---

## 5. Failures, flakes and their classification

| # | Symptom | Evidence | Classification |
| --- | --- | --- | --- |
| 1 | `e2e/workspace-version-history.spec.ts:52` — post-restore reload race: the editor can render the cached pre-restore project before the workspace fetch + re-hydration lands | The single core-E2E failure. Documented before P26 in `docs/phase-p24c-report.md` §7 item 3 and P25 §5 item 2; also fails in isolation. P26 touched only `selected-element.ts`, `context-builder.ts`, `plan-simulator.ts`, `editor-store.ts` (commit preparation) and the new `section-tree-commit.ts` — zero files under persistence, workspace, versioning or app routes. | **Pre-existing environmental failure — not a P26 regression** |
| 2 | ESLint warning `reviewAndApply` unused (`e2e/ai-element-editing.spec.ts:310`) | Unchanged, untouched by P26; the 1 warning in the lint gate. | **Pre-existing warning** |
| 3 | `npm run typecheck` failing on `.next/dev/types/app/api/generate/route.ts` (`boundedErrorToken`) | **Did not reproduce this run** — typecheck exit 0. | **Pre-existing artifact hazard — dormant, not triggered** |
| 4 | `realtime-structure.spec.ts` mock checkpoint `STALE_REVISION` race | Green in this run (no failure recorded). | **Pre-existing flake family — green this run** |
| 5 | Export-build cold-cache timeout risk | Passed warm in 54 s (P25: 51.4 s). | **Pre-existing hazard — not triggered** |

No deterministic P26 product regression remains.

---

## 6. Open questions resolved

| # | Question | Resolution |
| --- | --- | --- |
| **OQ-1** | Predicate shape: `sectionHasDurableTree` alone vs the disjunction | **Disjunction.** `sectionHasDurableTree(section) \|\| isCustomBlockSection(section)` (`selected-element.ts:97`) — `custom-block` flows are untouched *by construction*, not only by test (§2.1). |
| **OQ-2** | Digest geometry: unconditional vs conditional | **Deferred with Slice 2.** No `geometry` field was added to the digest in this delivery. |
| **OQ-3** | Absolute vs relative geometry authoring | **Open.** Gates the `update-element-geometry` operation (R4); must be answered before Slice 2 per the spec's STOP clause. |
| **OQ-4** | Ownership of P25's element-AI follow-up | **Discharged by this phase** — the P25 §7 item 7 deferral is P26's headline and is now closed. |
| **OQ-5** | Narrower AI-only animation allow-list (excluding `custom`) | **Open** — no animation vocabulary change shipped; relevant only when Slice 2 lands. |
| **OQ-6** | Unsupported interactions: warn vs refuse | **Open** — no planner change shipped; relevant only when element planning widens its vocabulary. |
| **OQ-7** | Consolidate `commitSectionTree` / `commitElementTree` | **Partially mitigated, still recorded.** The regular-section *preparation* half is now shared (`prepareDurableSectionCommit`), but the two byte-identical store functions remain; full consolidation is still deferred (R10). |
| **OQ-8** | Prompt-template change vs context-payload-only | **Context payload only.** The planner prompt/system prompt shape is unchanged; only the digest's tree resolution changed. |

---

## 7. Recorded follow-ups (none blocking; not addressed in this phase)

1. **Slice 2 — geometry in the digest and as an operation** (spec D3/D4, REQ-3/REQ-5): no
   `update-element-geometry` op exists in `AiEditOperationSchema` and `CopilotElementDigest` carries no
   `geometry` field. Requires OQ-3 (absolute vs relative) to be answered first.
2. **Slice 3 remainder — copilot UI review surfaces** for element-level changes on durable sections
   (spec S5), and **Slice 4 E2E** — extend `e2e/ai-element-editing.spec.ts` with the durable-section
   select → ask → review → accept → one-undo flow and the reject-writes-nothing flow (spec §6.2).
3. **`workspace-version-history.spec.ts` post-restore reload race** — the editor can render the cached
   pre-restore project before the workspace fetch + re-hydration lands (§5 item 1). Pre-existing; carried
   forward from P24-B/P24-C/P25.
4. **`realtime-structure.spec.ts` mock checkpoint `STALE_REVISION` race** — concurrent checkpoints can
   leave the mock server one revision behind; needs a bounded retry. Pre-existing; carried forward.
5. **`boundedErrorToken` / `.next/dev/types` artifact** — pre-existing default-typecheck hazard after an
   E2E run (did not trigger this run). Fix by moving the helper out of the route module or excluding
   `.next/dev/types` from `tsconfig.json`.
6. **Export-build cold-cache stability** — 54 s warm; has timed out once (>600 s) cold. Consider
   `--prefer-offline` / cache warm-up.
7. **Pre-existing ESLint warning** in `e2e/ai-element-editing.spec.ts:310` (`reviewAndApply`).
8. **`commitSectionTree` / `commitElementTree` consolidation** (OQ-7 remainder) — the shared preparation
   removed one drift risk; the two store functions remain byte-identical duplicates.
9. **Multi-element / marquee overlay** and **inline text editing on durable tree sections** — carried
   forward unchanged from P25 §7 items 8–9.

---

## 8. Final status

- **Implementation:** complete for the committed Slice 1 scope and intact. Durable-section element
  targeting, the durable-aware element digest, the shared `prepareDurableSectionCommit` write path and the
  single-transaction apply boundary are all present and green in the unit suite.
- **Gates green:** typecheck (clean, exit 0), ESLint (0 errors, 1 pre-existing warning), Vitest
  **378 files / 5,281 tests**, production build (9/9 static pages), export-build (54 s), core E2E
  **157/158** with the one failure classified as pre-existing environmental (§5).
- **Spec decisions discharged:** D1 (disjunctive predicate, OQ-1), D2 (`sectionToElementTree` digest
  lookup), D7 (shared durable preparation, one history entry — the R1 double-commit trap avoided by
  construction), D8 (simulator restriction lifted in lockstep with the resolver, comment corrected), D9
  (plan purity preserved).
- **Security posture unchanged:** no `eval`, `new Function`, `dangerouslySetInnerHTML`, srcdoc or iframe
  payload on any AI path; insert ops still carry only registered renderable types plus bounded content;
  no schema, cap, version or sandbox change.
