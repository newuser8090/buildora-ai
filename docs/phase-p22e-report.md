# Phase P22-E — Multi-Page Navigation Polish (Report)

> Baseline: P22-A/B/C/D complete and validated (see their reports). This phase
> delivers set-homepage, page reorder affordance polish, and the "Navigate to…"
> page-target picker on top of the existing `pages[0]` homepage policy.
> **P22-E complete. P22-F NOT started.**

---

## 1. What was audited

- The master P22 architecture (`docs/phase-p22-architecture.md` §24/§25) — the
  authoritative P22-E definition and file list.
- The P22-A navigation model (`src/features/elements/navigation/`) — `NavTarget`,
  `resolveNavTarget`, `navTargetToHref` (built exactly for this picker).
- The routing system (`src/features/routing/routes.ts`) — `computePageRoutes`,
  `resolveInternalHref`, `validateRoutingForExport`, nested-slug support.
- Page lifecycle machinery (`page-structure.ts`, `editor-store.ts`) — `movePageToIndex`,
  `resolveUniqueSlug`, `withHistory`, existing page actions.
- The editor chrome (`PageTabs.tsx`) and the four link-bearing inspectors
  (`Header/Hero/Cta/FooterInspector`).
- Existing menu conventions (`PageStructurePanel`, `PageTabs`) and the visitor
  preview (`PreviewShell`, `VisitorPageView`, `navigation.ts`).
- E2E harness patterns (`pages.spec.ts`, `element-inspector.spec.ts`,
  `template-start.spec.ts`, `helpers/projects.ts`) and the documented flake
  classes (cold-compile, provider timing, parallel contention).

## 2. Implementation summary

Three approved deliverables, no model changes:

1. **Set-homepage** — `setHomePageInList(pages, pageId)` moves a page to the
   front under the documented `pages[0]` policy, gives the new homepage the
   root slug `/`, and re-slugs the displaced former-first page to a unique
   non-root slug via `resolveUniqueSlug`. `setHomePage(pageId)` on the store
   commits it as **one `withHistory` entry**; a no-op (already home) skips
   history; selection is preserved.
2. **PageTabs "Set as homepage"** — a Home-icon menu item (disabled on the
   current homepage) plus a home indicator on the homepage tab. Move-left/right
   behavior is untouched (no drag-to-reorder in P22-E).
3. **"Navigate to…" picker** — `NavigateToPicker` lists the project's pages
   (via `computePageRoutes`) beside link href fields and writes the **resolved
   href** (`navTargetToHref({kind:"page", pageId}, pages)`) back into the
   existing `href` property. Raw typing remains the fallback. Wired into
   Header/Hero/Cta/Footer inspectors additively.

Nested routes were already supported by `validateSlug`/`slugToRoutePath`;
P22-E locks that in with tests. Preview navigation needed no change (it reads
the same route table).

## 3. Files changed

**Modified (11):**
- `src/features/editor/store/page-structure.ts` — `setHomePageInList`, `homePageId`
- `src/features/editor/store/editor-store.ts` — `setHomePage` action (interface + impl)
- `src/components/editor/PageTabs.tsx` — "Set as homepage" action + home indicator
- `src/features/editor/inspectors/HeaderInspector.tsx`
- `src/features/editor/inspectors/HeroInspector.tsx`
- `src/features/editor/inspectors/CtaInspector.tsx`
- `src/features/editor/inspectors/FooterInspector.tsx`
- `src/features/editor/store/page-structure.test.ts` — 10 new tests
- `src/features/editor/store/editor-store-pages.test.ts` — 6 new tests
- `src/features/routing/__tests__/routes.test.ts` — 8 new tests
- `src/components/editor/__tests__/PageTabs.test.tsx` — 3 new tests

**New (4):**
- `src/features/editor/components/NavigateToPicker.tsx`
- `src/features/editor/components/__tests__/NavigateToPicker.test.tsx` — 12 tests
- `e2e/page-navigation.spec.ts` — 4 E2E tests
- `docs/phase-p22e-architecture.md`, `docs/phase-p22e-report.md`

## 4. Architecture decisions

1. **`pages[0]` policy kept — no `isHome` field.** Set-homepage is a reorder
   plus slug ownership resolution through existing helpers
   (`movePageToIndex`, `resolveUniqueSlug`, `ROOT_SLUG`); no routing/slug logic
   duplicated, no model/migration/collab/export change.
2. **One atomic history entry per set-homepage.** The store action wraps
   `withHistory` exactly like `movePage`/`renamePage`; undo/redo and the collab
   commit hook behave identically to every other durable edit. No-op detection
   (already home) skips history, matching `movePageToIndex`'s `changed` flag.
3. **Selection preserved.** Page identity/content is untouched (only order and
   slug change), so `selectedPageId`/`selectedSectionId` stay valid — the same
   posture as `movePage`.
4. **Picker reuses the P22-A NavTarget model.** Page targets resolve through
   `navTargetToHref` → `resolveNavTarget` → `computePageRoutes`, so editor,
   preview and export agree on routes by construction (homepage → `/`, nested
   slugs preserved). Output is a plain href string; **no NavTarget storage**.
5. **Additive inspector wiring.** The existing `<Input>` + `update()` path is
   untouched; the picker sits beside href fields and calls the same update
   path, so history/undo/collab/autosave are unchanged.
6. **Existing menu conventions.** The picker mirrors the PageStructurePanel /
   PageTabs action menus (`role="menu"`, outside click + Escape close); the
   PageTabs menu item reuses the existing `MenuItem` component and its
   disabled/`aria-disabled` conventions.

## 5. Tests added

**Unit/component (39 across 5 files):**
- `page-structure.test.ts` (10) — set-homepage moves to front, root-slug
  ownership, displaced page re-slugged (incl. collision → `/home-2`), identity/
  content preserved, no-op when already home, no-op single-page,
  PAGE_NOT_FOUND, input immutability; `homePageId` first-page + empty.
- `editor-store-pages.test.ts` (6) — order + slug ownership through the store,
  no-op (no history entry), PAGE_NOT_FOUND, selection preserved, one history
  entry with undo/redo restoring order AND slugs, project schema-valid after.
- `routes.test.ts` (8) — nested slugs accepted/rejected/mapped/table/resolution/
  export-valid; route table after homepage changes (new first page owns `/`,
  displaced slug route, links to old home resolve to its new route).
- `PageTabs.test.tsx` (3) — set-home reorders + root slug, action disabled on
  the current homepage, home indicator only on the first tab.
- `NavigateToPicker.test.tsx` (12) — renders + opens menu, lists every page
  with its route, current-value highlight (incl. root), no highlight for
  unknown hrefs, resolves chosen page (home → `/`, nested slug), homepage route
  even when the stored slug differs, Escape/outside-click close, disabled.

**E2E (`e2e/page-navigation.spec.ts`, 4 tests):**
1. Set homepage reorders tabs, keeps selection, home indicator moves, action
   disabled on the current homepage.
2. Export ZIP after set-homepage: new home owns `app/page.tsx` (title asserted),
   displaced old home at `app/home/page.tsx`, About keeps `/about`, no
   `/contact` route file.
3. Picker in the CTA inspector: choose Home → href becomes `/`; raw typing
   fallback still works.
4. Visitor preview page switcher lists the new route table
   (`/`, `/home`, `/contact`), defaults to the new home root, and navigates.

## 6. Validation results

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | ✅ clean (0 errors) |
| `npm run lint` | ✅ 0 problems |
| `npx vitest run --maxWorkers=4` | ✅ **313 files / 4353 tests passed** (P22-D baseline: 312 files / 4314) |
| `npm run build` | ✅ production build succeeded |
| `e2e/page-navigation.spec.ts` (P22-E) | ✅ 4/4 |
| `e2e/pages.spec.ts` (directly affected) | ✅ 2/2 |
| `e2e/editor.spec.ts` (directly affected) | ✅ 32/32 |
| `e2e/element-library.spec.ts` (P22-D regression) | ✅ 4/4 |
| `e2e/canvas-selection.spec.ts` + `element-inspector.spec.ts` (P22-B/C regression) | ✅ 13/13 |

All E2E ran one spec/batch at a time on a single Playwright-managed dev server
(`--webpack`, port 3000) with `--workers=1`. Every spec passed; no failures to
classify.

## 7. Security review

- No new client-trusted inputs: set-homepage operates on existing page ids and
  routes through the existing `withHistory` boundary; the picker writes hrefs
  that already pass the existing safe-link/image policies at render/export.
- No `eval`/`Function()`, no raw HTML, no new network surface, no new API
  route. Auth, RLS, rate limits, headers, logging, and publishing are
  untouched (P20/P21 guarantees intact).
- The picker lists only pages from the current project's `computePageRoutes`
  table; href output comes from `resolveNavTarget` (unsafe schemes rejected by
  the P22-A schema/resolution boundary).

## 8. Performance notes

- Set-homepage is a single O(n) array reorder + slug resolution (the same cost
  as `movePage`); one project-reference change → one revision + one autosave
  sequence.
- The picker computes the route table once per open via `useMemo`; opening a
  dropdown is a trivial re-render. No DOM queries, no store round-trips.
- No changes to canvas rendering, block/element rendering, or export hot paths.

## 9. Known limitations

- The picker is **page targets only** (the P22-E scope). Section targets,
  external/email/phone/back targets, and persistent NavTarget authoring are
  P22-G.
- Set-homepage reorders the page list (homepage = `pages[0]`); there is no
  independent "homepage" flag, so reordering pages remains the way to change
  relative order — by design per the approved decision.
- Drag-and-drop tab reordering is intentionally not part of P22-E.

## 10. Housekeeping

- No debug scripts, temp files, logs, or experimental components were left
  behind.
- No new dependencies were added.
- `git status` shows only the intended P22-E changes on top of the pre-existing
  (uncommitted) P22-A/B/C/D working tree:
  - **P22-E modified:** `PageTabs.tsx`, `PageTabs.test.tsx`, the four
    inspectors, `page-structure.ts` + test, `editor-store.ts` +
    `editor-store-pages.test.ts`, `routes.test.ts`.
  - **P22-E new:** `NavigateToPicker.tsx` + test, `e2e/page-navigation.spec.ts`,
    `docs/phase-p22e-architecture.md`, `docs/phase-p22e-report.md`.
  - Everything else in `git status` is the pre-existing P22-A/B/C/D working
    tree from the session start — untouched by P22-E.

## 11. P22-E completion status

**P22-E complete.** Set-homepage (pure logic + store action + PageTabs UI +
one-history-entry semantics), the "Navigate to…" page-target picker (reusing
the P22-A NavTarget model and existing routing), and locked-in nested-route
coverage are all implemented and validated at unit, component, and E2E levels.
**P22-F (responsive engine) has NOT been started.**
