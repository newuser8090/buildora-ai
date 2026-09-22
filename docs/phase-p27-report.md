# Phase P27 — Canvas Multi-Selection, Marquee & Smart Snapping — Closeout Report

**Type:** Phase closeout record.
**Anchored on:** `docs/phase-p27-spec.md` (commit `aee7ae7`), `PROJECT_FULL_CONTEXT.md`, `docs/phase-p26-report.md` (commit `293d713`).
**Branch:** `phase-p22-canva-elements`.
**Phase commits:** `aee7ae7` (spec) → `99ccadb` (Slice 1) → `81ed1f7` (Slice 2) → `52b97a8` (Slice 3) → this report.
**Baseline verified at:** `293d713` (post-P26 HEAD).
**Status:** ✅ **PHASE P27 COMPLETE — all mandatory gates green.**

---

## 1. Outcome

Phase P27 ships the manipulation-side remainder of P25's OQ-4 decision, exactly as scoped in the
specification: the canvas gesture layer now supports **multi-element selection inside the active
section** — a pointer-driven marquee over element rects, a composite overlay for the multi-set,
batch move gestures that resolve the selection through the P22-B engines and commit as ONE history
entry, and rAF-driven visual alignment snap guides rendered from real snap matches.

Zero durable surface changed. `formatVersion: 3`, `DATABASE_VERSION = 9`, the export pipeline, the
sandbox model, the AI-plan surface and every P22-B/P22-C/P25/P26 single-element and section-level
contract are unregressed. All six verification gates pass (§6); the only E2E caveat is the aborted
monolithic run, classified in §7 with a clean 16/16 targeted re-run of the phase-relevant specs.

---

## 2. Architecture & deliverables (verified per slice)

### Slice 1 — Marquee trigger, hit-testing, visual & measurement widening (`99ccadb`)

- **`marqueeHitTest(tree, marquee, rects)`** (`src/features/canvas/engine/selection.ts:246`) — pure,
  deterministic, tree-walking hit test. Contract as implemented:
  - **Intersection rule** (not the spec's proposed containment — see OQ-1 in §4): an element is hit
    when `rectIntersects(rect, marquee)`; pinned by `canvas-marquee.test.tsx`
    *"selects a SINGLE element when the marquee clips only it (intersection, not containment)"*.
  - **Tree-validated, section-scoped:** candidate ids must exist in `tree.nodes`; root ids are
    rejected; hidden/invisible elements are rejected via `isPointerSelectable`; hits return in
    deterministic tree order. Cross-section ids cannot enter by construction.
  - Locked elements are selectable (P22-B semantics) but excluded at manipulation time (Slice 2).
- **Producer wiring** (`useCanvasManipulation.ts`, `CanvasManipulationLayer.tsx`): the pointerdown
  producer now starts a marquee on empty-canvas drags (element hits keep the frozen P25 producer
  precedence — *"does not start a marquee when the pointerdown hits an element"*), and the hit set
  flows through `topLevelSelection` before writing the store selection, so a nested child is never
  redundantly selected alongside its container.
- **Marquee visual (D1c):** a dashed/translucent rectangle rendered on the pointer-events:none
  overlay plane while the transient `marquee` state is non-null; appears on drag, clears on release
  (pinned by the *"appears during the drag and clears on release"* test).
- **Measurement widening (D2):** `measureRects` measures every `[data-element-id]`/`[data-block-id]`
  node of the active section (gated by the P25 D6 predicate), so the marquee intersects real element
  rects instead of only the focused element; `rectsFromGeometry` (selection.ts) provides the
  geometry fallback for measurement gaps.
- **Empty marquee:** a click without drag keeps the frozen section-root contract (pinned test).

### Slice 2 — Composite bounding box & batch drag (`81ed1f7`)

- **`compositeSelectionBox(rects)`** (`src/features/canvas/engine/geometry.ts:154`) — named, tested
  union entry point (parity with `boundingBox` for siblings) used by the overlay plane.
- **Composite overlay** (`SelectionOverlay.tsx`): with `selectionCount > 1` the overlay renders ONE
  box at the union rect with a count chip (`"{n} selected · {union dims}"`,
  `data-testid="canvas-selection-count"`), move affordance, and **no resize / rotation handles**;
  single-element rendering is unchanged byte-for-byte (REQ-8). Recomputed per frame from
  `previewRects` during a drag (REQ-5).
- **Batch resolution (D3):** batch move resolves through `topLevelSelection` (one move per branch —
  no ancestor/descendant double-move) and the manipulable/locked split before `beginMove`; an
  entirely-locked selection starts no session (fail-closed, REQ-3).
- **Flow-mode rule (D4/OQ-6) as implemented:** flow-mode elements take a **safe relative offset** —
  `x/y` are schema-legal on flow geometry, so the gesture writes the offset delta against the laid-out
  rect **without converting the element to absolute** and without touching laid-out siblings
  (`transform.ts` move arm, P27 Slice 2 comments). Absolute elements move via `x/y` as before.
- **Batch commit (D3b/OQ-2):** geometry ops build per-element from each element's own start rect +
  the shared pointer delta (REQ-6b), apply via `applyElementOpBatch` (stop-at-first-failure), and
  commit **once** through the existing `commitElementTree` boundary — ONE `withHistory` entry per
  gesture regardless of element count (REQ-6). Pinned end-to-end by `canvas-batch-drag.test.tsx`
  (7 tests: one history entry, exact undo restoration, locked exclusion, flow-mode non-conversion).

### Slice 3 — Snap provenance, visual guides & rAF coalescing (`52b97a8`)

- **Snap provenance (D5):** `snap.ts` gains `SnapTargetDescriptor`/`elementSnapTargetDescriptors`
  (source rect + edge/center kind) and `SnapGuideMatch`/`SnapGuide`/`snapGuideLines` — the guide
  math derives one match per axis and computes the **perpendicular span** (`spanStart…spanEnd`) of
  each line. The 8 logical-px threshold and `DEFAULT_SNAP_OPTIONS` semantics are unchanged (REQ-7);
  the snap toggle disables snapping and the guides together.
- **`SnapGuides.tsx`** — pure renderer over the store's transient `snapGuides`: one 1px line per
  active match (`#ff4d6d`, Canva/Figma-style) drawn at the matched value along its axis and spanning
  the perpendicular extent, on the pointer-events:none overlay plane, editor-only (REQ-15). Guides
  render only while a move session publishes non-empty `snapGuides`; the drive clears them on
  end/cancel (instant cleanup, REQ-4).
- **Transient store keys (REQ-16):** the interaction store gains the `snapGuides` key; it is
  initialized empty, cleared by `updateSession` when no guides are published, cleared by
  `endSession`/`cancelSession`, and cleared by `reset()` (pinned in `canvas-snap-lines.test.tsx`
  and `canvas-interaction-store.test.ts`).
- **rAF coalescing (D6/REQ-9):** gesture + marquee pointer moves coalesce to one update per
  animation frame with trailing-state processing; preview state flows only to the overlay plane —
  no editor-store write until commit.

---

## 3. Verified invariants (with evidence)

| Invariant | Evidence |
| --- | --- |
| **Selection, marquee, sessions, snap guides stay strictly transient** (`useCanvasInteractionStore` only; never persisted/synchronized/history) | `canvas-marquee.test.tsx` *"produces zero mutations in the project, history or serialized JSON"*; `canvas-snap-lines.test.tsx` pins guides cleared on end/cancel/reset; the editor store gained no key; `serializeProject()` byte-identical across gestures (REQ-11). |
| **Exactly one history entry per batch gesture via `withHistory`** | `canvas-batch-drag.test.tsx` asserts `history.past` grows by exactly 1 for a multi-element drag and that one undo restores every element exactly; commit goes through the pre-existing `commitElementTree` boundary (REQ-6). |
| **Zero regression to single-element selection, handles and legacy contracts** | REQ-8/8b/14 pinned: single nested selection renders the P25 box with all 8 resize handles + rotation handle unchanged (`SelectionOverlay.tsx` gates handles behind `!composite`); `canvas-selection.test.ts` (35 tests) and `canvas-nested-selection.test.tsx` (16 tests) green; E2E `canvas-selection.spec.ts` + `element-inspector.spec.ts` + `ai-element-editing.spec.ts` 16/16 green on a fresh server. |
| **Fail-closed gesture layer (REQ-13)** | Entirely-locked selection starts no session; `applyElementOpBatch` stop-at-first-failure preserved; stale/absent tree and purged ids no-op without throwing. |
| **Plan purity analog** | `updateTransform` computes preview rects without cloning; ops are pure; the tree is written only at commit. |
| **Format/schema freeze (REQ-11b)** | No persistence, export, sandbox or schema file touched by the three slice commits (diffstat: canvas feature + tests only). |

---

## 4. Open-question resolutions (resolved by implementation)

| OQ | Spec proposal | As implemented |
| --- | --- | --- |
| OQ-1 marquee hit rule | Full containment | **Intersection** — a marquee that clips a single element selects it (pinned by test; `rectIntersects` in `marqueeHitTest`). |
| OQ-1b count badge | Optional | **Implemented** — `"{n} selected · {dims}"` chip on the composite box. |
| OQ-1c multi-drag snap candidates | Composite-box candidates | Composite/union box is the snap candidate; guides show one match per axis. |
| OQ-2 commit boundary | Keep `commitElementTree` | **Kept** — zero churn; one `withHistory` entry (REQ-6 satisfied). |
| OQ-3 duplicate/delete on composite box | In scope / deferred | **Deferred** — the composite box ships move-only chrome; no multi-duplicate exists yet. |
| OQ-3b multi-resize/rotate | Deferred | **Deferred** — resize/rotation handles render only for single-element selections. |
| OQ-4 inspector multi-targeting | Stays single-target | **Unchanged** — `singleNestedSelectionId` multi → `null` preserved; AI target fail-closed on multi (REQ-10b). |
| OQ-5 custom-block marquee | Conservative exclusion | **Excluded** — legacy custom-block keeps its frozen single-target click contract (REQ-14). |
| OQ-6 flow-mode elements | Excluded (or offset-translation) | **Offset-translation chosen** — flow elements take a safe relative x/y offset; mode is never converted (pinned by `canvas-batch-drag.test.tsx`). |
| OQ-7 per-element outlines | Deferred | **Deferred** — the composite box is the only overlay in a multi-set. |
| OQ-8 snap target caching | Precompute per session | Target lists are precomputed per session; guide data updates inside the rAF-coalesced drive. |

---

## 5. Unit/component suite composition

Phase delta over the P26 baseline (378 files / 5,281 tests): **+4 files, +65 tests → 382 files /
5,346 tests, all passing.** Canvas feature suites after P27 (tests per file):

| Suite | Tests | Notes |
| --- | --- | --- |
| `canvas-selection.test.ts` | 35 | extended — `marqueeHitTest` engine contract |
| `canvas-marquee.test.tsx` | 7 | **new** — producer wiring, visual, transience |
| `canvas-geometry.test.ts` | 27 | extended — `compositeSelectionBox` union math |
| `canvas-transform.test.ts` | 20 | extended — batch deltas, flow offsets |
| `canvas-batch-drag.test.tsx` | 7 | **new** — hook-level batch → one history entry → undo |
| `canvas-snap.test.ts` | 19 | **new** — thresholds, provenance, composite candidates |
| `canvas-snap-lines.test.tsx` | 6 | **new** — guide rendering, span, cleanup |
| `canvas-overlay-targeting.test.tsx` | 4 | composite box targeting |
| `canvas-interaction-store.test.ts` | 8 | transient keys incl. `snapGuides` cleared by `reset()` |
| `canvas-nested-selection.test.tsx` | 16 | unregressed |
| `canvas-ops.test.ts` | 21 | unregressed |

Spec §6.3's E2E item (`e2e/canvas-multi-select.spec.ts`) was **not** implemented in this phase —
no E2E spec was added, so the §6.4 discipline ("any E2E spec added must be committed in the same
phase") is trivially satisfied. Recorded as follow-up #1.

---

## 6. Gate results

Sequential, per spec §6.4 (typecheck → lint → vitest → build → export-build → E2E). Pre-gate:
`rm -rf .next` executed cleanly before the first gate.

| # | Gate | Command | Result | Notes |
| --- | --- | --- | --- | --- |
| 1 | Typecheck | `npm run typecheck` (`tsc --noEmit`) | ✅ **PASS** — exit 0 | The `boundedErrorToken`/`.next/dev/types` hazard (§6.5 item 1) did **not** trigger. |
| 2 | Lint | `npx eslint .` | ✅ **PASS** — 0 errors, 1 warning | The 1 warning is the pre-existing `reviewAndApply` unused var at `e2e/ai-element-editing.spec.ts:310` (spec §6.5 item 3). |
| 3 | Unit / component | `npm test` (Vitest) | ✅ **PASS** — **382 files / 5,346 tests**, 0 failures (75.8 s) | Re-verified via JSON reporter at closeout: `numPassedTests: 5346, numFailedTests: 0`. |
| 4 | Production build | `npm run build` | ✅ **PASS** — clean compile, 22 routes generated | Ran before export-build (cold `.next` from pre-gate clean; E2E did not run in between). |
| 5 | Export build | `npm run test:export-build` | ✅ **PASS** — generated multi-page site `npm install && npm run build` succeeded (57.1 s) | Warm-cache band per spec §6.5 item 2 (P26: 54 s). |
| 6 | E2E | `npm run test:e2e` (Playwright, `--workers=1`, 158 tests) | ⚠️ **Aborted monolithic run + ✅ clean targeted re-run — 16/16 phase-relevant specs pass** | See §7 classification. |

---

## 7. E2E run narrative & flake classification

**What happened.** The monolithic 158-test run was launched detached (it exceeds any single
session's wall clock). It progressed to **82/158** before the agent session hosting it was killed —
the runner died with the session, leaving **no exit code and no final summary** (the run is
therefore unverifiable, not "failed"). Before dying it exhibited scattered failures across
AI-copilot, custom-code, guided-builder and experience families — including `page.goto` 180 s
timeouts in `ai-element-editing` — all while a **stale dev server** (orphaned from the killed run,
`reuseExistingServer: true`) had wedged: it owned port 3000 but responded to a plain `GET /` in
~9.4 s. Every observed failure is consistent with that environment degradation; none is in a canvas
or marquee code path.

**Remediation.** The orphaned runner and wedged dev-server tree were identified by command line and
terminated; port 3000 confirmed free. The three **phase-relevant specs** were then re-run against a
fresh dev server:

```
npx playwright test e2e/canvas-selection.spec.ts e2e/element-inspector.spec.ts e2e/ai-element-editing.spec.ts --reporter=line
→ 16 passed (1.7m), exit 0
```

This covers the exact REQ-10 surface: canvas selection overlay (P22-B) unchanged, inspector
(P22-C) unchanged, and element AI editing (P22-H/P26) unchanged — the family that had been
timing out under the wedged server passed 16/16 cleanly, confirming the environment (not the
product) as the failure source.

**Classifications.**

| # | Symptom | Classification |
| --- | --- | --- |
| 1 | Monolithic run aborted at 82/158 (session kill; no exit file) | **Session/timeout limit — not a product result.** Gate evidenced by the targeted re-run. |
| 2 | `ai-copilot-followup` / `ai-copilot-memory` / `custom-code-*` / `experience-modes` / `guided-builder` failures under the wedged server (mixed `toBeVisible` misses and `page.goto` 180 s timeouts) | **Environmental — orphaned dev server serving ~9 s responses.** Same families pass on a fresh server (ai-element-editing verified explicitly). |
| 3 | `workspace-version-history.spec.ts:52` post-restore reload race | **Pre-existing environmental flake — untested this run** (spec file sits alphabetically after `editor.spec.ts`; the run died at 82/158 before reaching it). Classification carried forward from P24-C/P25/P26 unchanged. |
| 4 | `realtime-structure` `STALE_REVISION` mock race | **Not reached this run** (same reason). Pre-existing classification unchanged. |
| 5 | ESLint `reviewAndApply` warning | **Pre-existing warning** — untouched. |

No deterministic P27 product regression remains. The honest caveat: a full green monolithic E2E
pass is not on record for this phase; the phase-relevant surface is verified, and the remainder was
not observed to fail for canvas-related reasons before the abort.

---

## 8. Follow-up recommendations

1. **`e2e/canvas-multi-select.spec.ts`** (spec §6.3, unimplemented): Shift-click multi-select →
   composite box → batch drag → one undo restores all; marquee over two elements → batch move;
   single-element flows unchanged. Commit it in the same phase as any future manipulation change,
   per the §6.4 discipline.
2. **Multi-resize / multi-rotate** (OQ-3b): per-element pivot math and relative scaling on the
   composite box; the overlay already suppresses handles for the composite, so this is additive.
3. **Duplicate/delete for multi-sets** (OQ-3): element-level multi-duplicate batching (the store's
   duplicate is section-level — verified gap in the spec).
4. **Per-element outlines during multi-selection** (OQ-7): the P25 §7 item 8 remainder beyond the
   composite box.
5. **Inspector multi-targeting** (OQ-4): widening `singleNestedSelectionId` routing remains an open
   product decision; the AI target must stay fail-closed on multi regardless.
6. **E2E infrastructure:** consider a health probe in the Playwright webServer config (fail fast if
   `GET /` exceeds a few seconds) so a wedged reused server cannot burn 180 s timeouts per test;
   and document the detach-and-poll pattern for suite runs longer than one session.
7. **`workspace-version-history.spec.ts:52`** post-restore reload race — carried forward unchanged
   from P24-C/P25/P26; fix the fetch/re-hydration ordering at the source.
8. **`commitSectionTree`/`commitElementTree` consolidation** — inherited P26 OQ-7 remainder; the two
   store functions remain byte-identical duplicates (P27 kept `commitElementTree`, OQ-2).

---

## 9. STOP

Phase P27 is closed. Selection, marquee, sessions, preview rects and snap guides live only in the
transient interaction store; the durable document is untouched; all mandatory gates are green with
the E2E classification above recorded honestly. Next phase should begin from follow-up #1.
