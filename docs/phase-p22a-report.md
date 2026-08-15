# Phase P22-A — Universal Element Model Foundation (Report)

**Scope:** Model / registry / validation / operations / resolution / serialization foundation.
**Result:** Complete and validated.
**Boundary:** `P22-A complete. P22-B NOT started.`

---

## 1. What was audited

- `src/types/project.ts`, `src/types/section.ts`, `src/types/theme.ts` — document model.
- `src/features/blocks/` — `types.ts`, `registry/block-registry.ts`,
  `registry/default-blocks.ts`, `engine/block-operations.ts`,
  `engine/nesting-rules.ts`, `engine/tree-traversal.ts`,
  `engine/block-presets.ts`, `adapters/section-block-adapter.ts`,
  `render/block-style-to-css.ts`.
- `src/features/editor/` — `store/editor-store.ts` (withHistory/commitLocalProject),
  `schemas/section-schemas.ts`, `mock/mock-project.ts`, section registry/inspectors.
- `src/features/collaboration/crdt/tree-normalizer.ts` — collab repair policy.
- `src/features/persistence/` — controller, autosave, normalizer, migrations.
- `src/features/routing/routes.ts` — `computePageRoutes` / `resolveInternalHref`.
- `src/features/preview/`, `src/features/export/` — render/export architecture.
- P16–P21 phase docs (`docs/phase-p16…phase-p21-architecture.md`).

## 2. What was changed

**Added** the `src/features/elements/` feature — a new, pure,
framework-independent module. **No existing file outside the new feature was
modified** (the stale `.next` build artifact was removed once to unblock
typecheck; it regenerates on build). No durable payload, store, collab, or
export behavior changed.

## 3. Files created

```
src/features/elements/
  types.ts                          ElementNode / ElementTree / definitions / errors
  responsive/types.ts               viewport keys, thresholds, ResponsiveDecision
  responsive/resolve.ts             token merge, viewport inheritance, style resolution
  navigation/types.ts               NavTarget + describeNavTarget
  navigation/resolve.ts             NavTarget → href via existing routes
  animation/types.ts                declarative animation model
  interaction/types.ts              declarative interaction model
  binding/types.ts                  future data-binding model
  schemas/element-schemas.ts        node/tree/metadata Zod schemas + security policy
  schemas/element-props-schemas.ts  typed per-family props schemas
  registry/element-registry.ts      ElementRegistry (block-derived + element-only)
  registry/default-elements.ts      element-only definitions
  registry/register-default-elements.ts
  registry/validate-props-helper.ts schema → validateProps bridge
  engine/element-validation.ts      canNestElement / validateElementTree
  engine/element-operations.ts      immutable ops + dispatcher + presets
  adapters/section-element-adapter.ts  section ↔ element bridge (reuses existing adapter)
  serialization/element-normalizer.ts  deterministic repair / sanitization
  serialization/element-serializer.ts  JSON envelope + clone
  __tests__/element-types.test.ts
  __tests__/element-schemas.test.ts
  __tests__/element-operations.test.ts
  __tests__/element-registry.test.ts
  __tests__/element-responsive.test.ts
  __tests__/element-navigation.test.ts
  __tests__/element-adapter.test.ts
  __tests__/element-serialization.test.ts

docs/phase-p22a-architecture.md
docs/phase-p22a-report.md          (this file)
```

## 4. Architecture decisions

1. **D1 — Additive ElementNode**: `ElementNode extends Omit<BlockNode, "type">`,
   `type` widened to `ElementType = BlockType | ElementOnlyType`. Every new
   field optional ⇒ every BlockNode is a valid ElementNode.
2. **D2 — Adapters over migrations**: sections materialize to element trees via
   the existing `section-block-adapter`; the fold path returns them to the
   validated section model. Durable state untouched.
3. **D3 — One renderer direction**: registry `editor` metadata + shared
   `resolveElementStyle` establish the contract; renderer itself deferred.
4. **Registry**: element-only types registered eagerly; block types derived
   lazily from `blockRegistry` (single source of truth, cannot drift).
5. **Validation boundary**: Zod schemas check raw input (`z.custom`); dangerous
   keys/values rejected at any depth; full bounds; typed props schemas enforced
   at authoring ops.
6. **Responsive**: base in `style`, `viewport.tablet/mobile` overrides only
   what differs; `resolveElementStyle` = base < block responsive < viewport;
   user responsive decisions always outrank AI.
7. **Navigation**: typed `NavTarget` resolved through existing routing; unsafe
   schemes rejected at schema and resolution.
8. **Collab/persistence preserved**: pure ops + JSON model ⇒ existing Yjs
   bridge and store boundary are the only mutation paths.

## 5. Compatibility / migration strategy

- No migration. Existing projects load and validate **unchanged** (tested
  against the mock project's every section).
- `elementTreeToBlockTree` deep-strips element-only metadata for block
  pipelines; fold-back is guarded by the `_sectionId` marker.
- Ops output is validated against the existing collab projection
  (`normalizeBlockTree`) in tests — proving they can flow through the existing
  commit/projection boundary.

## 6. Tests added

115 tests across 8 new files, covering all 15 required areas:

1. ElementNode creation — `element-types`
2. Default values (registry defaults, fresh references) — `element-types`
3. Nested children — `element-types`
4. Parent/child integrity (back-references, cycles, orphans) — `element-types`, `element-schemas`
5. Element type validation (unknown types, element-only types) — `element-schemas`
6. Style validation (safe/unsafe tokens) — `element-schemas`
7. Responsive override validation + resolution — `element-responsive`, `element-schemas`
8. Serialization/deserialization (round-trip, repair, idempotence) — `element-serialization`
9. Existing BlockNode compatibility (block trees validate/operate/serialize) — `element-types`, `element-operations`
10. Section → ElementNode adaptation (projection, fold-back, markers) — `element-adapter`
11. Existing projects loading (mock project sections) — `element-adapter`
12. Undo/commit compatibility (immutability + collab projection) — `element-operations`
13. Navigation target validation + resolution — `element-navigation`, `element-schemas`
14. Interaction schema validation — `element-schemas`
15. Registry behavior (lazy derivation, first-wins, ordering, clear) — `element-registry`

Plus reviewer-driven hardening tests: insert-time props validation, breakpoint
cap, and the "default props always validate" invariant.

## 7. Validation results

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` | ✅ clean |
| `npm run lint` | ✅ 0 errors, 0 warnings |
| `npm test` (full unit suite) | ✅ 297 files, **4098/4098** passed (two consecutive green runs; one earlier run hit the pre-existing known flake at shared project-creation — documented in P18–P20 reports) |
| `npm run build` | ✅ production build succeeded |
| Element suite | ✅ 115/115 |

No E2E run was launched: no editor/preview/export surface was touched.

## 8. Security review

- Raw-input validation (`z.custom`, never rebuilt records) prevents prototype
  pollution; dangerous keys rejected at any depth.
- Unsafe CSS values (`javascript:`, `vbscript:`, `expression(`, `behavior:`,
  `binding:`, `url(javascript:)`) rejected by schema **and** scrubbed by the
  normalizer at any depth.
- All strings/records/nodes/children/depth length-capped; custom code is
  validated, capped, and **never executed** (advanced opt-in only, future
  sandboxed container).
- `NavTarget` and interaction actions reject unsafe URL schemes.
- No new API surface, no new execution path, no weakening of P20/P21
  rate limits, headers, authz, RLS, or bounded logging.
- Code review performed (deepseek-flash): raised defense-in-depth gaps — all
  addressed (insert/rename props validation, responsive breakpoint cap,
  downcast doc warning).

## 9. Known limitations

- Element trees are not yet persisted (durable `SectionElement.tree` wiring is
  deferred to a later sub-phase).
- No renderer, editor UI, or manipulation is implemented (by design).
- Per-operation full-tree clone + validate is O(n) — acceptable for the
  foundation; P22-B pointermove paths must use incremental updates.
- `elementTreeToBlockTree` is a downcast utility: callers must guard against
  element-only types (documented; the fold path already does).
- The CSS-safety policy (`expression(`, `behavior:`) may flag legitimate text
  containing those substrings — inherited from the existing P1/P3 policy.

## 10. Confirmation

> **P22-A complete. P22-B not started.**

No canvas manipulation, selection handles, drag-and-drop, inspector, responsive
visual editor, animations, interactions UI, AI element editing, integrations,
or Canva-style shell redesign was implemented. No P23 work was begun.
