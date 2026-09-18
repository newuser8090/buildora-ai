# Phase P25 — Universal Canvas Tree Rendering & WYSIWYG Parity

**Type:** Formal specification (design record, written before implementation).
**Anchored on:** `docs/phase-p24c-report.md` (commit `60dac60`) + `PROJECT_FULL_CONTEXT.md` + checkpoint `d9ddb42` — *feat: implement durable universal element trees (P24-B)*.
**Branch:** `phase-p22-canva-elements`.
**Status:** `SPECIFICATION — awaiting review`. Nothing in this document is implemented.
**Provenance:** Every constraint, symbol and line reference below was verified against the working tree at `60dac60`. Items that are inference rather than verified fact are explicitly marked **[inference]**.

---

## 0. Why this phase exists

P24-C closed the *distribution* half of the durable-tree story: a regular section whose durable
`section.tree` enables custom code is now emitted through the sandboxed tree runtime, and the universal
element inspector reaches any durable section. It deliberately did **not** touch the canvas. That
asymmetry is recorded as follow-up #7 of the phase report, verbatim:

> **Canvas/export asymmetry for durable regular sections** *(new, exposed by Slice 3)* — the export renders a
> durable section's **tree** when it enables custom code, while the editor canvas still renders the
> **props-driven** component for regular sections (only `custom-block` renders a tree). Consequence: a user
> can author custom code on, say, a hero element but cannot see it (or its inert placeholder) in the canvas,
> and WYSIWYG parity for that case is untested end-to-end. A canvas tree-rendering path for durable regular
> sections is the natural follow-up.
> — `docs/phase-p24c-report.md` §8, item 7

P24-C's own spec left the corresponding rendering question open (its §10 Q3/Q4 were resolved *by choosing
the narrow option*: reuse the export runtime, scope emission to trees that enable custom code). P25 is the
phase that pays that debt: **the canvas becomes tree-aware, so what a user authors is what they see, and
what they see is what ships.**

**Naming note (honest derivation):** no roadmap document in this repository defines a "P25". The only
forward-looking statements anywhere are the P23 deferrals that named **P24** for the durable-tree work
(`docs/phase-p23-architecture.md:255`, `docs/phase-p23-report.md:98`), which P24-B discharged. This document
is the **first** artifact to name P25, and its scope is derived from the P24-C report's follow-up #7 plus the
P22-B "handles await tree persistence" comment — not from a pre-existing plan. If the project prefers to
fold this into a P24-D, only the filename and the heading change.

---

## 1. Objective & boundaries

### 1.1 Objective (one sentence)

Make the editor canvas render a section's **durable `section.tree`** when one exists — preserving the
props-driven component path when it does not — so that the inert custom-code placeholder (and future visual
indicators) authored on **any** element of **any** section is visible on canvas, with gestures, selection and
history behaviour unchanged, and with **no** change to persistence, schemas, versions, or the sandbox.

### 1.2 In scope

| # | Scope item | Anchor |
|---|---|---|
| S1 | Canvas rendering pipeline renders the durable tree for sections that carry `section.tree`; falls back to the registered props component when absent. | `src/features/editor/renderer/SectionRenderer.tsx` (`resolveSectionComponent`), `src/features/editor/registry/register-default-sections.ts`, `src/features/blocks/render/BlockRenderer.tsx` |
| S2 | Live visual parity for custom-code **placeholders** across all section trees (not only `custom-block`). | `BlockRenderer.tsx:480-519` (`data-testid="block-custom-code-placeholder"`) |
| S3 | Gesture manipulation (`SelectionOverlay`, `CanvasManipulationLayer`) keeps working on durable sections, and does not regress for `custom-block`. | `src/features/canvas/components/CanvasManipulationLayer.tsx:209`, `src/features/canvas/components/SelectionOverlay.tsx:90-122` |
| S4 | The canvas gains a **nested-element selection producer** so the P24-C inspector routing is actually reachable at runtime. | `CanvasManipulationLayer.tsx:116-127`, `BlockRenderer.tsx:198/456-458`, `src/components/editor/RightSidebar.tsx:234-236`, `src/features/inspector/hooks/useElementInspector.ts:96-100` |
| S5 | Integration / component tests and E2E specs validating canvas visual updates and canvas-vs-export agreement. | `src/features/editor/renderer/__tests__/`, `src/features/canvas/__tests__/`, `e2e/canvas-selection.spec.ts`, `e2e/element-inspector.spec.ts`, `e2e/custom-code-authoring.spec.ts`, `e2e/custom-code-export.spec.ts` |
| S6 | Preserve every P24-B durability property and every P23 security property unchanged. | §5, §6 |

### 1.3 Out of scope (explicit non-goals)

1. **No live execution of user JavaScript or CSS on the editor canvas.** The canvas placeholder stays inert.
   No `iframe`, no `srcDoc`, no `dangerouslySetInnerHTML`, no `eval`, no `new Function` in any editor render
   path. The only in-editor execution point remains the explicit opt-in `CustomCodePreview`.
2. **No mutation of the legacy `BlockTree` inside `custom-block` sections.** `props.tree`,
   `customBlockTreeFromSection` and the whole-tree fold keep their current behaviour byte-for-byte.
3. **No change to `formatVersion`, `DATABASE_VERSION`, or persistence schemas.**
   `CURRENT_FORMAT_VERSION = 3` (`src/features/persistence/constants.ts:21`) and `DATABASE_VERSION = 9`
   (`:101`) are frozen. No new durable field, no migration, no new store.
4. **No change to the sandbox capability model** (`allow-scripts` only), the CSP, the message protocol, the
   capsule caps (20,000 per field / 48,000 aggregate / 16 attributes), or the generated `CustomCodeFrame`.
5. **No new visual-indicator chrome.** P25 makes the *existing* placeholder reachable; it does not design a
   richer authoring affordance (badge, icon set, hover card, header chip). "Future visual indicators" is
   explicitly a later concern.
6. **No per-element transform handles** unless OQ-4 is resolved to include them. See D6.
7. **No export-side change.** `projectSectionTreeForExport` and `page-generator.ts` are frozen inputs to this
   phase, not targets.

---

## 2. Verified current state — the canvas/export asymmetry, precisely

This section is the phase's factual base. Every claim was read from the tree at `60dac60`.

### 2.1 The two render paths today

| Path | Activation | Component | Evidence |
|---|---|---|---|
| Props-driven (7 types) | always, for `header`/`hero`/`features`/`pricing`/`faq`/`cta`/`footer` | `HeaderSection`, `HeroSection`, `FeaturesSection`, `PricingSection`, `FaqSection`, `CtaSection`, `FooterSection` | `src/features/editor/registry/register-default-sections.ts` |
| Tree-driven (1 type) | always, for `custom-block` | `CustomBlockSection` → `BlockRenderer` | `src/features/editor/sections/CustomBlockSection.tsx:92-116` |

`resolveSectionComponent(section)` (`SectionRenderer.tsx:49-68`) resolves `sectionRegistry.get(section.type)`
and `createElement(Component, { section })`. **No component inspects `section.tree`.** Verified: grep for
`tree|customCode` in `HeroSection.tsx` returns nothing, and the props components receive the section object
whole but read only `props`/`styles`.

### 2.2 Where the asymmetry bites

- Authoring works: P24-C Slice 1 made `elementSupportsCustomCode(type)` a renderable-type predicate, so the
  Custom Code group is produced for any renderable element (`src/features/elements/inspector/schemas.ts:75`).
- Persistence works: `prepareSectionTreeCommit` (`editor-store.ts:530-585`) normalizes the incoming tree and
  writes it to `section.tree` for **regular** sections (folding props to stay in sync); `custom-block` keeps
  its existing fold path.
- Export works: `page-generator.ts` resolves a durable section to the tree runtime when its tree enables
  custom code.
- **Rendering does not.** A durable hero renders `<HeroSection>` → the bespoke props layout → the authored
  custom code (and its placeholder) is invisible, and its absence from the canvas is untested end-to-end.

### 2.3 Findings that shape the design (all verified)

**F1 — The nested-element selection signal has no producer.** `useCanvasInteractionStore.selection.ids` has
exactly two production writers, and both write **section ids**: the section-sync effect
(`CanvasManipulationLayer.tsx:122`) writes `[selectedSectionId]`, and marquee hit-testing
(`useCanvasManipulation.ts:226-244`) iterates `contextRef.current.rects()`, which is `measureRects()`
(`CanvasManipulationLayer.tsx:92-113`) — and that only measures `[data-section-id]` section nodes.
`toggleSelect` / `addToSelection` have **zero** production callers. Consequently
`singleNestedSelectionId(tree, ids)` — the predicate both `RightSidebar`'s routing
(`RightSidebar.tsx:235`) and `useElementInspector`'s targeting (`useElementInspector.ts:96-100`) depend on —
**always resolves `null` in the running app.** P24-C Slice 2's inspector routing is currently exercised only
by tests that set the transient store directly. P25 must supply the producer (S4 / D3).

**F2 — The render decision point is `SectionRenderer`, not `Canvas.tsx`.** `SectionRenderer` has exactly one
caller, `Canvas.tsx:373`. Everything else that renders a tree (`MyBlockPreview`,
`my-block-thumbnail-renderer`, `ImportVisualPreview`, the code-review step) calls `BlockRenderer` directly
with its own tree and never routes through `SectionRenderer`. So the switch is contained: no thumbnail, share
or import-preview path can be affected by S1.

**F3 — The manipulation overlay is section-scoped.** `CanvasManipulationLayer` selects one section, measures
one rect, and renders one `SelectionOverlay` whose `elementId` is `section.id`. Its `manipulable` prop is
`isCustomBlock && selectionIds.includes(section.id)` (`:209`). Because F1 makes
`selectionIds === [section.id]` always true in practice, that gate reduces to `isCustomBlock`. The P22-B
header comment (`:19-22`) states the precondition for widening it: *"Handles are rendered only for
custom-block sections, whose element trees persist geometry durably. … their geometry gains a durable home
when the element renderer + tree persistence land (P22-C/D)."* **P24-B landed that durable home**, so the
stated precondition is now satisfied and the comment is obsolete.

**F4 — Two existing tree projections are unusable on canvas.**
- `elementTreeToBlockTree()` (`section-element-adapter.ts`) deep-strips `ELEMENT_ONLY_NODE_KEYS` =
  `geometry`, `viewport`, `animation`, `interaction`, `binding`, `a11y`, **`customCode`** (`:34-42`). Running
  the canvas tree through it would delete the exact payload this phase exists to surface — the same trap
  P24-C recorded as REQ-6 for export.
- `projectSectionTreeForExport()` (`src/features/export/generators/section-tree-export.ts`) is deliberately
  **flag-only** (`customCode: { enabled: true }`, no code text, no `geometry`/`binding`/`a11y`) for the
  distribution boundary. It is a lossy projection by design and must not be reused for rendering.

**F5 — The durable commit path already exists; P25 needs no new one.** `CanvasManipulationLayer`'s `commit`
(`:159-165`) calls `commitElementTree(activePage.id, section.id, nextTree)`, and
`prepareSectionTreeCommit` performs normalization, fold, no-op detection and a single `withHistory` entry.
`useElementInspector`'s `applyToFreshest` re-resolves the target against the freshest tree at commit time.
Nothing about S1–S4 requires touching this.

**F6 — The inert placeholder already exists and needs no new component.**
`BlockRenderer.tsx:488` checks `(node as ElementNode).customCode?.enabled === true` and returns a
`data-testid="block-custom-code-placeholder"` div titled *"Custom code runs only in the published site"*,
with the block's own styles keeping it sized like the real node. It renders wherever a `BlockTree` is
rendered — so once D1's switch is in place, durable sections get it for free.

### 2.4 Canvas vs export activation table (today)

| Section | `section.tree` | custom code enabled | Canvas today | Export today |
|---|---|---|---|---|
| `custom-block` | n/a (`props.tree`) | yes | tree + inert placeholder | sandboxed tree runtime |
| regular | absent (never edited) | no | props component | props component (byte-identical) |
| regular | present | no | **props component** | props component (byte-identical) |
| regular | present | **yes** | **props component (invisible code)** | **sandboxed tree runtime** |

Row 4 is the defect P25 removes.

---

## 3. Design decisions

### D1 — The render switch is additive, predicate-based, and carries an explicit fidelity obligation

The switch predicate is the canonical helper `sectionHasDurableTree(section)`
(`section-element-adapter.ts:169`) — the **same** predicate P24-C Slice 2 uses for inspector routing, so
routing, rendering and targeting cannot drift:

```
sectionHasDurableTree(section) === true   → tree path  (BlockRenderer)
sectionHasDurableTree(section) === false  → legacy path (registered props component, unchanged)
```

**The obligation that makes this non-trivial:** `prepareSectionTreeCommit` materializes a durable tree on
the *first* element edit of any regular section, and `selection`/geometry edits are exactly what P24-B and
P22-B made routine. So the predicate is not "a rare imported design" — it becomes true for most sections a
user has touched. The tree render must therefore be **visually equivalent to the props render** for trees
materialized from props, or the phase contradicts its own objective.

Requirements that follow:
- R-1a: a per-section-type visual parity test must exist before a type is switched on (REQ-7).
- R-1b: a section type that cannot satisfy that obligation must be **explicitly excluded** by a documented,
  testable allow-list — never silently regressed.
- R-1c: the alternative narrower activation (switch only when the tree enables custom code, mirroring export
  D4) is recorded as **OQ-1**. It keeps every other path byte-identical and still fills row 4 of §2.4, at the
  cost of leaving the canvas stale for non-custom-code tree edits.

**Decision as specified:** implement the presence predicate per the brief, with R-1a/R-1b as mandatory
guards; OQ-1 must be answered before implementation starts, because it changes what "parity" means.

### D2 — The switch lives in `SectionRenderer`; `Canvas.tsx` is not modified

Verified F2: `SectionRenderer` is the single canvas render entry and has exactly one caller. Place the switch
in `resolveSectionComponent` or in a tree-capable wrapper it resolves. `Canvas.tsx` needs **no functional
change**; it stays in the touched-file list only if the implementation chooses to place the switch there.
Frozen by this decision: the `editor-root` / `preview-frame` / `preview-content` / `data-preview-root`
test-ids, the `themeToCSSVars` wrapper, `AnimatePresence` generation overlay, and the
`[data-section-id]` measurement contract.

### D3 — The canvas must gain a nested-element selection producer (the phase's load-bearing fix)

Per F1, P24-C's element routing is unreachable at runtime. P25 wires it:

- `BlockRenderer.onSelectBlock` (already emitted on click — `BlockRenderer.tsx:456-458`) must, for a durable
  non-`custom-block` section, write a **nested element** canvas selection:
  `setSelection([elementId], { multi: false, anchorId: elementId })`.
- **Precedence conflict to resolve:** the section-sync effect (`CanvasManipulationLayer.tsx:116-127`)
  unconditionally writes `[selectedSectionId]` whenever `selectedSectionId` changes. Naively adding element
  writes makes the two fight. Rule: **the sync effect writes the section-root selection only when no element
  of the current section is selected**; an explicit element focus always wins until cleared.
- `custom-block` keeps `selectBlock(nodeId)` (build-tree selection) **and** its existing
  `selectSection(rootId)` call (`CustomBlockSection.tsx:100-108`). Whether the canvas element-selection write
  is also applied there is OQ-6; the safe default is to apply the same rule to both so element focus has one
  meaning.
- The block-editor store's `selectedBlockId` remains the *build-tree* selection and stays `useElementInspector`'s
  second precedence tier (`useElementInspector.ts:96-100`). The canvas interaction store becomes the
  authoritative **canvas element focus** (P24-C D2), which is the tier that was dead code.
- Nested selection stays **transient** — never persisted, never history, never synchronized (REQ-9).

### D4 — Canvas renders the reconciled tree directly; no projection module, no stripping

Pass the tree produced by `sectionToElementTree(section)` — the single materialization entry, which keeps
`reconcileDurableTreeWithProps` active for bound-child content (the reconciliation invariant) — straight to
`BlockRenderer`, exactly as `CustomBlockSection` does for `props.tree` today.

Rationale (all verified): `BlockRenderer` already consumes element-only data — `node.customCode` (`:488`),
and `node.viewport` / `node.animation` / `node.interaction` via `presentTree` and `baEffective` — so no
projection is required and nothing needs to be added to the node shape. Introducing a projection would risk
re-creating the P24-C REQ-6 trap (F4) for no benefit.

If a projection *is* introduced later for typing reasons, it must be additive and must preserve all seven
`ELEMENT_ONLY_NODE_KEYS`. Directly forbidden on any canvas path: `elementTreeToBlockTree()` and
`projectSectionTreeForExport()` (REQ-6).

### D5 — Placeholder: make it reachable, do not rebuild it

Per F6 the inert placeholder is already correct and inert. P25 adds no second placeholder, no iframe, no
srcdoc, and no new indicator chrome (§1.3 item 5). The requirement is that it *renders on canvas* for a
durable non-`custom-block` section, and that it remains inert — asserted, not assumed.

### D6 — `manipulable` is re-expressed, not merely widened

`manipulable={isCustomBlock && selectionIds.includes(section.id)}` (`:209`) must become a
**durable-geometry predicate** evaluated against the selected section:

```
isCustomBlockSection(section) || sectionHasDurableTree(section)
```

Membership of `section.id` in `selection.ids` must be **dropped from the gate**, because D3 will
legitimately replace that id with a nested element id — keeping the membership clause would silently remove
transform handles from `custom-block` sections too (a P22-B regression smuggled in by a P25 change).

Scope note: the overlay remains **section-scoped** (one box for the selected section). Enabling durable
sections to *show* the existing handles is in scope; per-element handles, marquee over element rects, and
per-element overlays are **not** — they require `measureRects` to become element-aware and are recorded as
OQ-4. The P22-B comment (F3) must be updated to record that its precondition is met.

### D7 — Persistence, schemas and versions are invariant

No new durable field, no migration, no schema change, no store. P25 renders state P24-B already persists.
`CURRENT_FORMAT_VERSION = 3` and `DATABASE_VERSION = 9` stay frozen. Legacy `custom-block` keeps
`props.tree` as its authoritative tree. Custom code never executes on canvas.

### D8 — Canvas/export parity rule is explicit and tested

Canvas activates on `sectionHasDurableTree`; export activates on "durable tree **and** enabled custom code"
(P24-C D4). The asymmetry is intentional and must be **pinned by a test**, not left implicit:

- Row 4 of §2.4 — durable + enabled custom code — must be tree-rendered on **both** surfaces, so the
  placeholder a user sees corresponds to what ships. That is the case this phase exists for.
- Durable **without** custom code may remain props-rendered on export (frozen) while being tree-rendered on
  canvas (per D1). If OQ-1 resolves to the export-aligned option, this divergence disappears entirely and
  canvas becomes a strict subset of export behaviour.

---

## 4. Detailed requirements

| ID | Requirement |
|---|---|
| **REQ-1** | `SectionRenderer`'s component resolution becomes an additive predicate: durable tree → `BlockRenderer` path; no durable tree → the registered props component. No other `SectionRenderer` behaviour changes (drop zones, insertion points, inline-edit provider, ordering, visibility filter). |
| **REQ-2** | The tree path renders `sectionToElementTree(section)` through `BlockRenderer` with `viewportWidth` from the editor viewport (same map as `CustomBlockSection`: desktop 1440 / tablet 768 / mobile 390), and passes `pages`, `collections`, `records` so NavTargets and data bindings resolve in the preview exactly as they do for `custom-block`. |
| **REQ-3** | The tree path is **interactive only when the inline-edit page context is present** (`useInlineEditPageId()`), i.e. `editable` / `onSelectBlock` / `onEditText` are undefined without a `pageId`. Thumbnail, share-preview and import-preview renders must stay inert, matching `CustomBlockSection`'s `interactive = !!pageId` rule. |
| **REQ-4** | `onSelectBlock` on a durable section sets the nested canvas element selection (D3), and the section-sync effect yields to an active element focus. |
| **REQ-5** | `SelectionOverlay.manipulable` is re-expressed as a durable-geometry predicate (D6); `custom-block` handle availability is unchanged by the rewrite. |
| **REQ-6** | **Anti-regression:** no canvas path may route a durable `ElementTree` through `elementTreeToBlockTree()`, and no canvas path may reuse the export flag-only projection `projectSectionTreeForExport()`. Both halves are asserted. |
| **REQ-7** | **Legacy parity:** a section without a durable tree renders byte-identically to today. A durable section must satisfy the D1 fidelity obligation for its type, or be excluded via the documented allow-list. |
| **REQ-8** | Frozen DOM/measurement contract: `data-section-id` on the section wrapper, `data-preview-root` / `preview-content` / `preview-frame` / `editor-root` test-ids, the `section-wrapper` and `selected-section` test-ids, and the `measureRects()` `[data-section-id]` query must all keep working unchanged. |
| **REQ-9** | **No new durable state.** Focusing an element leaves the project at the identical object reference, leaves `history.past.length` unchanged, and produces a byte-identical `serializeProject()` payload. The editor store gains no `selection` / `anchorId` / `selectedElementId` key. |
| **REQ-10** | **Single manipulation boundary.** Every gesture keeps committing through `commitElementTree` → `prepareSectionTreeCommit` → exactly ONE `withHistory` entry. Undo/redo and collab behave as they do for every other durable edit. No new commit path is introduced. |
| **REQ-11** | No schema, migration, `formatVersion`, `DATABASE_VERSION`, cap or sandbox change (D7, §1.3). |
| **REQ-12** | **Graceful degradation:** an absent, empty (`rootIds.length === 0`), corrupt or unnormalizable tree, and an unknown/unregistered section type, must fall back without throwing — the existing `ErrorBoundary` in `ValidatedSectionRenderer` must remain the last line of defence, and the P24-B "drop if unrepairable" normalizer semantics are unchanged. |

---

## 5. Invariants (must hold at every commit in this phase)

| Invariant | Why it must hold |
|---|---|
| **Additive rendering** | Presence of `section.tree` selects the tree path; its absence selects the legacy path. No third state, no partial rendering. |
| **Single materialization entry** | `sectionToElementTree(section)` stays the only way a section becomes a tree, so `reconcileDurableTreeWithProps` stays active and inline-edit / inspector / AI prop edits can never be silently reverted by a later tree commit. |
| **Single commit boundary** | One gesture → one `withHistory` entry, via `prepareSectionTreeCommit`. |
| **Inertness** | The editor canvas contains no executable user code in any render path, at any time. |
| **Transient selection** | Element focus is UI state only; it never enters the project, history, persistence, or CRDT. |
| **Legacy `custom-block` frozen** | `props.tree`, `customBlockTreeFromSection` and the whole-tree fold are untouched. |
| **Versions frozen** | `formatVersion: 3`, `DATABASE_VERSION = 9`, no new field, no migration. |
| **Caps & sandbox frozen** | 20,000 / 48,000 / 16 unchanged; `allow-scripts` only. |
| **Shared predicate** | Rendering, inspector routing and inspector targeting all consult `sectionHasDurableTree` / `singleNestedSelectionId` — never a private re-implementation. |

---

## 6. Validation & verification strategy

### 6.1 Targeted unit / component tests (Vitest, `testTimeout: 10_000`)

| Suite | What it must pin |
|---|---|
| `src/features/editor/renderer/__tests__/` **[new]** | Durable section → tree path; legacy section → registered props component; unknown type → fallback; empty tree → fallback; absent `pageId` → inert (no `onSelectBlock`/`editable`); props component never receives a tree it cannot read. |
| `src/features/canvas/__tests__/canvas-selection.test.ts` | `singleNestedSelectionId` unchanged; plus the new **producer** behaviour and the sync-effect precedence rule (D3). |
| `src/features/canvas/__tests__/` (manipulation layer) **[new or extended]** | `manipulable` true for `custom-block` and for durable non-`custom-block`; **unchanged** for legacy non-durable; dropping the `selectionIds.includes(section.id)` clause does not remove handles when a nested element is focused. |
| `src/features/blocks/render/__tests__/BlockRenderer-custom-code.test.tsx` | The placeholder renders for an enabled node and is inert; disabled/none renders as before. Extend to cover a **non-`custom-block`** durable section's tree. |
| `src/components/editor/__tests__/RightSidebar.test.tsx` | Existing 11 routing tests keep passing; add the case where the nested selection is produced by a canvas click rather than set directly, if feasible at component level. |
| Existing `src/features/elements/__tests__/section-element-durable.test.ts` | Reconciliation (`reconcileDurableTreeWithProps`) and `sectionHasDurableTree` behaviour unchanged. |
| Existing export suites | Byte-identical assertion for a durable section **without** custom code must keep passing (§2.4 row 3 export column). |

### 6.2 E2E (Playwright, chromium, `--workers=1`, deterministic helpers — no arbitrary sleeps)

| Spec | Coverage to add |
|---|---|
| `e2e/canvas-selection.spec.ts` | Selection box / dims / Escape / duplicate / delete still work on a **durable** section; handles present (S3). |
| `e2e/element-inspector.spec.ts` | Selecting an element inside a durable `hero`/`features` section routes to the universal inspector (the path that is dead today, F1). |
| `e2e/custom-code-authoring.spec.ts` | Authoring on a non-`custom-block` section: the placeholder becomes visible **on canvas**, stays inert, and no console error is emitted. |
| *new or extended* | Canvas-vs-export agreement for the row-4 case: the placeholder is visible on canvas **and** the exported page emits the sandboxed frame (D8). |

### 6.3 Required gate order (sequential, never concurrent)

```
npm run typecheck   →   npm run lint   →   npm test   →   npm run build   →   npm run test:e2e
```

`npm run test:export-build` should be run as well even though the export pipeline is frozen by §1.3, because
the canvas path must not perturb `dist`-level output; a green baseline is a required evidence artefact for
the phase report, not a changed artifact.

### 6.4 Known hazards to plan around (documented at P24-B/P24-C — not introduced here)

1. **`boundedErrorToken` artifact failure** — `npm run typecheck` / `next build` can fail via the gitignored
   `.next/dev/types/app/api/generate/route.ts` after an E2E run regenerates it. Clean the artifact or use the
   source-only config (`.p24b-tsconfig.json`) for the evidence run, and record which was used.
2. **Cold-cache `test:export-build`** — passes in ~42 s warm but has timed out once (>600 s) cold.
   `--prefer-offline` / cache warm-up is the known mitigation.
3. **Pre-existing ESLint warning** — `e2e/ai-element-editing.spec.ts:310` (`reviewAndApply` unused). Not
   fixed by this phase.
4. **Untracked E2E specs** — `e2e/custom-code-authoring.spec.ts` and `e2e/custom-code-export.spec.ts` exist
   on disk but are **untracked** in this repository. The phase's most relevant E2E coverage is therefore not
   in version control; decide (OQ-5) before relying on it as the phase baseline.
5. **Pre-existing E2E flake families** — `realtime-structure` and `workspace-version-history` are known
   environmental failures; the AI-copilot shortcut test is a known load/timing flake that passes in
   isolation. Classify any failure explicitly rather than silently excluding it.

---

## 7. Risks & mitigations

| # | Risk | Mitigation |
|---|---|---|
| R1 | **Visual regression on bespoke sections (highest).** The materialized tree is a container plus bound text children; a bespoke two-column hero or pricing grid rendered through `BlockRenderer` will not reproduce the props component's layout. Because D1's predicate becomes true after any element edit, this can regress sections that were previously fine. | D1's fidelity obligation + REQ-7's per-type parity test + a documented exclusion allow-list. Strongly consider OQ-1's narrower activation. |
| R2 | **Selection fight.** The section-sync effect keeps overwriting element focus, making element selection impossible to hold. | D3's explicit precedence rule + a dedicated test. |
| R3 | **Handles silently disappear for `custom-block`.** Keeping `selectionIds.includes(section.id)` in the `manipulable` gate while D3 replaces that id removes handles from the one section type that has them today. | D6's re-expression + the regression test in §6.1. |
| R4 | **Render cost.** Tree rendering for every durable section replaces seven lean bespoke components with one generic tree walker, and `presentTree` runs per tree. | Measure on a many-section page; prefer the OQ-1 activation if the delta is material. |
| R5 | **Stale/incorrect comments become load-bearing.** The P22-B header comment states handles await tree persistence — no longer true, and it will mislead the implementer. | Update the comment as part of D6 (documentation-only change, no behaviour). |
| R6 | **Re-creating the P24-C REQ-6 trap.** A future contributor "simplifies" the canvas by projecting through `elementTreeToBlockTree()`, silently deleting `customCode`/`viewport`/`animation`/`interaction`. | REQ-6's two-sided assertion, mirroring the export-side test that already exists. |
| R7 | **Dead-code removal mistaken for cleanup.** Someone may delete the `singleNestedSelectionId` tier as "unused" because F1 makes it unreachable — precisely backwards. | REQ-4 wires the producer; the invariant that routing and targeting share one predicate is stated in §5. |
| R8 | **Scope creep into per-element manipulation.** "Gesture manipulation on elements within durable trees" can be read as per-element handles, which needs an element-aware `measureRects`. | OQ-4 draws the line explicitly; §1.3 item 6 keeps it out until answered. |

---

## 8. Likely implementation areas **[inference — file-level surface, not a committed diff plan]**

| Area | File | Expected nature of change |
|---|---|---|
| Render switch | `src/features/editor/renderer/SectionRenderer.tsx` | Additive predicate in `resolveSectionComponent` (or a tree-capable wrapper). |
| Tree render path | new wrapper under `src/features/editor/sections/` **[inference on exact path/name]** | Section + `sectionToElementTree` + `BlockRenderer`, mirroring `CustomBlockSection` but reading `section.tree` and not gating on `custom-block`. |
| Element focus producer | `src/features/canvas/components/CanvasManipulationLayer.tsx`, `src/features/editor/sections/CustomBlockSection.tsx` | Nested-element selection write + sync-effect precedence + `manipulable` re-expression + obsolete comment update. |
| Selection helper | `src/features/canvas/engine/selection.ts` | Only if a shared rule is needed (e.g. "does this selection target an element of this section"); existing helpers unchanged. |
| Renderer integration | `src/features/blocks/render/BlockRenderer.tsx` | Likely **no change** (it already reads `customCode`/`viewport`/`animation`/`interaction`). Confirm props cover `pages`/`collections`/`records` from the canvas. |
| Adapter | `src/features/elements/adapters/section-element-adapter.ts` | **No change expected** — `sectionToElementTree` / `sectionHasDurableTree` / `reconcileDurableTreeWithProps` are consumed as-is. |
| Canvas host | `src/components/editor/Canvas.tsx` | **No change expected** (D2). Listed because the brief names it. |
| Tests | `src/features/editor/renderer/__tests__/`, `src/features/canvas/__tests__/`, `src/features/blocks/render/__tests__/`, `src/components/editor/__tests__/` | New/extended suites per §6.1. |
| E2E | `e2e/canvas-selection.spec.ts`, `e2e/element-inspector.spec.ts` (+ the untracked custom-code specs) | Per §6.2. |

**Correction to the brief's file list:** `src/features/editor/components/` exists but does **not** contain a
`SectionRenderer`; the real path is `src/features/editor/renderer/SectionRenderer.tsx`. `BlockRenderer` is at
`src/features/blocks/render/BlockRenderer.tsx`. Both are reflected above.

---

## 9. Acceptance criteria (phase exit)

1. A section carrying `section.tree` with an element whose custom code is enabled **shows the inert
   `block-custom-code-placeholder` on the editor canvas**, for a non-`custom-block` type (e.g. `hero`).
2. The placeholder is inert: no iframe, no srcdoc, no `dangerouslySetInnerHTML`, no `eval`/`new Function` in
   the rendered output, and no console error.
3. A section **without** a durable tree renders through its registered props component, with output
   byte-identical to the pre-phase baseline.
4. Selecting an element inside a durable non-`custom-block` section on canvas routes the right sidebar to
   `ElementInspectorPanel` **and** targets that element (not the section root) — the path that is dead today.
5. Transform handles appear for a durable section, and `custom-block` handle availability is unchanged.
6. Moving/resizing a durable section commits **one** history entry; undo restores the previous state
   exactly; `serializeProject()` is unaffected by selection changes.
7. Canvas and export agree for the durable + enabled-custom-code case: the placeholder is on canvas and the
   sandboxed frame is in the export.
8. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` and the phase-relevant Playwright specs
   are green, with any excluded failure classified and documented.

---

## 10. Open questions (require review/decision before implementation)

| # | Question | Why it matters |
|---|---|---|
| **OQ-1** | **Activation scope.** Presence-only (`sectionHasDurableTree`) per the brief, or export-aligned (durable **and** enabled custom code)? | Changes whether any visual regression is *possible* at all. Presence-only is what the brief says; export-aligned keeps every other path byte-identical and still fixes §2.4 row 4. **Recommendation:** if the honest answer to R1 is "bespoke sections cannot round-trip", start export-aligned and widen type-by-type behind the R-1a parity tests. |
| **OQ-2** | For a bespoke section that cannot round-trip, what is the excluded fallback — stay on the props component (placeholder invisible) or render the tree (layout changes)? | Determines whether the phase's headline objective is universally met or type-scoped. |
| **OQ-3** | Does the phase also broaden the element-scoped AI entry? P24-C follow-up #8 records that `useElementEditTarget` / `resolveElementEditTarget` still reject non-`custom-block` sections. | Adjacent, cheap to include, and would otherwise be a second "authorable but not surfaced" asymmetry. Currently out of scope. |
| **OQ-4** | Does "gesture manipulation on elements within durable trees" mean the existing **section-scoped** overlay (D6), or per-element handles/overlays? | The latter requires an element-aware `measureRects` and is a materially larger phase. |
| **OQ-5** | Are `e2e/custom-code-authoring.spec.ts` and `e2e/custom-code-export.spec.ts` committed as part of this phase (or separately), given they are the phase's most relevant E2E coverage and are currently untracked? | Determines whether the acceptance evidence is reproducible from a clean clone. |
| **OQ-6** | Should the nested-element selection write also apply to `custom-block` (unifying element focus), or should `custom-block` keep only the block-editor store selection? | Affects R3 and whether F1's two-selection-system split is finally unified. |
| **OQ-7** | Root container semantics. Per the P24-C note, a materialized regular section's tree **root** is an element-only `container` carrying the section markers — not a renderable section type. Confirm the tree path renders that root container (as `custom-block` does) rather than trying to resolve it as a section type. | A wrong assumption here breaks every durable section at once. |

---

## 11. Deliverables

1. `docs/phase-p25-spec.md` — this document.
2. Implementation slices with their own commits, at minimum: **Slice 1** render switch + tree path (S1, S2);
   **Slice 2** element-focus producer + manipulation-gate re-expression (S3, S4); **Slice 3** tests and E2E
   (S5).
3. `docs/phase-p25-report.md` — outcome, verified changes per slice, invariant confirmations with evidence,
   gate results table, flake classification, and recorded follow-ups.
4. Answers to OQ-1 … OQ-7, recorded in the report even when resolved by implementation.

---

## 12. STOP

This document specifies only. It modifies no source file, no test, and no schema; it changes no version
constant and no sandbox property. Implementation must not begin until OQ-1 (activation scope) and OQ-4
(manipulation scope) are answered, because together they define what this phase actually ships.
