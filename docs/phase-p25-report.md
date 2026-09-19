# Phase P25 — Universal Canvas Tree Rendering & WYSIWYG Parity (cumulative closeout report)

Branch: `phase-p22-canva-elements`
Specification: `docs/phase-p25-spec.md` (commit `aa81ca6`)
Status date: 2026-09-20
Scope of this report: **validation / closeout of the P25 implementation.** No product behaviour was
redesigned during closeout. Two implementation changes were made during validation, both required by the
gate evidence:

1. an artifact cleanup (`rm -rf .next`) so the default typecheck ran against source rather than a stale
   gitignored Next artifact (§5, §6);
2. an `OQ-6` scoping correction to the nested-element producer, because applying the write to legacy
   `custom-block` sections regressed a committed P22-C canvas-selection contract (§2.4, §6, §7).

Commits in this phase:

| Commit | What |
| --- | --- |
| `aa81ca6` | `docs: add Phase P25 specification for universal canvas tree rendering` |
| `40ea0f5` | `feat(renderer): render durable section trees with custom code via BlockRenderer (P25 Slice 1)` |
| `5065c83` | `feat(canvas): implement nested element selection and sync precedence (P25 Slice 2)` |
| `604ef98` | `feat(canvas): target selection overlay handles to nested element geometry (P25 Slice 3)` |
| `f9cb315` | `fix(canvas): scope nested element focus to durable tree sections (P25 closeout)` |
| *(this closeout)* | `docs: close out Phase P25 universal canvas tree rendering and wysiwyg parity` |

---

## 1. Outcome

**P25 is COMPLETE.** A regular section that carries a Phase-P24-B durable `section.tree` whose custom code
the export would emit now renders through the block runtime on the editor canvas, so the inert custom-code
placeholder (and every element the tree authoring surface touches) is visible **where the user authors it and
where it ships**. The canvas also gained the nested-element selection producer that P24-C's universal
inspector routing depended on but could never reach at runtime (spec §2.3 F1), together with the sync
precedence that stops the section-root mirror from clobbering an element focus, and per-element bounding-box
/ transform-handle targeting.

The P24-C deferral this phase discharges, verbatim from `docs/phase-p24c-report.md` §8 item 7:

> **Canvas/export asymmetry for durable regular sections** *(new, exposed by Slice 3)* — the export renders a
> durable section's **tree** when it enables custom code, while the editor canvas still renders the
> **props-driven** component for regular sections (only `custom-block` renders a tree). … A canvas
> tree-rendering path for durable regular sections is the natural follow-up.

Nothing in this phase changed persistence, schemas, versions, the sandbox, the message protocol or the caps
(spec §1.3, D7). The legacy `custom-block` tree pipeline and its canvas selection contract are unchanged.

---

## 2. Verified changes

### 2.1 Slice 1 — render switch + tree path (`40ea0f5`)

| Area | Change |
| --- | --- |
| Dispatch | `SectionRenderer.resolveSectionComponent` is additive: `type !== "custom-block" && durableTreeEnablesCustomCode(section)` → `DurableTreeSection`; everything else → the registered component (`hero`, `features`, …, `CustomBlockSection`). |
| Predicate | The switch consults `durableTreeEnablesCustomCode` — the SAME emission gate the export pipeline uses (`customCodeIsEmittable`), resolving OQ-1 **export-aligned**. Presence-only activation was rejected (see §7). |
| Tree path | New `src/features/editor/sections/DurableTreeSection.tsx`: `sectionToElementTree(section)` → `BlockRenderer` with the same viewport map as `CustomBlockSection` (desktop 1440 / tablet 768 / mobile 390) and the project `pages` / `collections` / `records`. |
| Anti-regression (REQ-6) | No canvas path routes a durable tree through `elementTreeToBlockTree()` (which deep-strips `customCode`/`viewport`/`animation`/`interaction`) or through the flag-only `projectSectionTreeForExport()`. Both are asserted. |
| Legacy parity | A section without a durable tree, and a durable section **without** emittable custom code, keep their bespoke props component byte-for-byte. |

Evidence: `src/features/editor/renderer/__tests__/SectionRenderer.test.tsx` (10 tests) — tree path for
emittable custom code, props path for legacy / durable-without-code / disabled / over-cap payloads, inert
placeholder (`data-testid="block-custom-code-placeholder"`) with no iframe/srcdoc/`<script>`/code text, the
frozen `data-section-id` + `section-wrapper` DOM contract, `custom-block` unchanged, and the D8 canvas/export
agreement (`rendersTree === (buildSrcdocsForTreeRecord(tree) !== null)`).

### 2.2 Slice 2 — element-focus producer + sync precedence (`5065c83`)

| Area | Change |
| --- | --- |
| Producer (F1/S4) | `CanvasManipulationLayer` listens for `pointerdown` on the preview content and focuses the hit element node (`data-element-id` / `data-block-id`): a NESTED node of the owning section's tree → `setSelection([elementId], { anchorId: elementId })`, selecting the owning section when it was not active. The manipulation overlay's own chrome is excluded so handle drags never rewrite the selection they operate on. |
| Precedence (D3) | The section-sync effect yields to an active nested element focus. It re-reads the freshest store state inside its microtask, so a queued microtask from a previous section can never clobber a newer element focus. With no element focused it mirrors `[selectedSectionId]` exactly as before. |
| Gate (S3/D6) | `SelectionOverlay.manipulable` is re-expressed as a durable-geometry predicate instead of `selectionIds.includes(section.id)`, so an element focus can no longer drop `custom-block` handles (R3). |
| Transience (REQ-9) | Selection stays in the transient canvas-interaction store — never persisted, never history, never a new editor-store key. |

Evidence: `src/features/canvas/__tests__/canvas-nested-selection.test.tsx` (16 tests) — producer focus,
cross-section activation, section-root/background fallback, overlay exclusion, precedence under a project
update, section-switch re-sync, clear-on-deselect, zero durable mutation, the handle gate, and an end-to-end
canvas-click → `RightSidebar` → `ElementInspectorPanel` routing test (targeted element fields incl. the
Custom Code group).

### 2.3 Slice 3 — overlay bounding box + handle targeting (`604ef98`)

| Area | Change |
| --- | --- |
| Target | `targetId = singleNestedSelectionId(tree, selection.ids)` (fallback `anchorId`) `?? selectedSectionId`. Only genuinely nested ids of the selected section resolve. |
| Measurement | `measureRects` measures every section container (snap targets) **and**, when a nested element is focused, that element's own DOM node, keyed by the element id. The bounding box, dims chip and the 8 resize + rotation handles therefore frame the element. |
| Preview | `displayedRect` follows `previewRects[targetId]`, so live drag previews track the element (or the section root). |
| Commit | No new commit path: `buildGeometryOps` → `applyElementOpBatch` → the element engine's `updateElementGeometry` targeting the selected element id, committed through `commitElementTree` as ONE history entry. |
| Gate | `manipulable = isCustomBlock || durableTreeEnablesCustomCode(section)` — handles only on sections the canvas actually renders through `BlockRenderer` (D6, export-aligned). |

`SelectionOverlay.tsx` and `useCanvasManipulation.ts` needed **no** code change: the overlay already positions
its handles from `rect`, and the gesture hook already resolves rects by selection id — the fix was to
centralize the element-aware measurement and target in the layer.

Evidence: `src/features/canvas/__tests__/canvas-overlay-targeting.test.tsx` (4 tests, deterministic
`getBoundingClientRect` stub) — the box frames the element node (not the section), the section boundary is
restored when the nested focus clears, and a nested resize writes `node.geometry` on the durable tree with
exactly one history entry while leaving the section root untouched.

### 2.4 Closeout correction — OQ-6 scope (`f9cb315`)

Wiring the DOM producer for **all** element nodes (the OQ-6 "apply the same rule to both" default) silently
changed the committed P22-C `custom-block` canvas-selection contract: in an editable tree the text nodes are
`contentEditable` and do not emit `onSelectBlock`, so a click over them historically bubbled to the container
and kept the section root selected. With the producer active the click focused the text element instead,
which regressed three pre-existing E2E flows (`element-inspector`, `element-library`, `responsive-engine`).

Resolution: **OQ-6 answered NO.** The nested write is scoped to sections the P25 tree path renders (durable
trees) — exactly D3's literal scope ("for a durable non-`custom-block` section"). Legacy `custom-block` keeps
its build-tree selection surface and its frozen canvas click behaviour. The D6 handle gate is unchanged, so
`custom-block` handles remain available. The phase's own tests were updated to pin the resolved behaviour
(including a new "keeps the section root selected for legacy custom-block clicks" regression test).

---

## 3. Invariant verification

| Invariant | Evidence |
| --- | --- |
| **Inert custom-code canvas rendering** | `SectionRenderer.test.tsx` asserts `data-testid="block-custom-code-placeholder"` renders for a non-`custom-block` durable section and that the canvas DOM contains no `iframe`, no `srcdoc`, no `<script>`, and none of the authored code text. `BlockRenderer-custom-code.test.tsx` pins the placeholder for the `custom-block` path. No canvas render path evaluates user code. |
| **Zero durable state from transient selection (REQ-9)** | `canvas-nested-selection.test.tsx` "produces zero mutations …" asserts the project object reference is unchanged, `history.past.length` is unchanged, and `serializeProject()` is byte-identical after focusing an element; it also asserts the editor store gained no `selection` / `anchorId` / `selectedElementId` key. `RightSidebar.test.tsx` re-asserts the same for the routing path. |
| **One history entry per transform gesture (REQ-10)** | `canvas-overlay-targeting.test.tsx` asserts `history.past.length` increases by exactly 1 for a nested resize and that the section root's geometry is untouched. No new commit path was introduced — every gesture still commits via `commitElementTree` → `prepareSectionTreeCommit` → one `withHistory` entry. |
| **Single materialization entry** | `sectionToElementTree` is the only section→tree entry, used by `SectionRenderer`/`DurableTreeSection` and `CanvasManipulationLayer`; `reconcileDurableTreeWithProps` stays active. |
| **Legacy `custom-block` frozen** | Slice 1 routes `custom-block` to its registered component; the producer excludes it (§2.4); `props.tree`, `customBlockTreeFromSection` and the whole-tree fold are untouched. `element-inspector` / `element-library` / `responsive-engine` E2E are green. |
| **Versions / caps / sandbox frozen** | No change to `CURRENT_FORMAT_VERSION` (3), `DATABASE_VERSION` (9), any schema, migration, cap or the `allow-scripts` sandbox in this phase. `npm run build` and `npm run test:export-build` remain green. |
| **Canvas/export parity (D8)** | Canvas activates on `durableTreeEnablesCustomCode`; export activates on the same emission gate. `SectionRenderer.test.tsx` pins `rendersTree === (buildSrcdocsForTreeRecord(tree) !== null)` case-by-case. |

---

## 4. Gate results

All gates ran clean-context: `rm -rf .next` was executed before the sequence, and no gitignored Next artifact
was regenerated during it.

| Gate | Command | Result |
| --- | --- | --- |
| TypeScript | `npm run typecheck` | ✅ **PASS** — `tsc --noEmit`, exit 0, no diagnostics (also re-run post-E2E: clean) |
| ESLint | `npx eslint .` | ✅ **PASS** — 0 errors, 1 pre-existing warning (`e2e/ai-element-editing.spec.ts:310`, untouched) |
| Unit / component | `npm test` | ✅ **PASS** — **377 files / 5,263 tests** |
| Production build | `npm run build` | ✅ **PASS** — Next.js 16.2.12 (Turbopack), `✓ Compiled successfully`, `✓ Generating static pages (9/9)` |
| Export compilation | `npm run test:export-build` | ✅ **PASS** — 1 test, 51.4 s, `[BUILD TEST] ✅ Multi-page site build succeeded!` |
| E2E — phase-relevant | `npx playwright test canvas-selection element-inspector custom-code-authoring custom-code-export --workers=1` | ✅ **PASS** — 16/16 (1.6 m) |
| E2E — core suite | full core run (158 tests) | ⚠️ **157 passed / 1 failed** — the single failure is the pre-existing `workspace-version-history` environmental failure; see §5 |

**Unit suite composition note.** The phase added 30 tests: `SectionRenderer.test.tsx` (10),
`canvas-nested-selection.test.tsx` (16), `canvas-overlay-targeting.test.tsx` (4). The canvas feature area
alone is 7 files / 105 tests.

**E2E execution note.** The full core suite (`--grep-invert "[Pp]rompt|[Ff]allback"`, 158 tests, 65 spec
files) exceeds a single 10-minute command window under `--workers=1`, so it was executed as four disjoint
file batches (51 + 64 + 21 + 22 = 158), preserving per-file ordering within every batch. The union is the
complete core suite; no test was skipped or omitted. `realtime-structure.spec.ts` passed in this run.

---

## 5. Failures, flakes and their classification

| # | Symptom | Evidence | Classification |
| --- | --- | --- | --- |
| 1 | `e2e/workspace-version-history.spec.ts:52` — after restoring v2, the editor's inspector shows `"Versioned edit two"` instead of `"Versioned edit one"` | Deterministic: fails both in the batched run and **in isolation** (`--workers=1`, fresh dev server). The assertion reads the workspace-version restore path (server snapshot → reload → re-hydrate); P25 changed only `SectionRenderer` dispatch, `DurableTreeSection`, `CanvasManipulationLayer` and `SelectionOverlay` targeting — zero files under persistence, workspace, versioning or app routes. Documented before P25 in `docs/phase-p24c-report.md` §7 item 3 ("post-restore reload race") and excluded from P24-C's core run for the same reason; spec §6.4 hazard 5 names it. | **Pre-existing environmental failure — not a P25 regression** |
| 2 | `npm run typecheck` failing on `.next/dev/types/app/api/generate/route.ts` (`boundedErrorToken`) | **Did not reproduce this run.** `.next` was removed before the gates; no dev artifact was regenerated by the E2E batches; the post-E2E typecheck is clean. | **Pre-existing artifact hazard — dormant, not triggered** |
| 3 | `realtime-structure.spec.ts` (mock checkpoint `STALE_REVISION` race) | **Passed** in this run's batch C. Documented pre-existing flake family (P24-C report §8 item 2). | **Pre-existing flake family — green this run** |
| 4 | ESLint warning `e2e/ai-element-editing.spec.ts:310` (`reviewAndApply` unused) | Unchanged, untouched by P25. | **Pre-existing warning** |

No deterministic P25 product regression remains after the `f9cb315` scoping correction.

---

## 6. Open questions resolved

| # | Question | Resolution |
| --- | --- | --- |
| **OQ-1** | Activation scope: presence-only vs export-aligned | **Export-aligned.** Canvas activates on `durableTreeEnablesCustomCode(section)` (§2.1), so a durable section without emittable custom code keeps its bespoke props component and no visual regression is possible. |
| **OQ-2** | Excluded fallback for a non-round-trippable bespoke section | **Stay on the props component.** The tree path is chosen by the emission predicate, not by "a tree exists", so such sections are never tree-rendered. |
| **OQ-3** | Broaden the element-scoped AI entry to non-`custom-block` sections | **Not taken** (out of scope). Recorded as a follow-up (§8). |
| **OQ-4** | Manipulation scope: section overlay vs per-element handles | **Element-targeted bounding box + the existing handles**, section-scoped when nothing is focused (Slice 3). Multi-element / marquee overlays remain out of scope. |
| **OQ-5** | Are the custom-code E2E specs committed | **Still untracked on disk**; they were executed in the phase-relevant batch and passed. Recorded as a follow-up (§8). |
| **OQ-6** | Apply the nested selection write to `custom-block` too | **No** — resolved during closeout (§2.4). The write is scoped to durable tree sections; `custom-block` keeps its build-tree/editor-store selection and frozen canvas click behaviour. |
| **OQ-7** | Root container semantics | Confirmed: the materialized root is an element-only `container` carrying the section markers; `DurableTreeSection` renders it as `custom-block` does, and `singleNestedSelectionId` treats root ids as section-level (never an element target). |

---

## 7. Recorded follow-ups (none blocking; not addressed in this phase)

1. **Commit the custom-code E2E specs** — `e2e/custom-code-authoring.spec.ts` and
   `e2e/custom-code-export.spec.ts` are untracked in this repository (OQ-5). They are the phase's most
   relevant E2E coverage; a clean clone cannot reproduce the evidence until they are committed.
2. **`workspace-version-history.spec.ts` post-restore reload race** — the editor can render the cached
   pre-restore project before the workspace fetch + re-hydration lands (§5). Pre-existing; carried forward
   from P24-B/P24-C.
3. **`realtime-structure.spec.ts` mock checkpoint `STALE_REVISION` race** — concurrent checkpoints can leave
   the mock server one revision behind; needs a bounded retry. Pre-existing; carried forward.
4. **`boundedErrorToken` / `.next/dev/types` artifact** — pre-existing default-typecheck hazard after an E2E
   run (did not trigger this run). Fix by moving the helper out of the route module or excluding
   `.next/dev/types` from `tsconfig.json`.
5. **Export-build cold-cache stability** — ~52 s warm; has timed out once (>600 s) cold. Consider
   `--prefer-offline` / cache warm-up.
6. **Pre-existing ESLint warning** in `e2e/ai-element-editing.spec.ts:310`.
7. **Element-scoped AI entry remains `custom-block`-only** — `useElementEditTarget` /
   `resolveElementEditTarget` still reject non-`custom-block` sections, so the canvas element focus now
   reachable on durable sections is not yet offered to the element-scoped AI composer (OQ-3).
8. **Multi-element / marquee overlay** — the overlay is single-target; a multi-selection falls back to the
   section container. Per-element outlines and marquee-over-element-rects remain open (OQ-4 remainder).
9. **Inline text editing on durable tree sections** — Slice 1 renders `DurableTreeSection` read-only
   (`editable` / `onEditText` undefined), so text edits on a durable tree currently flow through the
   inspector rather than direct canvas typing. Wiring `useInlineEditPageId`-gated inline editing (REQ-3) is a
   natural follow-up.
10. **Custom-code preview on durable non-`custom-block` sections** — the canvas shows the inert placeholder;
    the opt-in `CustomCodePreview` remains the only execution point (by design).

---

## 8. Final status

- **Implementation:** complete and intact across Slices 1–3, plus the closeout `OQ-6` scoping correction.
  Canvas tree dispatch, the inert custom-code placeholder, the nested-element producer, sync precedence,
  per-element overlay/handle targeting and the durable commit path are all present and green in the unit
  suite.
- **Gates green:** typecheck (clean, pre- and post-E2E), ESLint (0 errors, 1 pre-existing warning), Vitest
  **377 files / 5,263 tests**, production build (9/9 static pages), export compilation (`test:export-build`),
  phase-relevant E2E **16/16**.
- **Core E2E:** **157/158**; the single failure is the pre-existing `workspace-version-history` post-restore
  reload race, which also fails in isolation and is unrelated to every file P25 touched.
- **Spec decisions discharged:** D1 (additive predicate, OQ-1 export-aligned), D2 (`SectionRenderer` is the
  single dispatch point; `Canvas.tsx` unchanged), D3 (producer + precedence), D4 (reconciled tree rendered
  directly, no lossy projection), D5 (placeholder made reachable, not rebuilt), D6 (durable-geometry handle
  gate + element-targeted overlay), D7 (persistence/versions invariant), D8 (canvas/export parity pinned).
  Open questions OQ-1…OQ-7 are resolved in §6.
- **Security posture unchanged:** no `iframe`, `srcDoc`, `dangerouslySetInnerHTML`, `eval` or `new Function`
  on any editor render path; the sandbox and its caps are untouched.
