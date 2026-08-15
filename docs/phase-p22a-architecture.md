# Phase P22-A — Universal Element Model Foundation (Architecture)

> **Status:** Implemented and validated (see `docs/phase-p22a-report.md`).
> **Scope:** Model / registry / validation / operations / serialization foundation ONLY.
> No editor UI, no canvas manipulation, no drag-and-drop, no inspector, no animations UI.
> **Boundary:** `P22-A complete. P22-B NOT started.`

---

## 1. Purpose

P22-A establishes the **durable, universal element model** that the Canva-style
builder (P22-B+) will be built on. It is deliberately a *foundation* phase: it
adds the model, registry, validation, operations, resolution, and serialization
primitives — without wiring any new UI or changing any durable project payload.

The hard constraints from the phase brief:

- **D1** — `ElementNode` is an *additive* evolution of the existing `BlockNode`.
- **D2** — Sections become root elements via **lazy materialization / adapters**, never a destructive migration.
- **D3** — One element definition renders everywhere (editor / preview / export) — established as an architectural contract, not yet a rewritten renderer.

---

## 2. The current model (audited baseline)

| Layer | Existing implementation (P16–P21) |
| --- | --- |
| Document | `Project → Page[] → BaseSection[]` (`src/types/project.ts`, `src/types/section.ts`) |
| Blocks | `BlockNode { id, type, parentId, children, props, style, responsive, visible, locked, hidden }` (`src/features/blocks/types.ts`) |
| Section ↔ Block bridge | `section-block-adapter.ts` (projection + fold), `bindingsForSection`, marker keys `_sectionType` / `_sectionId` |
| Block engine | `block-operations.ts`, `nesting-rules.ts`, `tree-traversal.ts`, `block-presets.ts` |
| Rendering | `block-style-to-css.ts` (sanitized CSS tokens) + `BlockRenderer` |
| Registry | `block-registry.ts` + `default-blocks.ts` (single source of truth for block types) |
| Collab | Shape-agnostic Yjs JSON↔Y.Doc bridge; `tree-normalizer.ts` (deterministic repair) |
| Persistence | `project-controller.ts` → autosave (3s) → IndexedDB; version history; cloud sync |
| Routing | `routes.ts` (`computePageRoutes`, `resolveInternalHref`); homepage = `pages[0]` |
| Store | `editor-store.ts` with the single mutation boundary `withHistory` / `commitLocalProject` |

**Why this survives:** `BlockNode` already carries `parentId/children`,
`responsive` overrides, `visible/locked/hidden`. The universal element model is
the *widening* of that node into a full element, plus the machinery to validate,
operate on, serialize, and later render it — without abandoning anything.

---

## 3. The new ElementNode model

```
ElementNode extends Omit<BlockNode, "type">          // all BlockNode fields preserved 1:1
  ├── type: ElementType                              // widened: BlockType | element-only families
  ├── geometry?: { mode, x, y, width, height, rotation, zIndex }
  ├── viewport?: { tablet?, mobile? }                // Canva-first overrides (base lives in `style`)
  ├── animation?: { trigger, type, durationMs, delayMs, easing, repeat, direction }
  ├── interaction?: { click?, hover?, focus?, scroll?, load? }
  ├── binding?: { source, collectionId?, path?, field? }
  ├── a11y?: { alt, label, role, ariaHidden, focusable }
  └── customCode?: { css?, js?, html?, attributes? }  // DATA ONLY — never executed

ElementTree = { rootIds: string[]; nodes: Record<string, ElementNode> }  // same shape as BlockTree
```

**Additivity is the compatibility strategy.** Every new field is optional, so
every existing `BlockNode` is *structurally* a valid `ElementNode` and every
existing `BlockTree` is a valid `ElementTree`. Nothing in the durable model
changes; nothing is re-written.

### Element-only type families (registry-driven, extensible)

`section`, `text`, `logo`, `list`, `carousel`, `product-card`, `price`,
`custom-component` — all other types continue to come from the **block
registry** (single source of truth). New element types are added through the
registry, never by editing the model file.

---

## 4. Registry architecture

```
elementRegistry (src/features/elements/registry/element-registry.ts)
 ├── element-only definitions  → registered eagerly (register-default-elements.ts)
 ├── block types              → derived LAZILY from blockRegistry (never duplicated)
 └── get/has/types/list/listByCategory/clear
```

- **ElementDefinition** contract: `type, label, description, category, iconKey,
  keywords, canHaveChildren, nesting {allowedChildTypes, min/max children},
  resizePolicy, createProps, createStyles, validateProps, editableFields,
  beginnerFriendly, editor metadata`.
- **Fresh references**: `createProps()` / `createStyles()` never return shared
  objects (tested).
- **Single source of truth**: a block type's element definition is derived from
  the block definition, so the two catalogues can never drift.
- **First-wins** registration; definitions frozen on registration.
- `validateProps` is a plain function (produced by `schemaToValidateProps` from
  a Zod schema) so the registry itself needs no Zod import.

---

## 5. Schema / validation boundary (security)

`src/features/elements/schemas/element-schemas.ts` is the hard data boundary,
mirroring the P1/P3 custom-block-schema policy:

- **Dangerous keys rejected at any depth** (`__proto__`, `prototype`,
  `constructor`) via a recursive scanner; `z.custom` checks the **raw input**
  (never a rebuilt record) so an own `__proto__` key cannot silently mutate
  prototypes.
- **Unsafe CSS values rejected** (`javascript:`, `vbscript:`, `expression(`,
  `behavior:`, `binding:`, `url(javascript:)`).
- **Bounds**: 1000 nodes, 12 depth, 4000-char text, 32 children, 64 props keys,
  64 style keys, 120-char ids, 20 KB custom-code, 16 custom attributes,
  geometry ±10 000, animation ≤ 60 s, 5 responsive breakpoints, 2 viewport keys.
- **NavTargetSchema** rejects `javascript:` / `vbscript:` / `data:text/html`
  schemes (mirrors preview navigation).
- **customCode is validated, capped data** — never executed in P22-A.
- Typed per-family props schemas (`element-props-schemas.ts`) validate the RAW
  record and are enforced at the authoring ops (see §7).

---

## 6. Element validation (engine)

`src/features/elements/engine/element-validation.ts` is the registry-aware
counterpart of the block nesting validator:

- `canNestElement(parent, child)` / `nestingViolationElement` resolve types
  through the **live element registry** (block + element-only), so element-only
  types nest correctly without touching the block engine.
- `validateElementTree(tree)` checks: type registration, field schemas
  (structure + safety + bounds), parent/child back-references, nesting rules,
  child-count caps, reachability (no orphans), acyclicity.
- `validateElementTreeStructure` (schema module) is the registry-independent
  structural check embedded in `ElementTreeSchema`.

---

## 7. Element operations (immutable, registry-consistent)

`src/features/elements/engine/element-operations.ts` — the element counterpart
of `block-operations.ts`:

- **Structural**: `insertElement`, `deleteElement` (prunes descendants),
  `duplicateElement` (remaps whole subtree ids, preserves metadata),
  `moveElement` (rejects descendant moves), `setElementLocked/Hidden/Visible`,
  `renameElement`, `updateElementProps`, `updateElementStyle`.
- **Metadata**: `updateElementGeometry/Viewport/Responsive/Animation/
  Interaction/Binding/Accessibility/CustomCode` — each Zod-validated, merged
  immutably, and cleared with `null`.
- **Presets**: `applyElementPreset` reuses the existing block preset DATA
  (button/card/image) — no second preset system.
- **Dispatcher**: `applyElementOperation` routes every op kind.
- Every op returns a **new tree or a structured `ElementResult` error**
  (`ELEMENT_*` codes); the input is never mutated; the output always passes
  `validateElementTree`.
- **Typed props schemas are enforced at authoring**: `insertElement`,
  `updateElementProps`, and `renameElement` all run the element type's
  `validateProps` (defense-in-depth — reviewer-hardened).
- **History/undo/redo is NOT reimplemented**: ops are pure; the existing
  `withHistory` / `commitLocalProject` boundary stays the single mutation path.

---

## 8. Responsive model

`src/features/elements/responsive/`:

- `ElementViewportStyles = { tablet?, mobile? }` — base (desktop) values live in
  `node.style`; tablet/mobile override **only what differs**.
- Thresholds: mobile ≤ 768, tablet ≤ 1024 (max-width, top-down inheritance).
- `resolveElementStyle(node, width)` returns the effective CSS with precedence
  **base < Phase O block responsive (min-width tokens) < viewport overrides** —
  the shared resolution function for the future single renderer.
- `ResponsiveDecision` + `effectiveResponsiveDecisions` encode the future
  Responsive-AI unit where **user decisions always outrank AI suggestions**
  (stable ordering within groups).

---

## 9. Interaction / animation / binding models

- **Animation** (`animation/types.ts` + schema): trigger (`load|hover|click|
  scroll|viewport`), type (fade/slide/scale/bounce/reveal/blur/rotate/custom),
  duration, delay, bounded easing (incl. `cubic-bezier(...)`), repeat,
  direction. Data only.
- **Interaction** (`interaction/types.ts`): `click/hover/focus/scroll/load`
  with actions `navigate`, `scroll-to`, `toggle`, `open-modal`,
  `start-animation`, `submit-form`, `custom` (registered handler id only —
  **no raw JavaScript in the default model**).
- **Binding** (`binding/types.ts`): typed source (`page|project|collection|
  form|auth`) + optional collectionId/path/field — ensures future data binding
  is architecturally possible without implementing it.

---

## 10. Navigation model

`src/features/elements/navigation/`:

- Typed `NavTarget`: `page`, `section`, `external`, `email`, `phone`, `back`.
  Users will never type `href="/about"` — a future picker writes a NavTarget.
- `resolveNavTarget(target, pages)` reuses the **existing** `computePageRoutes`
  (homepage = `pages[0]` owns `/`), resolves section anchors (`/about#s-team`),
  and falls back to an **unresolved `#`** for unknown pages (never a dead nav).
- Unsafe schemes rejected at both schema and resolution time.

---

## 11. Section → Element adapter (compatibility, no migration)

`src/features/elements/adapters/section-element-adapter.ts` reuses the existing
`section-block-adapter` as the materialization engine:

- `sectionToElementTree(section)` — section → BlockTree (existing) → ElementTree
  (structural upcast, free because fields are optional). Markers (`_sectionType`,
  `_sectionId`) survive so trees can be folded back.
- `elementTreeToBlockTree(tree)` — downcast that deep-strips element-only
  metadata for the block pipeline.
- `elementTreeToSection(tree, original)` — fold a derived tree back into the
  **validated section model** via the existing fold path (rejects foreign trees).
- `materializeSectionElement(section, tree)` — the future additive durable
  shape `SectionElement = BaseSection & { tree? }`. **P22-A defines it but does
  NOT persist it** — durability wiring is deferred (P22-B/D).

Existing projects load **unchanged**: the mock project's every section projects
to a valid element tree, validates, and folds back (tested).

---

## 12. Serialization / normalization

`src/features/elements/serialization/`:

- `serializeElementTree` / `deserializeElementTree` — canonical JSON envelope;
  deserialize = parse → normalize → validated tree (structured errors, never
  throws).
- `normalizeElementTree` — deterministic, idempotent, bounded repair:
  unknown types dropped (with subtree), cycles broken by **dropping back-edge
  children** (not just detecting them), orphans pruned, duplicate ids/children
  collapsed (first wins), dangling `parentId`s replaced by the **true parent**,
  **unsafe values scrubbed at any depth** (dangerous CSS strings dropped,
  dangerous keys dropped), depth/node/children/text clamped, invalid metadata
  fields dropped while base fields survive.
- The model is plain schema-validated JSON — the same shape the existing
  IndexedDB persistence, version history, Yjs collab bridge, and export
  pipelines already consume.

---

## 13. Collaboration & persistence implications

- **No CRDT change.** The element tree is JSON-shaped, so it flows through the
  existing shape-agnostic Yjs bridge and `tree-normalizer` unchanged. Ops are
  pure and validated — a future sub-phase calls them from inside the existing
  `withHistory` / `commitLocalProject` store boundary (which is preserved and
  never bypassed).
- **No persistence change.** Nothing durable is written in P22-A. The
  `SectionElement` shape and serialization primitives are the seam a later
  sub-phase uses additively.

---

## 14. Renderer direction (D3)

No renderer is rewritten in P22-A. The architecture contract is:

- One `ElementDefinition` (+ `editor.rendererKey`, `resizePolicy`,
  `defaultLayout`, capability flags) drives rendering in editor, preview,
  thumbnails, and export.
- `resolveElementStyle` is the shared responsive-style resolver.
- `block-style-to-css` remains the sanitization layer for style tokens.
- The single `ElementRenderer` itself is P22-B/C work.

---

## 15. Risks

| Risk | Mitigation |
| --- | --- |
| Model/registry drift from the block catalogue | Lazy derivation from `blockRegistry` (tested) |
| Props schemas bypassed | Enforced at `insertElement` / `updateElementProps` / `renameElement` + node schema bounds |
| Unsafe values reaching render/persistence | Scrubbed at schema + normalizer layers, dropped at any depth |
| Durable-format breakage | Nothing durable changed; adapters materialize; existing projects load & fold back (tested) |
| Per-op full-tree clone cost (O(n)) | Acceptable for the foundation; flagged for P22-B (canvas pointermove paths must avoid per-move full clones) |
| `elementTreeToBlockTree` standalone misuse | Doc warning; fold path guarded by `_sectionId` marker check |
| `expression(`/`behavior:` false positives in text content | Inherited from the P1/P3 CSS-safety policy (consistent with the existing custom-block schema) |

---

## 16. Explicitly deferred (P22-B and later — NOT implemented here)

- Canvas selection handles, resize/rotate/scale, snapping, alignment, layers panel
- Drag-and-drop library and insertion previews
- Universal inspector / typography / color UI
- Copy/paste, keyboard manipulation shortcuts
- Responsive visual editor + Responsive-AI application flow
- Animation / interaction editors
- Element-scoped AI editing and AI element previews
- Backend/data-binding integrations
- Canva-style shell redesign (collapsible panels, VS Code-style splitters)
- Persistence wiring of `SectionElement.tree` (durable materialization)
- Any P23 work

---

`P22-A complete. P22-B NOT started.`
