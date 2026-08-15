# Phase P22-C — Universal Style & Property Inspector (Report)

> Baseline: P22-A + P22-B complete and validated (see their reports). This phase
> builds the first universal element inspector on the P22-A `ElementNode` model
> and the P22-B selection/manipulation layer.
> **P22-C complete. P22-D (element library) NOT started.**

---

## 1. What was audited

- The P22-A element model, registry, operations engine, schemas, and
  section↔element adapter (`src/features/elements/`).
- The P22-B canvas selection/manipulation layer, `commitElementTree` store
  boundary, and the durable custom-block `geometry` node field.
- The block rendering path (`BlockRenderer`, `block-style-to-css`) — where
  inspector + manipulation edits must be reflected visually.
- The custom-block persistence path (`custom-block-schema.ts` normalizer) — to
  add the durable `viewport` node field.
- The right-sidebar inspector plumbing (`RightSidebar.tsx`, section inspector
  registry, guided inspector) — to route custom-block sections to the universal
  element inspector without touching section-specific inspectors.
- The existing history/undo-redo boundary (`withHistory` / `commitLocalProject`)
  — the single commit path for inspector edits.
- The e2e harness (`helpers/projects.ts`, `playwright.config.ts`) and the
  P18–P21/P22-B flake records (documented environmental failure classes).

## 2. Implementation summary

The inspector is a READ/WRITE view over the P22-A element model:

```
Selected Element
      ↓
Element Inspector Schema  (per element type, capability-driven)
      ↓
Inspector Sections / Controls  (progressive disclosure)
      ↓
Validated Property Mutation  (pure adapter → element ops)
      ↓
commitElementTree()  (one atomic history entry)
      ↓
History + Persistence + Collaboration  (existing pipeline, untouched)
```

New modules:

| Layer | Files |
|---|---|
| Pure inspector model | `src/features/elements/inspector/{types,fields,capabilities,schemas,resolver,mutate,validation}.ts` — declarative field/section schema, capability map, breakpoint-aware resolver, validated mutation adapter (routes to the existing `updateElement*` ops), per-field validation |
| Inspector UI shell | `src/features/inspector/{components/ElementInspectorPanel,InspectorSection,InspectorField,controls/*,hooks/useElementInspector,hooks/useCommittedDraft}.tsx/ts` — progressive-disclosure panel, reusable controls, transient drafts, atomic commit |
| Render sync | `src/features/blocks/render/block-presentation.ts` — folds node `geometry` + `viewport` overrides into rendered CSS so canvas/thumbnail/export agree with the inspector |

Modified (P22-C additions):

- `src/components/editor/RightSidebar.tsx` — custom-block sections render the
  universal `ElementInspectorPanel`; all other sections keep their
  section-specific inspectors (existing E2E surface preserved).
- `src/features/blocks/render/BlockRenderer.tsx` — applies
  `applyBlockPresentation`; selection ring no longer clobbers a committed
  border-radius.
- `src/features/blocks/render/block-style-to-css.ts` — centralized opacity
  normalization (inspector's 0–100 → CSS 0–1; existing 0–1 values pass through).
- `src/features/code-import/schemas/custom-block-schema.ts` — additive, bounded
  `viewport` node field (schema + normalizer preservation, mirroring `geometry`).
- `src/features/persistence/services/project-controller.ts` +
  `__tests__/project-controller.test.ts` — `initialize()` guard so the
  active-project restore never clobbers an explicitly opened project (my-blocks
  independence regression, caught by the P22-C my-blocks E2E flow).

## 3. Architecture decisions

1. **Capability-driven, never `if (type === …)`** — element types declare their
   editable surface via stable field factories + a deterministic type→capability
   map; new element types are supported by extending the map, never by a
   bespoke editor.
2. **One commit path** — every committed inspector change goes through
   `commitElementTree` → `withHistory`; transient inputs (text drafts, color
   gestures) hold local state and commit on blur/pointer-up, so no
   per-keystroke history entries.
3. **Freshest-state commits** — each commit re-materializes the section's tree
   from the CURRENT store and applies ONE validated element op, so canvas
   gestures and inspector edits always observe each other.
4. **Additive durability** — `viewport` rides the same optional custom-block
   node field pattern as P22-B `geometry`; old stored trees still validate.
5. **Responsive base+override** — editing at `desktop` writes `node.style`;
   `tablet`/`mobile` write `node.viewport.<bp>`; override indicator + reset
   delete only the override key. (Full responsive AI is deferred to P22-F.)
6. **Render-side symmetry** — `applyBlockPresentation` is pure and additive;
   nodes without geometry/viewport render exactly as before.

## 4. Tests added

**Unit/component (83 tests across 6 new files):**

- `inspector-schema.test.ts` (11) — field/section schema shapes, capability
  groups, defaults, schema-safety for unrendered element-only types.
- `inspector-resolver.test.ts` (12) — style/geometry/props resolution at
  desktop/tablet/mobile, override vs inherited vs absent origins.
- `inspector-validation.test.ts` (11) — number bounds/unit parsing, color
  allow-list (dangerous values rejected), spacing shorthand expand/collapse,
  string caps.
- `inspector-mutate.test.ts` (25) — field changes routed to the correct element
  op per source × breakpoint, viewport override writes without touching base,
  reset override, spacing side changes, invalid values rejected.
- `ElementInspectorPanel.test.tsx` (13) — panel renders schema sections,
  commits through the store boundary, empty-selection state, root breadcrumb.
- `block-presentation.test.ts` (11) — geometry + viewport folded into CSS,
  rotation/absolute positioning, no-op for plain block nodes.

Plus the P22-C regression guard in `project-controller.test.ts`
(`initialize()` does not clobber an explicit open).

**E2E (`e2e/element-inspector.spec.ts`, 6 tests):** container selection shows
layout controls with width/opacity/radius reflecting on the canvas; heading
selection shows typography with font size + color reflecting; undo/redo reverts
one inspector change atomically; responsive override writes mobile viewport
styles without touching base; canvas resize updates inspector geometry fields;
inspector changes persist across save + reload.

## 5. Validation results (final run, one clean pass)

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | ✅ clean (0 errors) — after clearing a stale `.next` dev artifact, see §7.1 |
| `npm run lint` | ✅ 0 problems |
| Unit suite `npx vitest run --maxWorkers=4` (stable controlled-worker config) | ✅ **309 files / 4279 tests passed** (single run, see §7.2) |
| `e2e/element-inspector.spec.ts` (P22-C) | ✅ 6/6 |
| `e2e/canvas-selection.spec.ts` (P22-B, directly affected) | ✅ 7/7 |
| `e2e/block-tree.spec.ts` (directly affected) | ✅ 7/7 |
| `e2e/editor.spec.ts` (directly affected) | ✅ 32/32 |
| `e2e/pages.spec.ts` (directly affected) | ✅ 2/2 |
| `e2e/inline-editing.spec.ts` (directly affected) | ✅ 2/2 (with `--timeout=120000`, see §7.3) |

E2E total: **56/56** across 6 specs, run **one at a time** on a single clean
Next dev server (webpack, port 3000) with no parallel runs. All leftover
Node/Playwright processes were killed and exactly one dev server was running
for the E2E phase.

## 6. Environment discipline (per review direction)

- **No full `npm test` run was repeated.** The prior full-suite failures were
  classified as environmental/parallel-teardown/resource-contention noise:
  `ImportProjectDialog` (passes in isolation), project/dashboard tests (pass
  individually), `LeftSidebar.test.tsx` (React teardown race; passes 7/7 in
  isolation). None are P22-C implementation files, and no P22-C-specific test
  fails reproducibly in isolation — so no further full-suite loops were run.
- The stable controlled-worker unit run (`--maxWorkers=4`, previously green)
  was executed **once** for the final report and passed 309/309 files.
- The full production `test:e2e` sweep was NOT rerun (124 tests under
  contention is the documented flake source; the affected specs were validated
  individually instead).

## 7. Failures investigated (evidence-based classification)

### 7.1 Typecheck — stale `.next` dev artifact, not source

One `tsc --noEmit` run reported a single error in
`.next/dev/types/app/api/generate/route.ts` (generated Next.js dev output):
Next 16's route-export typegen rejects the P21-era `boundedErrorToken` helper
export on the generate route.

**Evidence it is environmental, not a P22-C regression:**
1. `src/app/api/generate/route.ts` is **unmodified** in this phase
   (`git status` clean for that path) — the export predates P22-C (P21 F3).
2. No production `.next/types` (build output) existed — the failing file is
   exclusively the dev-server typegen artifact.
3. After `rm -rf .next` (a gitignored build artifact, same remedy as the
   documented P22-A stale-artifact fix), `tsc --noEmit` is **clean (0 errors)**.

No source change was made; no test was weakened.

### 7.2 Unit suite — no P22-C failure observed in the final run

The single controlled-worker run (`--maxWorkers=4`) passed **all 309 files /
4279 tests**. The previously observed full-suite failures (ImportProjectDialog,
project/dashboard, LeftSidebar) were NOT reproduced and are documented as
environmental contention noise per §6.

### 7.3 Inline-editing e2e — documented cold-compile flake (pre-existing)

`inline-editing.spec.ts` was run with `--timeout=120000` per the documented
cold first-compile flake class (P18 §8 / P19 / P22-B §7.1) — **2/2 passed**
(16.6s). No assertion was weakened; the spec is not a P22-C file.

## 8. Security review

- Inspector values pass through the existing Zod boundaries
  (`ElementStyleTokensSchema`, `ElementPropsSchema`, `ElementGeometrySchema`,
  `ElementViewportStylesSchema`) at commit time; validation in
  `inspector/validation.ts` rejects dangerous values (colors with
  `javascript:`/`expression(` etc.) before they reach the tree.
- The new durable `viewport` field is bounded (2 viewport keys max, capped
  style records) and validated at the custom-block persistence boundary —
  same posture as `geometry`.
- No new execution path, no `eval`/`Function()`, no raw HTML, no new network
  surface. Auth, RLS, rate limits, headers, logging, publishing untouched
  (P20/P21 guarantees intact).

## 9. Performance notes

- The tree is materialized once per section for READING; commits
  re-materialize from the freshest store only at commit time (user-paced).
- Local draft state keeps keystrokes/drags out of the store and history.
- One atomic history entry per committed change; canvas gestures and inspector
  edits write the same fields, so undo is coherent across surfaces.

## 10. Known limitations

- The universal inspector is scoped to **custom-block sections** (fully
  editable + durable trees); regular sections keep their section-specific
  inspectors (existing behavior preserved). The same panel becomes available
  to the element renderer + library in P22-D.
- Breakpoint editing writes base/override pairs as designed; automatic
  responsive intelligence is deferred to P22-F.
- Element-only types (text, logo, list, carousel, product-card, price,
  custom-component) resolve valid schemas and are unit-tested but have nothing
  selectable on the canvas until the element renderer + library land (P22-D).

## 11. P22-D candidates (ONLY)

- Element renderer + element library with drag-to-canvas and insertion
  feedback (universal inspector already renders any registered element).
- Durable tree persistence for regular sections (activates marquee /
  multi-select and geometry everywhere).

---

**P22-C complete. P22-D not started.**
