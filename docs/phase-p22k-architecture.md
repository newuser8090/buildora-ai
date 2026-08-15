# Phase P22-K — Premium Canva-style UI Polish (Architecture)

> Scope (approved decisions D-K1..D-K5): a **UI-shell-only** polish pass —
> collapsible/resizable editor panels, a minimal shell, empty-state polish,
> and accessibility hardening. Every change is additive chrome on the editor
> shell; the Project model, persistence, collaboration, export, rendering,
> and auth surfaces are untouched. **P22-A through P22-J remain CLOSED.**

---

## 1. Objective

Per the master roadmap (docs/phase-p22-architecture.md §24):

> **P22-K — Premium Canva-style UI polish** — Collapsible/resizable panels;
> minimal shell; empty states; polish pass; accessibility.
> Exit criteria: Design QA + a11y checks + full E2E regression.

The gap-table entry (§11) that P22-K closes: *"Canva-like UI shell — fixed
chat + inspector panels, developer-ish → collapsible/resizable, minimal."*
The declared file surface (§25): `src/components/editor/{TopNav,LeftSidebar,
RightSidebar,Canvas,StatusBar}.tsx`, `editor-ui-store.ts`, `globals.css`,
prefs.

## 2. Approved decisions D-K1..D-K5

- **D-K1 — Panel prefs (localStorage).** Panel widths + collapse state persist
  as UI-only preferences under `buildora:ui:prefs`, mirroring the
  guided-builder preference architecture. Never in Project/ProjectSchema/
  `.buildora.json`/IndexedDB/CRDT/undo-redo. Safe defaults when absent/corrupt;
  default widths stay **left 320px / right 300px**; widths are clamped to
  **240–480px**; unsafe/hostile keys are dropped.
- **D-K2 — Resize mechanism.** Draggable resize handles (no CSS `resize`, no
  dependency) with pointer capture, keyboard resize (`ArrowLeft`/`ArrowRight`
  ±8px, `Home`/`End` bounds), clamped 240–480px, and a focusable accessible
  handle (`role="separator"` + `aria-valuenow/min/max`).
- **D-K3 — Collapse granularity.** Per-sidebar: `leftPanelCollapsed` /
  `rightPanelCollapsed` are independent. Collapse buttons use `aria-expanded`
  + `aria-controls` + explicit `aria-label`s. Not per-tab.
- **D-K4 — Accessibility without a new dependency.** No axe-core; deterministic
  Playwright/component assertions instead. Collapse + resize are
  keyboard-operable with visible focus; the existing RightSidebar roving-tab
  keyboard navigation is preserved; reduced-motion is respected via the global
  `prefers-reduced-motion` rule; existing `.sr-only`/`:focus-visible`
  conventions reused.
- **D-K5 — Guided mode parity.** Collapse/resize behave identically in guided
  and standard modes; `GuidedPanel`/`JourneyChecklist` are not redesigned and
  keep working inside the collapsible sidebar.

## 3. UI state architecture

`src/features/editor/ui/editor-ui-store.ts` (the existing single zustand UI
store — no new store) gains:

```
leftPanelCollapsed: boolean   (default false)
rightPanelCollapsed: boolean  (default false)
leftPanelWidth: number        (default 320)
rightPanelWidth: number       (default 300)
setLeftPanelCollapsed / setRightPanelCollapsed
setLeftPanelWidth / setRightPanelWidth   (clamped 240–480)
hydratePanelPrefs
```

Panel state is ephemeral UI state: it never passes through
`withHistory`/`commitLocalProject`, never enters the Project document, and
never participates in undo/redo or collaboration.

## 4. Prefs architecture

`src/features/editor/ui/editor-ui-prefs.ts` mirrors
`guided-builder-prefs.ts`:

- Namespaced key `buildora:ui:prefs`, one atomic JSON blob.
- `loadEditorUIPrefs` / `saveEditorUIPrefs` / `hasEditorUIPrefs` /
  `clearEditorUIPrefs` / `resetEditorUIPrefs`.
- Safe read: malformed JSON, wrong types, and missing storage all fall back to
  defaults; **the parsed result is built with explicit property writes** (no
  raw spread), so `__proto__`/`constructor`/`prototype` keys cannot pollute.
- `clampPanelWidth` bounds widths to 240–480 (rounded); the store clamps again
  on every setter (defense in depth).
- Hydration: the store hydrates at creation (memory-storage fallback for
  non-browser contexts) and `EditorProvider` re-hydrates on mount
  (cross-tab safety), so there is no flicker and no SSR problem.

## 5. Resize + collapse behavior

- **LeftSidebar** (`src/components/editor/LeftSidebar.tsx`): the `aside` keeps
  `data-testid="ai-sidebar"`, gains `id="ai-sidebar"`, a dynamic width, and a
  header collapse button (`data-testid="collapse-left-panel"`). When
  collapsed, the full panel is replaced by a minimal rail
  (`ai-sidebar-rail`) with an expand button; the resize handle
  (`data-testid="resize-left-handle"`, multiplier +1) sits between the panel
  and the canvas.
- **RightSidebar** (`src/components/editor/RightSidebar.tsx`): the `aside`
  keeps `aria-label="Editor sidebar"`, gains `id="editor-sidebar"`, a slim
  "Panels" header with the collapse button (`collapse-right-panel`), and a
  collapsed rail. The **tab system is untouched** — the selected tab is
  preserved across collapse/reopen. The resize handle (`resize-right-handle`,
  multiplier −1) sits between the canvas and the panel.
- **Canvas**: unchanged logic; it naturally expands because the sidebars are
  `flex-shrink-0` siblings with dynamic widths in the existing
  `page.tsx` flex row.
- **Dragging**: pointer capture + native listeners (removed on
  `pointerup`/`pointercancel`) keep the drag deterministic across React
  re-renders; the panel drops its width transition while dragging
  (`onDraggingChange`) so the drag tracks the pointer instead of animating.

## 6. Accessibility model

- Collapse buttons: `aria-expanded` (true/false flips with state),
  `aria-controls` → the controlled aside id, dynamic `aria-label`s
  ("Collapse/Expand AI assistant", "Collapse/Expand editor sidebar").
- Resize handles: `role="separator"` (vertical), focusable (`tabIndex=0`),
  `aria-valuenow/min/max`, `aria-label`; keyboard ±8px with `preventDefault`,
  Home/End bounds.
- Existing shell a11y preserved: RightSidebar `role="tablist"` + roving
  tabindex + arrow-key tab navigation; `:focus-visible` ring; global
  reduced-motion rule; `.sr-only` helper.
- Collapsed rails remain real, labeled elements (never `display:none` of the
  whole shell) so they are discoverable and keyboard-operable.

## 7. Empty-state polish

Audited the editor panels: Canvas (`empty-canvas` + actions), Structure
(`structure-empty-add`), Elements (`element-library-empty`), Data
(`collections-empty`) already had premium empty states and were preserved.
The one developer-ish fallback — the Design panel's "Select an element to
edit it." text — was polished into an icon + title + description empty state
(`element-inspector-empty`). Strictly UI-only; no functionality changed.

## 8. Persistence boundary

P22-K introduces **no** persistence change:

- No serializer / normalizer / schema / migration changes.
- Prefs live only in localStorage (`buildora:ui:prefs`), excluded from
  `.buildora.json`, IndexedDB project records, Supabase, CRDT/Yjs, and
  undo/redo.
- Defaults reproduce the pre-P22-K shell exactly (both panels visible, left
  320px, right 300px).

## 9. Explicit non-goals

No data-model/schema changes, no persistence/migration changes, no
collaboration/CRDT changes, no export/runtime-render changes, no auth/security
changes, no new runtime dependencies (not even axe-core), no renaming/removal
of existing testids, no dark-mode redesign, no P22-L/P23 work, and the
pre-existing `next build` `boundedErrorToken` failure is explicitly **not**
fixed here.

## 10. Testing strategy

- **Prefs unit tests**: defaults, round-trip, corrupt JSON, invalid types,
  width bounds (below/above), unsafe keys/prototype pollution, missing
  storage, never throws.
- **Store unit tests**: defaults, collapse setters, width setters + clamping,
  independent left/right state, hydration.
- **Component tests** (`EditorPanels.test.tsx`): ResizeHandle a11y contract,
  keyboard resize (±8, Home/End, preventDefault), pointer drag; LeftSidebar
  collapse/reopen + `aria-expanded`/`aria-controls`; RightSidebar
  collapse/reopen preserving the selected tab and the tab system.
- **E2E** (`e2e/editor-shell-polish.spec.ts`): default widths, collapse →
  canvas expansion, reopen, drag resize both sides, bounds, keyboard resize,
  reload persistence, tab/data/AI surfaces intact, guided-mode parity,
  reduced-motion, focus + `aria-expanded` verification.
- **Full E2E regression** is the phase's exit gate.

## 11. Dependency decision

No `package.json` change. Resize uses Pointer Events + native listeners;
collapse uses existing zustand + lucide icons; transitions use existing
Tailwind utilities + the global reduced-motion rule.
