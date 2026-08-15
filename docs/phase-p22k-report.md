# Phase P22-K — Premium Canva-style UI Polish (Report)

> Baseline: P22-A through P22-J complete and validated (see their reports).
> P22-K delivers the approved **UI-shell-only** polish: collapsible/resizable
> editor panels, a minimal collapsed-shell affordance, empty-state polish, and
> accessibility hardening — all additive chrome. **P22-A through P22-J remain
> CLOSED** and their implementations are functionally untouched.

---

## 1. Implementation summary

- **Panel prefs (D-K1)** — `src/features/editor/ui/editor-ui-prefs.ts`:
  localStorage `buildora:ui:prefs` (UI-only; never Project/export/history/
  collab), safe JSON reads with explicit property writes (prototype-pollution
  proof), widths clamped 240–480, booleans validated, defaults left 320 /
  right 300 expanded.
- **UI store (D-K3)** — `editor-ui-store.ts` extended with
  `leftPanelCollapsed`/`rightPanelCollapsed`/`leftPanelWidth`/`rightPanelWidth`
  + setters (clamped) + `hydratePanelPrefs`; hydrated at store creation and on
  editor mount. No `withHistory`/`commitLocalProject` involvement.
- **Resize (D-K2)** — `src/components/editor/ResizeHandle.tsx`: focusable
  `role="separator"` with pointer-capture drag (native listeners, cleaned up
  on `pointerup`/`pointercancel`) and keyboard resize (ArrowLeft/Right ±8,
  Home/End); width transition dropped while dragging for deterministic
  pointer tracking.
- **Collapse (D-K3)** — LeftSidebar and RightSidebar collapse to minimal,
  labeled rails and reopen; `aria-expanded` + `aria-controls` wired;
  `data-testid="ai-sidebar"`, `aria-label="Editor sidebar"`, the RightSidebar
  tab system, and all `right-tab-*`/`right-panel-*`/`data-panel` testids are
  preserved. Selected tab survives collapse/reopen.
- **Shell wiring** — `EditorProvider.tsx` re-hydrates prefs on mount;
  `globals.css` gains the `.editor-panel-handle` divider rule (touch-action /
  user-select); the `page.tsx` flex row needs no change (sidebars size
  themselves; Canvas expands naturally).
- **Empty states** — audited panels; the Design panel's plain fallback text
  was polished into an icon + title + description empty state
  (`element-inspector-empty`); all existing empty states preserved.
- **Accessibility (D-K4/D-K5)** — keyboard-operable collapse/resize, visible
  focus, reduced-motion respected, guided mode parity (no GuidedPanel/
  JourneyChecklist changes).
- **E2E** — `e2e/editor-shell-polish.spec.ts` (2 tests).

## 2. Files / components changed

**New (6):**

- `src/features/editor/ui/editor-ui-prefs.ts` — prefs module + clamps
- `src/features/editor/ui/__tests__/editor-ui-prefs.test.ts` (14 tests)
- `src/features/editor/ui/__tests__/editor-ui-store.test.ts` (9 tests)
- `src/components/editor/ResizeHandle.tsx` — accessible resize divider
- `src/components/editor/__tests__/EditorPanels.test.tsx` (12 tests)
- `e2e/editor-shell-polish.spec.ts` (2 E2E tests)

**Extended (additive edits):**

- `src/features/editor/ui/editor-ui-store.ts` — panel shell state + actions
- `src/components/editor/LeftSidebar.tsx` — collapse + resize + rail
- `src/components/editor/RightSidebar.tsx` — collapse + resize + rail
  (tab system untouched)
- `src/components/editor/EditorProvider.tsx` — prefs re-hydration on mount
- `src/app/globals.css` — `.editor-panel-handle` divider rule
- `src/features/inspector/components/ElementInspectorPanel.tsx` — polished
  no-selection empty state

**Docs:** `docs/phase-p22k-architecture.md`, `docs/phase-p22k-report.md`.

`TopNav.tsx`, `Canvas.tsx`, and `StatusBar.tsx` were audited against the
polish requirements and required **no changes** (existing chrome already
satisfies the shell + the Canvas empty state is already premium).

## 3. Behavior delivered

- Left/right panels collapse (per-side) into 48px rails and expand back;
  collapse is persisted and survives reload.
- Both panels resize by pointer drag and by keyboard (8px steps, Home/End),
  clamped to 240–480px, persisted across reloads.
- Canvas width expands as sidebars collapse (layout is a natural flex row).
- All existing editor surfaces (tabs, data panel, AI chat, guided panel,
  inspector, canvas) behave identically under default state.
- Reduced-motion preference disables the width transition animation; the
  interaction still works.
- Corrupt/malicious localStorage prefs can never crash the editor or pollute
  prototypes.

## 4. Tests + exact results

| Gate | Result |
| --- | --- |
| Prefs unit tests | ✅ 14/14 |
| UI-store unit tests | ✅ 9/9 |
| Shell component tests (`EditorPanels.test.tsx`) | ✅ 12/12 |
| All editor shell unit tests | ✅ 93/93 (9 files) |
| **Full unit suite** `npx vitest run` | ✅ **346 files / 4759 tests passed** (final run fully green; occasional load flakes in unrelated dialog tests were observed under parallel full-suite load — each passes in isolation; see §7) |
| `npx tsc --noEmit` | ✅ exit 0 |
| `npx eslint .` | ✅ 0 errors (1 pre-existing warning in `e2e/ai-element-editing.spec.ts`, untouched) |
| P22-K E2E `e2e/editor-shell-polish.spec.ts` | ✅ 2/2 passed (verified on repeated runs) |

## 5. E2E verification (full regression)

The complete E2E suite (all 66 specs) was executed in batches; every spec is
covered:

| Batch | Specs | Result |
| --- | --- | --- |
| Shell-critical (editor, structure, guided, experience-modes, element-inspector, element-library, pages, page-nav, canvas-selection, block-tree, inline-editing, my-blocks) | 12 | ✅ 70 passed |
| AI/data/import (ai-* ×9, data-integrations, code-import ×2) | 12 | ✅ 27 passed |
| Realtime/share/workspace batch 1 (realtime ×6, share ×4, cloud-sync ×2) | 12 | ⚠️ 10 passed, **3 failed → passed in isolated rerun** (environment flakiness, see §7) |
| Feature batch (block-browser, custom-domain, fallback-isolation, interactions-animations, inline-ai-editing, launch ×2, my-blocks ×4, production-publishing) | 12 | ✅ 24 passed |
| Feature batch 2 (production-rollback, project ×4, prompt-matrix, publishing-history, responsive-engine, template ×3, thumbnails) | 11 | ✅ 28 passed |
| Workspaces (activity, collaboration, edit-lease, permissions, presence, version-history) | 6 | ✅ 6 passed |
| P22-K shell polish | 1 | ✅ 2 passed |

Total: **167 test executions passed** across the regression, plus the 3
realtime specs confirmed green in isolation.

## 6. Accessibility verification

- Collapse buttons: `aria-expanded` flips correctly (component + E2E
  assertions), `aria-controls` targets the controlled aside, explicit
  `aria-label`s.
- Resize handles: `role="separator"`, `aria-orientation="vertical"`,
  `aria-valuenow/min/max`, focusable; keyboard resize with `preventDefault`
  verified in component tests and E2E; Home/End verified.
- Existing RightSidebar tab keyboard navigation (roving tabindex + arrows)
  preserved — tab regression covered by component tests and the shell E2E
  batch.
- Focus visibility: `:focus-visible` ring retained; handles show a focus
  divider via `group-focus-visible`.
- Reduced motion: global `prefers-reduced-motion` rule respected; the shell
  E2E runs collapse/resize under `reducedMotion: "reduce"` successfully.
- Guided mode: collapse/resize verified working with the guided experience
  active (E2E), GuidedPanel/JourneyChecklist untouched.

## 7. Regression status / unrelated failures

- **Realtime flakiness:** 3 realtime specs failed once inside a heavy batch
  (`ECONNRESET`/timeouts — network/dev-server load), then **passed in
  isolation** (3/3). Not P22-K-related; P22-K touches no collab code.
- **Transient full-suite failures:** under heavy parallel full-suite load,
  unrelated dialog tests flaked once each — `import-project-dialog.test.tsx`
  (passes isolated 15/15) and `ImportTemplateDialog.test.tsx` (passes isolated
  11/11). The final full run was green at **4759/4759** (with one post-teardown
  async warning from the pre-existing `LeftSidebar` submit path, which also
  passes isolated 7/7). None of these files are touched by P22-K, and P22-K's
  own tests were green in every run.
- **Pre-existing lint warning:** `e2e/ai-element-editing.spec.ts:310`
  (`reviewAndApply` unused) — predates P22-K; file untouched.
- **Pre-existing build failure:** `npm run build` fails at Next's route
  type-check on `src/app/api/generate/route.ts`'s `boundedErrorToken` export.
  Verified in P22-J to reproduce identically at clean P21 HEAD — a baseline
  issue, explicitly **not** fixed in P22-K (out of scope).

## 8. Security / prefs validation

- localStorage is treated as untrusted: malformed JSON → defaults; wrong
  types → defaults per field; widths clamped 240–480; unknown keys dropped;
  the result object is assembled with explicit writes (no spread of parsed
  data), so `__proto__`/`constructor`/`prototype` cannot pollute. Covered by
  the prefs test suite.
- No secrets, no server/env changes; prefs never enter Project/export/collab.

## 9. Scope separation from P22-A..J

P22-K changes are confined to the editor shell surface declared by the master
architecture (§25) plus tests/docs. No Project model/schema, persistence,
migration, collaboration, export, rendering, or auth file was modified;
`package.json` is untouched; no existing testid was renamed or removed; no
generated artifacts were added. The P22-A..J working tree remains as-is.

## 10. Final gate results

- Typecheck: ✅ `npx tsc --noEmit` exit 0
- Lint: ✅ `npx eslint .` 0 errors (1 pre-existing warning)
- Full unit: ✅ 346 files / 4759 tests
- P22-K E2E: ✅ 2/2
- Full E2E regression: ✅ all 66 specs covered (one environment-flake set
  re-confirmed green in isolation)
- Build: ⚠️ pre-existing baseline `boundedErrorToken` failure (not P22-K, not
  fixed here — recorded per instructions)

**P22-K — COMPLETE.** Ready to mark complete; P22-A..J remain closed.
