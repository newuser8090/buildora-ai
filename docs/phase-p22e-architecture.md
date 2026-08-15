# Phase P22-E — Multi-Page Navigation Polish (Architecture)

> **Status:** Implemented and validated (see `docs/phase-p22e-report.md`).
> **Scope:** Set-homepage, page reorder UX polish, and the "Navigate to…"
> page-target picker — nothing more. **P22-E complete. P22-F NOT started.**
> **Boundary:** `P22-E complete. P22-F not started.`

---

## 1. Purpose

P22-E is the "Multi-page polish" sub-phase of the P22 Canva-style builder. Per
the master architecture (`docs/phase-p22-architecture.md` §24):

> **P22-E — Multi-page polish** — *"Set-homepage, page reorder UX, navigation
> config surfaced in the 'Navigate to…' picker (page targets); nested routes
> where supported"* — exit criteria *"E2E navigation flows; routing tests."*

The gap table (§11) rated this **Low** severity: multi-page + per-page SEO
already exist; what is missing is *set-homepage + nav config polish*. The
`pages[0]` homepage policy is already enforced everywhere (routing, export,
preview); P22-E surfaces the missing user affordances on top of it.

The docs' own file list (§25) for P22-E is `PageTabs.tsx`, `page-structure.ts`,
`routes.ts`, `src/features/preview/engine/navigation.ts`.

---

## 2. Approved decisions (from the P22-E brief)

1. **Set-homepage semantics** — use the existing `pages[0]` policy. **No
   `isHome` field on `Page`.** Implement `setHomePageInList(pages, pageId)` by
   moving the page to index 0 and resolving slug ownership with existing
   helpers. The new homepage owns `/`; the displaced former-first page gets a
   unique non-root slug; page identity/content is preserved; one history entry;
   setting the already-home page is a no-op with no history entry.
2. **Navigate-to picker output** — the picker writes the **resolved href
   string** into the existing `href` property. Reuse `NavTarget`,
   `resolveNavTarget`, `navTargetToHref`, `computePageRoutes`. **No persistent
   NavTarget storage in P22-E** (that is P22-G). Raw href typing stays
   available as the fallback.
3. **Page reorder UX** — **no drag-and-drop tab reordering in P22-E.** Keep the
   existing move-left/right menu behavior; P22-E adds and polishes the "Set as
   homepage" affordance only.

---

## 3. Design

### 3.1 Set homepage (pure layer + store action)

`setHomePageInList(pages, pageId)` in `src/features/editor/store/page-structure.ts`:

```
1. find the page; PAGE_NOT_FOUND if missing
2. index 0 already → no-op (changed:false) — no history entry
3. movePageToIndex(pages, pageId, 0)   ← existing helper, reused
4. new home (index 0) → slug = ROOT_SLUG ("/")
5. displaced former-first page (now index 1) → resolveUniqueSlug(next,
   title, id)  ← existing helper: unique, non-root, title-derived
6. return new array + changed:true
```

Reuses the existing routing/slug machinery (`movePageToIndex`,
`resolveUniqueSlug`, `ROOT_SLUG`); **no slug logic is duplicated.** The store
action `setHomePage(pageId)` wraps the result in **one `withHistory` entry**
(no-op skips history), and selection is preserved untouched (page identity is
unchanged; section selection stays valid because the page keeps its id and
content).

`homePageId(pages)` returns `pages[0]?.id ?? null` — the single place that
names the homepage, used by the UI and tests.

### 3.2 Set-homepage UI (PageTabs)

`src/components/editor/PageTabs.tsx` gains a **"Set as homepage"** menu item
(Home icon) between "Edit meta" and the move actions. It is **disabled for the
current homepage** (`aria-disabled` + disabled button + disabled reason text,
matching the existing `MenuItem` conventions for move/delete). The homepage tab
itself now shows a **Home icon indicator** (replacing the generic file icon for
index 0), so which page owns `/` is visible at a glance. Reorder behavior is
unchanged (move left/right menu items untouched).

### 3.3 Navigate-to picker

`src/features/editor/components/NavigateToPicker.tsx` — a small trigger button
beside link href fields:

```
trigger ("Page…" + link icon) → role=menu dropdown
  ├─ list computed via computePageRoutes(pages)   ← existing route table
  ├─ each item: page title + routeUrl, current-value highlight (aria-current)
  └─ click → navTargetToHref({kind:"page", pageId}, pages) → onChange(href)
```

- Uses the **P22-A typed navigation model** (`NavTarget` → `resolveNavTarget`
  → `navTargetToHref`) so editor and export agree on routes by construction
  (homepage → `/` even when its stored slug differs; nested slugs preserved).
- **Writes an href string** — no NavTarget stored; raw typing remains via the
  sibling `<Input>`.
- Menu conventions mirror the existing action menus (PageStructurePanel /
  PageTabs): `role="menu"`, outside click + Escape close, small dropdown.
- Highlighting matches the current field value against route URLs
  (query/hash stripped), so an existing `/about` link shows About as active.

### 3.4 Inspector wiring

The picker is wired into every link-bearing section inspector, additively —
the `<Input>` and its `onUpdateProps`/`update()` path are untouched:

| Inspector | Fields |
|---|---|
| `HeaderInspector` | each `navLinks[i].href`, `ctaHref` |
| `HeroInspector` | `primaryCta.href`, `secondaryCta.href` |
| `CtaInspector` | `ctaHref` |
| `FooterInspector` | each `links[i].href` |

### 3.5 Routing

`routes.ts` already supports **nested slugs** (`/blog/post` → `validateSlug`
accepts, `slugToRoutePath` maps to `app/blog/post/page.tsx`, route table +
resolution + export validation all handle it). P22-E **locks this in with
tests**; no routing behavior changed. `computePageRoutes` derives the homepage
purely from order, so the set-homepage reorder is reflected by construction.

### 3.6 Preview navigation

`src/features/preview/engine/navigation.ts` needs **no change** — internal
routes are classified from the same `computePageRoutes` table, so the visitor
preview's page switcher and link handling automatically reflect the new
homepage after a reorder.

---

## 4. Files

**Modified:**

- `src/features/editor/store/page-structure.ts` — `setHomePageInList`,
  `homePageId`
- `src/features/editor/store/page-structure.test.ts` — 8 new tests
- `src/features/editor/store/editor-store.ts` — `setHomePage` action
- `src/features/editor/store/editor-store-pages.test.ts` — 6 new tests
- `src/features/routing/__tests__/routes.test.ts` — nested-route +
  homepage-change route tests (11 new tests)
- `src/components/editor/PageTabs.tsx` — "Set as homepage" action + home
  indicator
- `src/components/editor/__tests__/PageTabs.test.tsx` — 3 new tests
- `src/features/editor/inspectors/{Header,Hero,Cta,Footer}Inspector.tsx` —
  picker wiring (additive)

**New:**

- `src/features/editor/components/NavigateToPicker.tsx`
- `src/features/editor/components/__tests__/NavigateToPicker.test.tsx` — 12 tests
- `e2e/page-navigation.spec.ts` — 4 E2E tests
- `docs/phase-p22e-architecture.md`, `docs/phase-p22e-report.md`

---

## 5. Non-goals (scope guard)

- **No `isHome` field on `Page`** (homepage = `pages[0]` stays the policy).
- **No persistent NavTarget storage** — the picker writes resolved hrefs;
  the full NavTarget-authoring model is P22-G.
- **No drag-and-drop page tab reordering** in P22-E.
- **No responsive engine, interactions/animations, AI element editing, site
  generation, integrations, or Canva-shell redesign** (P22-F onward).
- No reopening of P22-A/B/C/D and no refactor of unrelated editor
  architecture.
