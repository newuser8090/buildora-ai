# Phase P22-F — Responsive Engine (Report)

> Baseline: P22-A/B/C/D/E complete and validated (see their reports). This
> phase delivers the responsive engine on the existing desktop / tablet /
> mobile viewport model: a validated decision system with rule-based
> proposals (no external LLM), explicit accept/dismiss (never auto-applied),
> user-override-wins persisted in the document, responsive grid columns, and
> export parity for viewport overrides.
> **P22-F complete. P22-G NOT started.**

---

## 1. What was audited

- The master P22 architecture (`docs/phase-p22-architecture.md` §13/§24/§25) —
  the authoritative P22-F definition, exit criteria ("Unit (decision system) +
  E2E viewport parity") and file surface.
- The P22-A responsive model (`src/features/elements/responsive/`) —
  thresholds, top-down inheritance, `resolveElementStyle` precedence,
  `ResponsiveDecision` type + ordering helper.
- The P22-C inspector responsive foundation — breakpoint context,
  `responsiveCapable` fields, base/override mutation, `viewport` durability on
  custom-block nodes.
- The P22-B store boundary (`commitElementTree`, `withHistory`) and the
  P22-A/B/C additive field pattern (geometry → viewport).
- The block renderer (`BlockRenderer` + `applyBlockPresentation`) and the
  custom-block export generator (WYSIWYG gap for viewport overrides).
- Persistence boundaries: `ProjectSchema`, `project-normalizer`,
  `project-serializer`, collab `tree-normalizer` (shape-agnostic), share
  projection whitelist.

## 2. Scope guards honored

No reopening of P22-A–E; no second responsive-resolution system (all changes
go through `viewport.<bp>` + `updateElementViewport` + `resolveElementStyle`);
no isHome-like flag; no arbitrary transformation strings (allow-list enforced
at the Zod boundary — `"carousel"` is rejected); no external LLM/Gemini
(rule-based deterministic proposals); no auto-apply (explicit Apply/Dismiss);
the existing breakpoint inspector is untouched (a suggestions card is added
below it); no CSS media-query authoring; no whole-canvas scaling; no section
generator rewrites (only `custom-block-generator` extended); no new state
management; no new dependencies; no unrelated product changes for test
stability.

## 3. Implementation summary

### 3.1 Validated decision engine (`src/features/elements/responsive/`)

- `types.ts` — `RESPONSIVE_TRANSFORMATIONS` allow-list + `ResponsiveTransformation`
  union; `ResponsiveDecision` gains a required `state: "applied" | "rejected"`
  (transformation narrowed from free string).
- `decisions.ts` — `ResponsiveDecisionSchema` (Zod enum transformation,
  bounded), `ResponsiveDecisionsSchema` (≤ 200), `normalizeResponsiveDecisions`
  (invalid/unknown entries dropped at the persistence boundary),
  `proposeResponsiveDecisions` (grids → fewer columns; busy rows → stack;
  large text → smaller font; skips locked/hidden/already-responsive),
  `suppressResponsiveProposals` (a user decision for an element+viewport
  suppresses ALL proposals for that pair; an applied/rejected decision for the
  exact triple suppresses re-offering), `applyResponsibleDecision` (writes the
  override through the EXISTING `updateElementViewport` op),
  `recordResponsiveDecision` (dedupe by triple + bounded cap).
- Every transformation maps to an existing style token the canvas/thumbnail/
  export renderers already consume (`gridTemplateColumns`, `flexDirection`,
  `fontSize`) — renderer-supported by construction.

### 3.2 Persistence (additive)

- `Project.responsiveDecisions?: ResponsiveDecision[]` through
  `ProjectSchema`, `project-normalizer`, `project-serializer`, and collab
  `tree-normalizer`. Old projects open unchanged; no payload-version migration
  (`siteSettings` precedent). The share projection's whitelist drops the field.

### 3.3 Editor store (one atomic entry per explicit action)

- `acceptResponsiveDecision(pageId, sectionId, decision)` — applies the
  decision to the FRESHEST tree, folds it back, records the AI decision in ONE
  `withHistory` entry; already-recorded decisions are a no-op.
- `rejectResponsiveDecision(decision)` — records the user rejection in ONE
  entry (no tree change). Invalid transformations are rejected at the schema
  boundary before any commit.

### 3.4 Editor UI

- `useResponsiveSuggestions` hook — computes tree proposals at the current
  tablet/mobile viewport (desktop shows none), filtered by persisted decisions.
- `ResponsiveSuggestions` card mounted below the existing breakpoint context
  in `ElementInspectorPanel` — per-suggestion Apply/Dismiss, never auto-applied.

### 3.5 Responsive grid columns (through the existing model)

- A `grid-columns` inspector field (Layout section, grid elements): base
  writes `props.columns`, tablet/mobile write/read
  `viewport.<bp>.gridTemplateColumns` (`repeat(N, minmax(0, 1fr))`), with the
  existing override indicator + reset. Extended the existing inspector
  `fields/schemas/mutate/resolver` + the control dispatcher — no new system.

### 3.6 Export parity (closes the WYSIWYG gap for viewport overrides)

- The generated `custom-block.tsx` now folds `viewport.tablet/mobile` overrides
  at the same thresholds (1024/768) as the editor, after the min-width block
  responsive merge. The page generator already serializes the full tree
  (including `viewport`), so the exported site renders the same override the
  canvas shows. No other section generator was touched.

## 4. Files changed

**Modified (P22-F additions on the pre-existing P22-A/B/C/D/E working tree):**
- `src/features/elements/responsive/types.ts`
- `src/features/elements/inspector/{types,fields,schemas,mutate,resolver}.ts`
- `src/features/inspector/components/{ElementInspectorPanel,InspectorField}.tsx`
- `src/types/project.ts`
- `src/features/generation/schemas/generation-plan-schema.ts`
- `src/features/persistence/services/{project-normalizer,project-serializer}.ts`
- `src/features/collaboration/crdt/tree-normalizer.ts`
- `src/features/editor/store/editor-store.ts`
- `src/features/export/generators/section-generators/custom-block-generator.ts`
- `src/features/elements/__tests__/element-responsive.test.ts` (transformation
  values narrowed to the validated vocabulary — the system now rejects the
  former free-string examples)

**New (P22-F):**
- `src/features/elements/responsive/decisions.ts`
- `src/features/elements/__tests__/responsive-decisions.test.ts` (28 tests)
- `src/features/elements/inspector/__tests__/inspector-grid-columns.test.ts` (13)
- `src/features/editor/store/__tests__/editor-store-responsive.test.ts` (10)
- `src/features/inspector/hooks/useResponsiveSuggestions.ts`
- `src/features/inspector/components/ResponsiveSuggestions.tsx`
- `src/features/inspector/__tests__/ResponsiveSuggestions.test.tsx` (6)
- `src/features/export/__tests__/custom-block-responsive.test.ts` (2)
- `e2e/responsive-engine.spec.ts` (5 E2E tests)
- `docs/phase-p22f-architecture.md`, `docs/phase-p22f-report.md`

## 5. Tests added

- **Unit (59):** decision vocabulary/schema (arbitrary strings rejected),
  proposal rules (grids/rows/headings, locked/hidden/already-responsive skips),
  user-ownership suppression (never re-suggest), apply via the existing op,
  bounded record/normalize; grid-columns field (schema, validation, base/override
  mutation, reset, resolution, override detection); store actions (one atomic
  entry per accept/reject, undo/redo of tree + decision together, no-ops,
  unknown/locked element rejection, schema-boundary rejection, persistence
  round-trip through `ProjectSchema`); export parity (generated component folds
  viewport overrides; page serializes the full tree).
- **Component (6):** suggestions hidden on desktop, shown at mobile/tablet,
  Apply folds override + records + hides, Dismiss records without auto-applying,
  dismissed stays hidden after viewport round-trip.
- **E2E (`e2e/responsive-engine.spec.ts`, 5):** grid columns at mobile write a
  viewport override (base untouched, canvas reflects); suggestions + Apply
  (override on canvas, never re-suggested, tablet unaffected); applied decision
  persists across reload; Dismiss persists (nothing auto-applied); export ZIP
  emits the same viewport override the canvas shows.

## 6. Validation results

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | ✅ clean (0 errors) |
| `npm run lint` | ✅ 0 problems |
| `npx vitest run --maxWorkers=4` | ✅ **318 files / 4415 tests passed** (P22-E baseline: 313 / 4353) |
| `npm run build` | ✅ production build succeeded |
| `e2e/responsive-engine.spec.ts` (P22-F) | ✅ 5/5 |
| `e2e/element-inspector.spec.ts` (P22-C, directly affected) | ✅ 6/6 |
| `e2e/canvas-selection.spec.ts` (P22-B regression) | ✅ 7/7 |
| `e2e/element-library.spec.ts` (P22-D regression) | ✅ 4/4 |
| `e2e/pages.spec.ts` + `page-navigation.spec.ts` (P22-E regression) | ✅ 6/6 |
| `e2e/editor.spec.ts` + `block-tree.spec.ts` (directly affected) | ✅ 39/39 |
| `npm run test:export-build` | ✅ generated site builds |

E2E ran one spec/batch at a time on a single Playwright-managed webpack dev
server (port 3000) with `--workers=1`; 55/55 across all affected specs. The
stale `.next/dev/types/app/api/generate/route.ts` tsc error seen after the E2E
runs is the documented P22-C §7.1 dev-server typegen artifact — `rm -rf .next`
(gitignored) → clean, no source change.

## 7. Security review

- No new client-trusted inputs: decisions pass `ResponsiveDecisionSchema`
  (allow-list transformations, bounded strings) at the store boundary and the
  normalizer; unknown transformation strings are dropped, never coerced.
- No `eval`/`Function()`, no raw HTML, no new network surface, no new API
  route. Auth, RLS, rate limits, headers, logging, publishing untouched
  (P20/P21 guarantees intact). The share projection whitelist drops the field.

## 8. Performance notes

- Proposals are computed per section tree on viewport/decision changes
  (cheap O(n) pass over the section's nodes); nothing runs per keystroke.
- Apply/Dismiss are single `withHistory` commits (one project-reference change
  → one revision + one autosave sequence); no per-gesture writes.
- Decision lookups are small bounded arrays (≤ 200); suppression is a linear
  scan over proposals × decisions.

## 9. Known limitations

- The responsive engine covers the elements the renderer supports today:
  grids, rows, and large text. "Horizontal carousel on mobile" and similar
  transformations require element types/renderers that do not exist yet —
  the validated vocabulary grows only when the renderer supports the change.
- A proposal the user dismisses suppresses ALL proposals for that
  element+viewport pair (the user took ownership) — per the approved
  "user overrides always win, never re-suggest" semantics.
- Manual inspector edits at a breakpoint are not diffed against AI decisions
  (only explicit Dismiss records a user decision) — documented in the
  architecture doc.
- Regular (non-custom-block) sections keep static CSS in export; only the
  custom-block generator folds viewport overrides (guard: no section-generator
  rewrites).

## 10. Housekeeping

- No debug scripts, temp files, logs, or experimental components were left
  behind. No new dependencies were added.
- `git status` shows only the intended P22-A/B/C/D/E/F working tree: P22-F
  files listed in §4, everything else pre-existing from the session start.

## 11. P22-F completion status

**P22-F complete.** The validated decision engine (allow-list transformations,
rule-based proposals, user-override-wins persisted, never re-suggest), explicit
Apply/Dismiss inspector UI (no auto-apply), responsive grid columns through the
existing viewport model, one-atomic-entry store actions, and export viewport
parity are implemented and validated at unit, component, E2E, and export-build
levels. **P22-G (interactions + animations) has NOT been started.**
