# Phase P5 Report — Visual Library Experience

Branch: `phase-p5-visual-library-experience`
Status: ✅ Complete — all regression suites green

---

## 1. Overview

Phase P5 turns the My Blocks library (Phase P4) from a plain list into a
first-class **visual library experience**: persistent thumbnails for every
saved block, personal collections/folders, favorites, bulk operations, and
**drag-and-drop insertion straight onto the canvas**.

Scope footprint (working tree): 31 files modified (+3,749 / −522 lines) plus
~30 new files (~5,080 lines) across `src/features/my-blocks`, the editor
canvas/renderer, the block browser, persistence, and the e2e suite.

---

## 2. Features delivered

### 2.1 Visual library UI (`MyBlocksLibrary`)
- Redesigned library with **grid ↔ list view toggle** (preference persisted in
  `library-preferences.ts`).
- **Favorites** section: star any saved block and filter to starred pieces.
- **Collections** (personal folders): create / rename / delete and move one or
  more blocks into a collection (`CollectionDialog`,
  `MoveToCollectionDialog`).
- Bulk selection with **bulk delete** (`BulkDeleteDialog`) and **bulk
  transfer** via the `.buildora-blocks.json` file format.

### 2.2 Persistent thumbnails
- `thumbnails/` module: `my-block-thumbnail-service` (generation +
  orchestration), `my-block-thumbnail-storage` (IndexedDB Blob store),
  `MyBlockThumb` component, `useMyBlockThumbnail` hook.
- Thumbnails are generated once per saved/imported block, stored as Blobs
  outside project history/export, and invalidated via a **tree content epoch**
  (`contentRevision`) — the epoch only changes when the tree changes.
- IndexedDB schema bumped to **version 4**, adding the `myBlockThumbnails` and
  `myBlockCollections` object stores, with a migration test covering P4 → P5.

### 2.3 Drag & drop insertion (`drag/`)
- Root `MyBlockDndProvider` (dnd-kit) wraps the editor; cards in the library
  (`MyBlockCard`) and block browser (`MyBlockBrowserCard`) are drag sources
  carrying a `{ blockId, source }` payload.
- The canvas renders **visible drop zones** while a drag is active
  (`SectionRenderer` + `MyBlockDropZone` + `drop-zone-utils`):
  - before / after every section,
  - inside compatible custom-block (group) sections,
  - at the end of the page.
- On drop, `Canvas` validates the zone against the live project, then commits
  through the canonical `insertMyBlock` service — **one history entry, fully
  atomic** (failure leaves the project untouched). After insert: the new
  section is selected, the Blocks tab opens, the canvas scrolls it into view,
  and a toast confirms the add.

### 2.4 Placement picker
- `PlacementPickerDialog`: clicking "Insert" on any saved block now asks where
  it should go — **below the selected section** or **end of page** — instead of
  guessing.

### 2.5 Discoverability
- **TopNav "My Blocks" button** opens the library directly.
- **Command palette** additions: show favorites, move pieces to a collection,
  import a saved-blocks file, switch grid/list view, insert a recently used
  piece below / at end.
- **Guided start screen**: "Recent saved pieces" suggestions (deterministic —
  most recently used/updated saved blocks, never AI-inferred) that open the
  placement picker.

### 2.6 Backward compatibility
- All Phase P5 record fields (star, collections, thumbnail metadata, content
  revision) are **optional** — Phase P4 records remain valid and parse cleanly
  (schema + adapter tests).

---

## 3. Regression validation (sequential reruns)

Full sequential rerun of every regression suite after the interrupted session
(no orphaned dev servers; fresh run, one suite at a time).

| Suite | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | ✅ pass |
| Lint | `npm run lint` | ✅ pass |
| Unit tests | `npm test` (vitest) | ✅ 183 files / **2,849 tests** passed |
| Export build | `npm run test:export-build` | ✅ exported project `npm install && npm run build` succeeds |
| E2E main (excl. prompt/fallback) | `npm run test:e2e` | ✅ **70/70** passed (5.7m) |
| E2E prompt matrix | `npm run test:e2e:matrix` | ✅ **13/13** passed (4.3m) |
| E2E fallback isolation | `npm run test:e2e:fallback` | ✅ **1/1** passed (20.8s) |

**Totals:** 2,849 unit + 84 e2e + 1 export-build = **2,934 tests green, 0 failures.**

Prompt matrix highlights: 12/13 prompts served by Gemini, 1 rule-based fallback
(ecommerce); Arabic (prompt 9) and Japanese (prompt 10) content verified in
output; injection prompt (prompt 11) contained safely with no code leakage; all
matrix rows passed the editor-interaction check with clean console. Report:
`matrix-results/prompt-matrix-report.json`.

### 3.1 Issue found & fixed during the rerun

**`test:e2e:matrix` could never run on Windows.** The script used
bash-style single quotes (`--grep 'prompt'`); npm's default `script-shell` on
Windows is cmd.exe, which does not treat single quotes as quoting, so the grep
pattern arrived as the literal string `'prompt'` and matched zero tests
("Error: No tests found"). The direct `npx playwright test --grep "prompt"`
invocation listed 13 tests, confirming the theory. Fixed in `package.json` by
switching to double quotes (`--grep "prompt"`), matching the style already used
by `test:e2e`. Verified: the matrix suite then ran and passed 13/13.

### 3.2 Earlier interrupted run

The previous session's last artifact (fallback-isolation timing out on an
`undo-button` click) was caused by the terminal corruption that ended the
session — the same test passes cleanly on rerun (20.8s).

---

## 4. Notes / risks

- Thumbnail Blobs live in IndexedDB (`myBlockThumbnails`); they are scoped to
  the browser profile and do not travel with `.buildora-blocks.json` exports
  (thumbnails regenerate on import).
- Drag & drop only mutates on drop — hovering never changes project state; the
  drop path validates against the live project before committing.
- New e2e coverage for P5: `my-blocks-visual-library.spec.ts`,
  `my-blocks-drag-insert.spec.ts`, `my-blocks-bulk-transfer.spec.ts`, plus the
  updated `my-blocks-management.spec.ts`.
