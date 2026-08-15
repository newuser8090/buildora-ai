# Phase P22-B — Canvas Selection & Manipulation (Report)

> Baseline: P22-A complete. This phase implements the interaction layer around
> the universal `ElementNode` model. **P22-B complete. P22-C not started.**

---

## 1. What was audited

- The editor canvas (`src/components/editor/Canvas.tsx`), section selection
  (`SelectableSection.tsx`), viewport/zoom state, and the editor store's
  mutation boundary (`withHistory` / `commitLocalProject` / `commitBlockTree`).
- The P22-A element model, registry, operations engine, schemas, and the
  section→element adapter.
- The custom-block persistence path (`custom-block-schema.ts`,
  `section-block-adapter.ts` fold/project) — to add durable geometry.
- The existing keyboard system (`useKeyboardShortcuts`) and the inline-editing
  layer (`InlineEditLayer`, `EditableText`) — to avoid collisions.
- The e2e harness (`helpers/projects.ts`, `playwright.config.ts`) and the
  P18–P21 reports (documented flake classes).

## 2. Implementation summary

A new **`src/features/canvas/`** feature with three layers:

| Layer | Files |
|---|---|
| Pure engines | `engine/{geometry,coords,selection,transform,align,layering,clipboard,snap,shortcuts,batch}.ts` |
| Transient store | `store/canvas-interaction-store.ts` (selection/session/marquee/clipboard/snap toggle — never persisted) |
| Orchestration | `hooks/useCanvasManipulation.ts`, `hooks/useCanvasKeyboard.ts`, `components/SelectionOverlay.tsx`, `components/CanvasManipulationLayer.tsx` |

Plus:
- `commitElementTree` action on the editor store (one atomic history entry per
  gesture via the existing `withHistory` boundary).
- Additive `geometry` field on the custom-block node schema + normalizer, so
  element geometry is durable for custom-block sections (optional — old trees
  still validate).
- Mount of `CanvasManipulationLayer` inside the editor preview content.

## 3. Files changed

**Modified (3):**
- `src/components/editor/Canvas.tsx` — preview-content ref + layer mount.
- `src/features/editor/store/editor-store.ts` — additive `commitElementTree`.
- `src/features/code-import/schemas/custom-block-schema.ts` — additive,
  bounded `geometry` on custom-block nodes (schema + normalizer preservation).

**New:**
- `src/features/canvas/` (engine ×10, store, hooks ×2, components ×2).
- `src/features/editor/store/__tests__/editor-store-element-tree.test.ts`.
- `src/features/canvas/__tests__/` (canvas-geometry, canvas-selection,
  canvas-transform, canvas-ops, canvas-interaction-store).
- `e2e/canvas-selection.spec.ts`.

**Docs:** `docs/phase-p22b-architecture.md`, `docs/phase-p22b-report.md`.

## 4. Architecture decisions

1. **Transient vs durable split** — selection/session/preview/clipboard live
   in a dedicated interaction store; only final geometry reaches the element
   model. Selection never mutates durable state.
2. **One commit per gesture** — pointermove publishes previews; pointerup
   builds one immutable op batch and commits once through `commitElementTree`
   → `withHistory`. No independent canvas history.
3. **Engine purity** — all math/tree logic is framework-independent and unit
   tested directly; hooks are thin orchestrators.
4. **Durability via existing fold** — geometry rides the additive custom-block
   node field through normalize → project → fold; regular sections keep the
   existing bound-props fold (documented limitation until P22-C/D).
5. **Collision-free keyboard** — the mount wires only Escape/Cmd+C/Cmd+V/
   arrows; Delete/Cmd+D remain the existing section shortcuts; the typing
   guard is duck-typed and environment-safe.

## 5. Tests added

- **Unit (78 canvas tests + 14 editor-store element-tree tests):**
  - geometry/coords: min-size, all resize handles, aspect ratio, rotation
    normalization/snapping, zoom conversion at 50/100/200%, scroll, **DPR
    invariance (new regression test)**.
  - selection: single/deselect, nested (deepest hit wins), hidden/locked
    guards, set ops, purge, top-level resolution, split-manipulable.
  - transform: move (incl. multi-move relative positions), resize, rotate,
    snap, batch application, op construction.
  - ops: alignment (6 modes), distribution, layer ordering (scoped,
    multi-select, boundaries), clipboard (fresh ids, no shared refs, internal
    key stripping, offsets, round-trip, hostile payload rejection),
    delete/duplicate, keyboard mapping + typing guard.
  - interaction store: selection/session/marquee/clipboard transitions.
  - `editor-store-element-tree.test.ts` (14 tests): `commitElementTree` = one
    history entry, geometry persisted for custom-block sections through the
    normalize → project → fold round-trip (schema validation + preservation).
- **E2E (`e2e/canvas-selection.spec.ts`, 7 tests):** selection box + dims
  chip bound to the section id, Escape deselect, empty-canvas deselect,
  overlay duplicate/delete, typing-guard (Escape inside inspector does not
  deselect), arrow nudge without errors.

## 6. Validation results

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | ✅ clean |
| `npm run lint` | ✅ 0 problems |
| `npm test` (full unit suite) | ✅ **4190/4190** (final run; see §7 for the flake record) |
| `npm run build` | ✅ production build succeeded |
| `e2e/canvas-selection.spec.ts` | ✅ 7/7 |
| `e2e/editor.spec.ts` + `e2e/block-tree.spec.ts` | ✅ 39/39 |
| `e2e/pages.spec.ts` + `e2e/inline-editing.spec.ts` | ✅ 3/4 with default 30s timeout; **4/4 with `--timeout=120000`** (see §7) |
| `test:e2e:matrix` | ✅ 13/13 |
| `test:e2e:fallback` | ✅ 1/1 |
| `test:export-build` | ✅ 1/1 |
| Full `test:e2e` (124 tests, single dev server) | ✅ **121/124** — 3 failures re-verified as environmental (§6.1, §7.3) |

### 6.1 Full e2e suite result

Run once in a background process on a single dev server
(`--grep-invert "[Pp]rompt|[Ff]allback"`, `--workers=1`):

- **121 passed / 3 failed / 0 flaky-labeled**.
- The 3 failures (`ai-copilot.spec.ts:30`, `ai-page-editing.spec.ts:129`,
  `realtime-collaboration.spec.ts:41`) were **re-run in isolation and all
  passed (8/8, 1.2 min)** — see §7.3 for classification and evidence.

## 7. Failures investigated (evidence-based classification)

### 7.1 Inline-editing e2e — pre-existing cold-compile flake (NOT a P22-B regression)

**Observation:** `inline-editing.spec.ts › inline edit, save, undo/redo…`
failed at `waitForURL(/\/editor\/.+/, { timeout: 90000 })` in the shared
`createSaaSProjectAndOpenEditor` helper — a **test timeout (30s)**, not an
assertion in inline editing.

**Evidence it is environmental, not product:**
1. The failure is in the dashboard→editor navigation, **before the editor (and
   therefore `CanvasManipulationLayer`) ever mounts**; the error-context DOM
   snapshot shows the dashboard ("Welcome to Buildora"), no editor.
2. The same spec's second test (identical editor-open flow) passed in the same
   run — cold first-compile of the editor route is the only per-run difference.
3. Re-running with `--timeout=120000` → **2/2 passed** (48.3s). The helper's
   own comment documents this: "on a cold webpack dev server (Windows junction
   workaround) the first compile of the editor route can take >30s."
4. This is the **documented pre-existing flake class** (P18 §8 — "first-hit
   timing flake class on editor routes"; P19 — "E2E cold-compile/hydration
   flake", infrastructure, not product).

**Action:** none to product code or assertions. No inline-editing assertion
was weakened.

### 7.2 Unit-test flake — pre-existing suite-contention flake (NOT a P22-B regression)

**Observation:** one full-suite run reported `1 failed | 4188 passed`;
4 other full-suite runs were green. The failure was **caught with evidence**:
`src/features/template-packages/__tests__/ImportTemplateDialog.test.tsx ›
guards against double-submission on install` — `Unable to find an element by:
[data-testid="template-import-success"]` (async dialog state never settled
under full-suite CPU load).

**Evidence it is pre-existing:**
1. Zero code-path overlap with P22-B: the test exercises the template-import
   dialog; P22-B changes (canvas feature, additive store action, optional
   schema field) are never imported by it, and the canvas layer does not mount
   in the node test environment.
2. **5/5 isolation runs of that file pass** (11/11 each) — it only fails under
   full-suite CPU contention.
3. P22-B's own test files passed **every** full-suite run and a 4× stress
   loop (0 failures).
4. The failure class (async state timing under suite load) matches the
   documented P19 class.

**Action:** none. Documented with evidence.

### 7.3 Full-suite e2e failures — environmental (proven by isolation re-runs)

The full `test:e2e` run reported 3 failures. Each was re-run in isolation on
the same warm server: **all 8 tests across the 3 specs passed (8/8)**.

| Failure | Mode | Evidence for environmental classification |
|---|---|---|
| `ai-copilot.spec.ts:30` — Ctrl+Shift+A opens the panel | `copilot-panel` not visible within 5s | This exact spec is the **documented rotating flake identity** (P18 §8: "Without P18, *different* specs fail and ai-copilot passes — the flake identity rotates"); the canvas keyboard hook is inert here (it is disabled without a selection and never handles Ctrl+Shift+A); passes 2/2 alone |
| `ai-page-editing.spec.ts:129` — review/apply/undo/persist | runtime audit caught `pageerror: Internal Next.js error: Router action dispatched before initialization` | A Next.js dev-mode router hydration race — not an application assertion; the runtime-audit helper fails on ANY page error; the test's plan apply/undo assertions are untouched; passes alone |
| `realtime-collaboration.spec.ts:41` — two editors live-edit | `workspace-editing-indicator` with "Editing" not found within 20s | Matches the documented **realtime-undo/presence pairing flake** (P19); presence indicators are timing-sensitive across two browsers; P22-B does not touch presence/collab; passes alone |

P22-B changes have no code-path overlap with these specs (no canvas layer
mount in their flows, no geometry commits, no keyboard interception of the
involved keys). Combined with the P18 §8 stash-A/B proof of this flake class,
all three are classified **environmental — not P22-B regressions**.

### 7.4 Genuine P22-B bug found in review — fixed

- **`clientToCanvas` divided the scroll offset by devicePixelRatio.** All
  inputs (clientX/Y, bounding rect, scroll offsets) are CSS px; on HiDPI
  displays a scrolled canvas would drift by half the scroll offset. **Fixed**:
  the DPR factor was removed, and a regression test asserts scroll offsets are
  exact at dpr 1/2/3 and under zoom+scroll+dpr.
- Minor notes (documented, not changed): adjacent multi-select one-step
  `forward`/`backward` preserves relative order but does not advance the whole
  group (front/back correct); snap targets use the visible viewport edges;
  clipboard payload width/height are informational (paste uses a fixed 24px
  offset).

## 8. Security review

- Geometry entering durable state is validated/bounded at the schema
  (`NodeGeometrySchema`: finite, range-capped) and engine
  (`ElementGeometrySchema`) boundaries.
- Clipboard: versioned, capped at 200 elements, every node re-validated via
  `ElementNodeSchema`; `_`-internal adapter/collaboration keys are stripped on
  copy — nothing internal leaks.
- No custom-code execution, no raw HTML, no new network surface. Auth, RLS,
  rate limits, security headers, logging, and publishing are untouched
  (P20/P21 guarantees intact).
- Paste enforces nesting at the boundary (`canNestElement`) and the final tree
  is validated once before commit.

## 9. Performance notes

- `pointermove` is O(selected) math on session state — no tree cloning, no
  store writes beyond transient preview state.
- One immutable batch + one durable commit per gesture (O(n) clone confined to
  the commit, as documented in P22-A).
- Overlay updates are cheap transient-state re-renders; handles are hidden
  when geometry is not durable (regular sections).

## 10. Known limitations

- Regular (non-custom-block) sections show the selection box + quick actions,
  but move/resize/rotate/nudge do not persist (geometry folds back only for
  custom-block sections) — resolved by the element renderer + tree
  persistence (P22-C/D).
- Multi-selection/marquee are engine- and store-ready but not surfaced in the
  section-level UI (single-select today); the element renderer surface will
  enable them.
- One-step `forward`/`backward` on **adjacent** multi-selections preserves
  relative order but does not advance the group as a unit.
- Snap targets use the visible viewport edges of the scroll container.

## 11. P22-C candidates (ONLY)

- Universal properties/inspector panel (typography, colors, spacing, layout)
  operating on element style tokens — P22-C.
- Element renderer + durable tree persistence for regular sections (makes
  geometry durable everywhere and activates marquee/multi-select).
- Universal inspector UI, not the full Canva shell (that is P22-K).

---

**P22-B complete. P22-C not started.**
