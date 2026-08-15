# Phase P22-D — Element Library (Report)

> Baseline: P22-A/B/C complete and validated (see their reports). This phase
> builds the first reusable Element Library on top of the P22-A element
> registry and the existing block/section insertion machinery.
> **P22-D complete. P22-E NOT started.**

---

## 1. Implementation summary

The Element Library is a polished, persistent panel where users can discover
and insert every element the builder can actually render and persist today.
It lives as a new **"Elements" tab** in the right sidebar (Structure /
Elements / Blocks / Design), keeping the existing editor layout, sidebar
relationships, and all prior tabs intact.

```
Element Registry (P22-A)          ← single source of truth
        ↓ (derives block types only — element-only types excluded: no render path yet)
Library Catalog (pure, testable)
        ↓ filter by category + search (labels, keywords, synonyms)
Element Library panel (right-sidebar tab)
        ↓ click
insertLibraryElement()            ← canonical insertion service
   ├── selected custom-block section → insert into its tree  (commitBlockTree)
   └── otherwise                    → new custom-block section (insertSection)
        ↓
Existing history / undo-redo / collaboration / autosave (untouched)
```

Design decisions in one line each:

- **Registry-driven, never hard-coded** — the catalog is derived from the
  Phase P22-A `elementRegistry`, which itself derives block types from the
  Phase O `blockRegistry`. New registered block types appear in the library
  automatically.
- **Only elements with a valid path are exposed** — element-only types
  (`text`, `logo`, `list`, `carousel`, `product-card`, `price`,
  `custom-component`, `section`) have no renderer and no custom-block
  persistence path yet, so they are excluded (per the phase brief's "only
  expose elements that have a valid implementation path").
- **One canonical insertion path** — `insertLibraryElement` reuses
  `createBlock` (fresh defaults), `applyBlockOperation` (Phase O engine),
  `buildCustomBlockSection` (custom-block schema), and the editor store's
  `insertSection` / `commitBlockTree` boundaries. One history entry per
  insertion; undo/redo/collab/autosave behave exactly like every other
  durable edit.
- **Placement is context-aware** — with a custom-block section selected, the
  element is inserted *inside* that design (and the new block is selected);
  otherwise it becomes a *new custom-block section* (after the selected
  section, or at the end of the page).
- **No new dependencies, no parallel state system** — icons reuse the
  existing `BlockIcon` map, toast feedback reuses the My Blocks toast host,
  scroll-into-view reuses the editor utility, and no element state lives
  anywhere except the existing project model.

## 2. What was audited

- The P22-A element model + registry (`src/features/elements/`) — the catalog
  source of truth.
- The Phase O block model, registry, engine, and adapter
  (`src/features/blocks/`) — creation, nesting, and tree↔section folding.
- The custom-block persistence path (`custom-block-schema.ts`,
  `insert-imported-block-tree.ts`) — the new-section construction pattern.
- The editor store boundaries (`insertSection`, `commitBlockTree`,
  `commitElementTree`) and `section-structure` position model.
- The editor chrome (`editor-ui-store.ts`, `RightSidebar.tsx`) — tab surface.
- Existing discovery surfaces (`AddSectionDialog`, `BlockBrowserDialog`,
  `MyBlocksLibrary`) — design language, search/category patterns, toast +
  selection conventions.
- Existing E2E + unit test conventions (P22-B/C specs, `helpers/projects.ts`,
  component test setup).

## 3. Files changed

**New feature — `src/features/library/`:**

| File | Purpose |
|---|---|
| `types.ts` | `LibraryCategory` / `LibraryItem` / `LibraryInsertionMode` / `InsertLibraryElementResult` |
| `catalog.ts` | Centralized, registry-derived catalog + category labels + search/filter (pure) |
| `services/insert-library-element.ts` | Pure `buildLibraryTree` + store-backed `insertLibraryElement` (one history entry) |
| `components/ElementLibrary.tsx` | The panel: header, insertion-context banner, search, category chips, card grid, empty state, per-item inserting state |
| `__tests__/catalog.test.ts` | 13 tests |
| `__tests__/insert-library-element.test.ts` | 13 tests |
| `components/__tests__/ElementLibrary.test.tsx` | 9 tests |

**Modified (2):**

- `src/features/editor/ui/editor-ui-store.ts` — added `"elements"` to the
  `RightSidebarTab` union.
- `src/components/editor/RightSidebar.tsx` — added the Elements tab
  (`LayoutGrid` icon) and its panel, wired through the same `TabList` /
  roving-tabindex machinery. All existing tabs keep their exact behavior.

**New E2E:** `e2e/element-library.spec.ts` (4 tests).

**Docs:** this report.

## 4. Element registry design

The library catalog (`catalog.ts`) is the centralized UI catalogue:

- **Source:** `elementRegistry.types` / `elementRegistry.get(type)` — block
  types derived lazily from the block registry, so the catalogue can never
  drift from what renders.
- **Categories** map 1:1 to element-registry categories with friendly labels:
  `layout → Layout`, `content → Content`, `interactive → Interactive`,
  `composite → Cards`, `navigation → Navigation`. "All" is the default.
- **Search** matches label, description, keywords, type name, and a small
  plain-language synonym map (same pattern as the existing block browser).
- **Freshness** — items are built from the live registry; registration is
  idempotent and additive.

## 5. Insertion flow

`insertLibraryElement({ type, pageId?, targetSectionId?, idFactory? })`:

1. Resolve the target page (explicit → selected → first).
2. Resolve the target section (explicit → selected). If it is a
   **custom-block** section:
   - `customBlockTreeFromSection` (validated, deep-cloned) →
     `applyBlockOperation({ kind: "insert", parentId: sectionRoot, block })`
     → `commitBlockTree` (one history entry).
   - Post-insert: selects the section and highlights the new block in the
     build tree / inspector.
3. Otherwise build a **new custom-block section** whose root node is the
   element (`buildLibraryTree` → `buildCustomBlockSection` → `insertSection`
   with after-target / end-of-page position). `insertSection` selects it.
4. Any failure leaves the project untouched; errors surface through the
   existing toast host.

## 6. Tests added

**Unit/component (35 tests across 3 new files):**

- `catalog.test.ts` (13) — every block type exposed, element-only types
  excluded, category mapping, deterministic order, category filter, search by
  label/keywords/synonyms, combined filter, empty results, multi-token
  matching.
- `insert-library-element.test.ts` (13) — `buildLibraryTree` fresh-defaults +
  reference isolation, new-section placement (root type/props), one history
  entry, undo removes the section, after-target placement, selected-section
  fallback, inside-custom-block placement (tree growth, parent linkage, one
  entry, block selection, undo removes only the block), unknown type / missing
  page are no-ops.
- `ElementLibrary.test.tsx` (9) — renders categories + cards, insertion
  context banner (new-section vs inside-design), search filtering, category
  chip filtering, empty state, click-to-insert new section, click-to-insert
  inside selected design, one history entry per insert.

**E2E (`e2e/element-library.spec.ts`, 4 tests):** library renders categories +
cards; search filters + empty state; clicking an element adds a new
custom-block section and selects it; clicking an element with a custom-block
section selected inserts it inside that design and one undo removes only the
inserted block. All 4 assert a clean runtime audit (no console errors).

## 7. Validation results

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | ✅ clean (0 errors) — after removing the stale `.next` dev artifact, see §8.1 |
| `npm run lint` | ✅ 0 problems |
| Targeted unit suite | ✅ 35/35 (library) + 607/607 (editor/blocks/canvas/code-import, one pass) |
| Full unit suite `npx vitest run --maxWorkers=4` (run once) | ✅ **312 files / 4314 tests passed** (P22-C baseline: 309 files / 4279) |
| `npm run build` | ✅ production build succeeded |
| `e2e/element-library.spec.ts` (P22-D) | ✅ 4/4 |
| `e2e/element-inspector.spec.ts` (P22-C) + `canvas-selection.spec.ts` (P22-B) + `block-browser.spec.ts` + `block-tree.spec.ts` | ✅ 27/27 |
| `e2e/editor.spec.ts` + `pages.spec.ts` + `editor-structure.spec.ts` + `experience-modes.spec.ts` | ✅ 36/37 in batch; the 1 failure passes in isolation (see §8.2) |

E2E ran one batch at a time on a single Playwright-managed dev server
(`--webpack`, port 3000), with leftover processes cleaned up afterward.

## 8. Failures investigated (evidence-based classification)

### 8.1 Typecheck — stale `.next` dev artifact, not source

After the E2E phase, `tsc --noEmit` reported the same single error in
`.next/dev/types/app/api/generate/route.ts` documented in P22-C §7.1 (the
Playwright dev server regenerated the typegen artifact; Next 16 rejects the
P21-era `boundedErrorToken` export on the generate route).

**Evidence it is environmental, not a P22-D regression:**
1. `src/app/api/generate/route.ts` is unmodified in P22-D (and was unmodified
   in P22-C — this is the pre-existing P21 F3 helper).
2. The failing file lives exclusively in `.next/dev/types` (gitignored dev
   output); no production `.next/types` build output exists.
3. After `rm -rf .next` (the documented P22-A/C remedy), `tsc --noEmit` is
   clean (0 errors).

No source change was made and no test was weakened.

### 8.2 `e2e/editor.spec.ts:608` "Real pipeline — generation succeeds with available provider" — provider-timing flake

In a 37-test batch this single test timed out at
`page.waitForResponse("**/api/generate", 200, { timeout: 30000 })`. This test
does **not** mock the generate API — it calls the real provider and requires a
200 response with a generated project within 30s.

**Evidence it is environmental, not a P22-D regression:**
1. The test exercises only the AI generation pipeline; P22-D changes
   (a library panel + a new sidebar tab) are never on that path.
2. Re-run **in isolation on the same warm server: 1/1 passed** (39.2s) — the
   provider call just took longer than 30s under batch load.
3. The same class (real-pipeline provider timing) is a documented flake in
   earlier reports.

**Action:** none to product code or assertions.

## 9. Security review

- Library insertions create elements through the existing validated
  boundaries only: `createBlock` defaults are registry-defined, the tree is
  validated by the Phase O engine (`applyBlockOperation` →
  `validateResult`/`validateTree`), the section is validated by
  `CustomBlockSectionPropsSchema` (`buildCustomBlockSection`) and the
  canonical section schemas, and commits go through `withHistory` exactly
  like every other durable edit.
- No new execution path, no `eval`/`Function()`, no raw HTML, no new network
  surface. Auth, RLS, rate limits, headers, logging, and publishing are
  untouched (P20/P21 guarantees intact).
- The catalog exposes only registered block types; unknown types are rejected
  at the service boundary before anything is built.

## 10. Performance notes

- The catalog is built once per panel mount (`useMemo`) from the registry —
  no DOM queries, no store round-trips during search/filter (pure in-memory
  filter over ~29 items).
- Insertions are user-paced single commits — one history entry, one
  project-reference change, one autosave sequence.

## 11. Known limitations

- The library intentionally exposes block types only. Element-only types
  (rich text, logo, list, carousel, product-card, price, custom-component)
  will become insertable when their renderer + durable tree persistence land
  (future P22 sub-phase — the universal inspector already renders any
  registered element, so the library's catalog derivation is forward-
  compatible: registering a renderer + persistence path makes those items
  appear automatically).
- Click-to-insert is the primary interaction; drag-to-canvas for library
  elements was deliberately not added (the brief allows it, but the existing
  dnd-kit surface is My Blocks–specific and a second drag path would add
  complexity without a matching drop model for every element type).
- Inserting into a custom-block section always appends to the section root;
  targeted nesting inside arbitrary containers is covered by the existing
  build-tree/browser flows.

## 12. Housekeeping

- No debug scripts, temp files, logs, or experimental components were left.
- Final `git status` contains only the intended P22-D additions on top of the
  pre-existing (uncommitted) P22-A/B/C working tree:
  - **P22-D new:** `src/features/library/` (feature + tests),
    `e2e/element-library.spec.ts`, `docs/phase-p22d-report.md`.
  - **P22-D modified:** `src/components/editor/RightSidebar.tsx`,
    `src/features/editor/ui/editor-ui-store.ts`.
  - Everything else in `git status` (canvas feature, elements feature,
    inspector feature, custom-block schema, editor-store, persistence guard,
    P22-A/B/C docs + specs) is the pre-existing P22-A/B/C working tree from
    the session start — untouched by P22-D.

## 13. P22-D completion status

**P22-D complete.** The Element Library delivers a polished, category-based,
searchable, registry-driven discovery + insertion surface that reuses the
existing block/element creation and rendering infrastructure, preserves the
editor architecture and state management, adds no dependencies, and is fully
tested at unit, component, and E2E levels. Element-only element families and
drag-to-canvas are explicitly deferred (with forward-compatible seams), and
**P22-E has NOT been started**.
