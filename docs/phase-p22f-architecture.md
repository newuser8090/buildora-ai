# Phase P22-F — Responsive Engine (Architecture)

> Buildora AI — Canva-style AI website builder. P22-F turns responsive behavior
> into a first-class, editor-driven capability on the existing desktop /
> tablet / mobile viewport model: a validated decision system with rule-based
> proposals (the deterministic fallback is the P22 convention — no external
> LLM), explicit user accept/reject (never auto-applied), user-override-wins
> persisted in the document, responsive grid columns through the existing
> viewport-override path, and export parity for viewport overrides.
>
> **Baseline:** P22-A/B/C/D/E complete and validated (see their reports).
> **Boundary:** `P22-F complete. P22-G NOT started.`

---

## 1. Scope guards (approved, binding)

- **Do NOT** reopen P22-A/B/C/D/E; add a second responsive-resolution system;
  add an isHome-like model flag; allow arbitrary/unvalidated transformation
  strings; build an external LLM/Gemini integration; auto-apply responsive
  proposals; redesign the existing breakpoint inspector; expose CSS media-query
  authoring to beginners; implement whole-canvas scaling; rewrite all section
  generators; introduce a new state-management system; add dependencies; or
  modify unrelated product code to eliminate flaky tests.
- The existing viewport model (desktop / tablet / mobile), its thresholds
  (mobile ≤ 768, tablet ≤ 1024) and resolution precedence (base style < Phase O
  block `responsive` min-width tokens < viewport overrides) remain
  authoritative. P22-F **extends** the existing responsive resolver, element
  operations, inspector capabilities/mutation, block presentation,
  custom-block schema, and editor-store history/persistence — it creates no
  parallel abstraction.

## 2. What already exists (verified on the P22-E baseline)

- **Model:** `ElementNode.viewport?: { tablet?, mobile? }` (base values live in
  `node.style`), `ElementViewportStylesSchema` (bounded: 2 viewport keys,
  capped style records), `updateElementViewport` op, `ResponsiveDecision` type
  + `effectiveResponsiveDecisions` ordering helper (types only — nothing
  produces or persists decisions).
- **Resolution:** `resolveElementStyle(node, width)` with the documented
  precedence; `viewportOverridesForWidth` (top-down inheritance);
  `styleTokensToCss` safety layer.
- **Persistence:** custom-block node schema + normalizer carry `viewport`
  through normalize → project → fold (P22-C); old trees still validate.
- **Rendering:** `BlockRenderer` + `applyBlockPresentation` fold viewport
  overrides into CSS; canvas viewport frame switches 1440/768/390.
- **Inspector:** breakpoint context (Desktop/Tablet/Mobile, Base/Override),
  `responsiveCapable` style fields, override indicator + reset; mutation routes
  base→`style`, tablet/mobile→`viewport.<bp>`.
- **Editor state:** `viewport` + `setViewport` in the editor store (StatusBar +
  element inspector breakpoint context + guided builder all share it).

## 3. What P22-F adds

### 3.1 Transformation vocabulary (validated, renderer-supported)

A small allow-list — every transformation maps to an EXISTING style token the
canvas/thumbnail/export renderers already consume. Arbitrary strings are
rejected at the schema boundary (the P22-A safety posture).

| Transformation | Target element | Viewport override written |
|---|---|---|
| `grid-columns-2` | `grid` with > 2 columns | `gridTemplateColumns: "repeat(2, minmax(0, 1fr))"` |
| `grid-columns-1` | `grid` with > 1 column | `gridTemplateColumns: "repeat(1, minmax(0, 1fr))"` |
| `stack` | horizontal row/container | `flexDirection: "column"` |
| `font-size-smaller` | large text (base ≥ 32px) | `fontSize: 0.75 × base` |

### 3.2 Decision model (additive, persisted in the document)

```ts
ResponsiveDecision {
  elementId: string;                 // element node id
  viewport: "tablet" | "mobile";
  transformation: ResponsiveTransformation;   // allow-list enum (Zod)
  appliedBy: "ai" | "user";
  state: "applied" | "rejected";     // NEW — additive, default "applied"
  note?: string;
}
```

- `project.responsiveDecisions?: ResponsiveDecision[]` — optional, bounded
  (≤ 200), validated by `ResponsiveDecisionSchema` at every boundary
  (ProjectSchema, normalizer, serializer, collab tree-normalizer).
- **User decisions always outrank AI decisions** (`effectiveResponsiveDecisions`
  unchanged). The proposal system records user accept/reject and **never
  re-suggests**: once a user decision exists for an (elementId, viewport), AI
  proposals for that pair stop; an applied decision for the exact
  (elementId, viewport, transformation) is never re-offered.

### 3.3 Responsive intelligence (rule-based, no auto-apply)

Pure engine `src/features/elements/responsive/decisions.ts`:

- `proposeResponsiveDecisions(tree, viewport)` — deterministic analysis: grids
  (>2 columns at tablet, >1 at mobile), horizontal rows with many children
  (stack on mobile), large headings (font-size-smaller on mobile). Skips
  locked/hidden nodes and nodes already responsive at that viewport.
- `suppressResponsiveProposals(proposals, decisions)` — user-ownership +
  already-done filtering (see 3.2).
- `applyResponsibleDecision(tree, decision)` — writes the viewport override
  through the EXISTING `updateElementViewport` op (validated, one tree).
- `recordResponsiveDecision(decisions, decision)` — dedupe (same
  element/viewport/transformation replaces) + cap at 200 (oldest dropped).

### 3.4 Editor UX (accept/reject, no auto-apply)

- The element inspector gains a **"Responsive suggestions"** block (below the
  existing breakpoint context — the breakpoint inspector itself is untouched).
  Suggestions appear for the current tablet/mobile viewport, each labeled with
  the element + suggested change, with **Apply** and **Dismiss**.
- **Apply** = ONE atomic history entry: tree folded with the viewport override
  + decision recorded (`appliedBy: "ai"`). **Dismiss** = ONE history entry:
  user decision recorded (`appliedBy: "user"`, `state: "rejected"`).
- Both route through two new additive store actions
  (`acceptResponsibleDecision`, `rejectResponsiveDecision`) on the existing
  `withHistory` / `commitLocalProject` boundary (collab + undo unchanged).

### 3.5 Responsive grid columns (through the existing model)

The architecture names `columns` as a first-class responsive property. The
renderer already honors a `gridTemplateColumns` string override (viewport
overrides fold via `applyBlockPresentation`). P22-F adds:

- A `grid-columns` inspector field (Layout section, grid elements only):
  base writes `props.columns`; tablet/mobile write/read
  `viewport.<bp>.gridTemplateColumns` (`repeat(N, minmax(0, 1fr))`), with the
  existing override indicator + reset.
- Resolution/mutation extended in the existing inspector `resolver.ts` /
  `mutate.ts` — no new responsive system, no CSS media queries.

### 3.6 Export parity (closes the WYSIWYG gap for viewport overrides)

`custom-block-generator`'s emitted component currently resolves only min-width
`responsive` tokens. The generated `BlockNode` + `blockStyle` are extended to
fold `viewport.tablet/mobile` overrides at the same thresholds the canvas uses,
so an authored mobile override renders identically in the exported site.
(Section generators are untouched — the guard forbids rewriting them; regular
sections keep static CSS.)

## 4. Data-model implications

- `Project.responsiveDecisions?` — additive optional array; flows through
  `ProjectSchema`, `project-normalizer`, `project-serializer` allow-list,
  collab `tree-normalizer` (shape-agnostic Yjs bridge unchanged), and is NOT
  exported into the share projection (its whitelist drops it automatically).
- No payload-version migration: optional fields follow the `siteSettings`
  precedent (read-old/write-new).
- Grid columns stay `props.columns` (base) + `viewport.<bp>.gridTemplateColumns`
  (override) — no model field added; the existing style-token boundary already
  accepts `gridTemplateColumns` and the custom-block schema already persists
  `viewport`.

## 5. File surface

**New:** `src/features/elements/responsive/decisions.ts`,
`src/features/inspector/hooks/useResponsiveSuggestions.ts`,
`src/features/inspector/components/ResponsiveSuggestions.tsx`,
tests (`responsive-decisions.test.ts`, `editor-store-responsive.test.ts`,
`ResponsiveSuggestions.test.tsx`), `e2e/responsive-engine.spec.ts`,
`docs/phase-p22f-report.md`.

**Extended (existing files only):** `elements/responsive/types.ts`,
`elements/inspector/{types,fields,schemas,mutate,resolver}.ts`,
`inspector/components/{ElementInspectorPanel,InspectorField}.tsx`,
`src/types/project.ts`, `generation/schemas/generation-plan-schema.ts`,
`persistence/services/{project-normalizer,project-serializer}.ts`,
`collaboration/crdt/tree-normalizer.ts`,
`editor/store/editor-store.ts`, `export/.../custom-block-generator.ts`,
`elements/__tests__/element-responsive.test.ts` (transformation values
narrowed to the validated vocabulary — the system now rejects the former
free-string examples).

## 6. Validation strategy

- Gate sequence (unchanged convention): `tsc --noEmit` → `lint` → unit suite
  (`--maxWorkers=4`, single clean pass) → `build` → affected E2E one-at-a-time
  on a single webpack dev server → regression specs (`editor`,
  `element-inspector`, `canvas-selection`, `element-library`, `block-tree`,
  `pages`, `page-navigation`) → `test:export-build`.
- New E2E `responsive-engine.spec.ts`: grid columns at mobile reflect on the
  canvas + persist across reload; accept a suggestion (canvas reflects, not
  re-suggested, persisted); dismiss a suggestion (never re-suggested); export
  ZIP embeds the viewport override in the generated custom-block component
  (viewport parity).
- No new dependencies; no debug files; git scope discipline per A–E.

---

**P22-F architecture complete. Implementation follows.**
