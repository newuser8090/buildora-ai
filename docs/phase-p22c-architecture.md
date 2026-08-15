# Phase P22-C — Universal Style & Property Inspector (Architecture)

> Buildora AI — Canva-style AI website builder. P22-C builds the first
> universal property inspector on top of the P22-A `ElementNode` model and the
> P22-B canvas selection/manipulation layer.
>
> **Baseline:** P22-A + P22-B complete and validated (see their reports).
> **Boundary:** `P22-C complete. P22-D (element library) NOT started.`

---

## 1. Objective

When the user selects an element on the canvas, the right-side inspector must
understand that element and expose its applicable properties in a clean,
beginner-friendly UI — driven by the element registry and a declarative
inspector schema, never by `if (type === "text") …` special-case editors.

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

This document explains the data model, the schema strategy, capability
resolution, validation, the mutation path, atomic history, responsive
overrides, section compatibility, future extension points, and how the UI
stays simple. It is written BEFORE the implementation.

---

## 2. Audit summary (what exists and what is reused)

| Concern | Existing implementation | P22-C decision |
| --- | --- | --- |
| Element model | `ElementNode` / `ElementTree` (`src/features/elements/types.ts`) — additive over `BlockNode` | Reused unchanged; the inspector is a READ/WRITE view over nodes |
| Registry | `elementRegistry` (block-derived + element-only, frozen) | Reused as the source of element labels/definition metadata |
| Element ops | `updateElementStyle/Geometry/Viewport/Props`, `setElementHidden/Locked` (`engine/element-operations.ts`) | The mutation adapter delegates to these ops — no new mutation engine |
| Responsive model | `node.viewport.tablet/mobile` overrides + `resolveElementStyle` (P22-A) | Reused; the inspector edits `style` (base) vs `viewport.*` (override) |
| Durable trees | Custom-block sections persist the whole tree; `geometry` was added in P22-B | **This phase adds `viewport` to the durable custom-block node schema** so responsive overrides persist |
| Block rendering | `BlockRenderer` renders custom-block trees (style + responsive) | **This phase applies node geometry + viewport overrides** so inspector and canvas agree visually |
| Mutation boundary | `commitElementTree` → `withHistory` / `commitLocalProject` (editor store) | The ONLY commit path for inspector changes — no direct store mutation |
| Selection | Editor section selection (`selectedSectionId`) + block-level selection (`block-editor-store.selectedBlockId`, set by `CustomBlockSection` on canvas clicks) | The inspector targets the selected block when it belongs to the selected section's tree, else the section root |
| Right sidebar | Design tab renders per-section inspectors via `inspectorRegistry` (hero/header/…) and `GuidedInspector` in guided mode | Regular sections keep their section-specific inspectors; **custom-block sections get the universal element inspector**. One sidebar, one Design tab — no second competing panel |
| Style safety | `block-style-to-css` + `element-schemas` (dangerous keys/CSS values rejected) | Inspector inputs are sanitized through the SAME schema boundaries before commit |

### Reuse vs. duplication

The inspector does NOT duplicate the style system, the responsive model, the
element registry, or the mutation machinery. It adds:

1. a declarative **inspector schema** (which controls, for which element type),
2. a **resolver** (schema + node + breakpoint → current values),
3. a thin **mutation adapter** (field change → existing element op → tree),
4. the **UI shell + reusable controls**.

---

## 3. Inspector data model (`src/features/elements/inspector/`)

Pure, framework-independent (same posture as the rest of the P22-A feature —
unit-testable without React).

```
InspectorFieldDef
  id            stable field id (e.g. "fontSize")
  label         user-facing label
  kind          text | textarea | number | slider | select | segmented |
                toggle | color | spacing | radius | shadow | font-family | alignment
  source        "style" | "geometry" | "props" | "a11y"   ← where the value lives
  key           token / geometry key / prop key (e.g. "fontSize", "width", "text")
  responsiveCapable   true → may be overridden per viewport (style fields only)
  default / min / max / step / unit / options / placeholder / maxLength / hint
  validate      (value) => error | null     ← per-field bounds before commit

InspectorSectionDef
  id            content | typography | appearance | layout | spacing | advanced
  label         "Content", "Typography", "Appearance", "Layout", "Spacing", "Advanced"
  fields        InspectorFieldDef[]

ElementInspectorSchema
  elementType   ElementType
  label         human label (from registry definition)
  sections      InspectorSectionDef[]

InspectorResolvedValue
  value         effective value at the current breakpoint
  origin        "base" | "override" | "absent"
  overridden    an override exists at the current breakpoint
  inherited     value came from the base style (no override at this breakpoint)
```

The `source` field is the key to universality: a control does not care whether
the value is a style token, a geometry key, a prop, or an a11y field — the
adapter routes it to the correct `updateElement*` op.

---

## 4. Property schema / capability strategy

Element types declare their editable surface through **capability groups**
built from stable field factories (`fields.ts`) and a deterministic
type → capability map (`capabilities.ts`):

| Capability | Elements | Sections shown |
| --- | --- | --- |
| `content` | types with registry `editableFields` (text element, logo, list, product-card, price, …) + image/video `src`/`alt` | Content (text/textarea) |
| `typography` | heading, paragraph, button, badge, text, price, list | Typography (font, size, weight, italic, line-height, letter-spacing, alignment, color, decoration) |
| `appearance` | every element | Appearance (background, text color, opacity, border, radius, shadow) |
| `layout` | every element (containers add flexDirection) | Layout (width, height, rotation, alignment) |
| `spacing` | every element | Spacing (padding/margin, 4-way) |
| `advanced` | every element | Advanced (position mode, x/y, visibility, lock) |

Every element gets Appearance + Layout + Spacing + Advanced. Text-capable
elements additionally get Typography + Content. The mapping is declared in one
place (`capabilities.ts`) and driven by the registry definition where possible
(`editableFields`), so new element types are supported by adding them to the
map — never by writing a bespoke editor.

**Schema-safety for unrendered elements:** element-only types that do not yet
have a renderer (`text`, `logo`, `list`, `carousel`, `product-card`, `price`,
`custom-component`) resolve a valid, complete inspector schema and are fully
tested at the unit level; the UI simply has nothing to select until the
element renderer + library land (P22-D). The inspector never fabricates
properties the model cannot represent.

---

## 5. Universal property resolver (`resolver.ts`)

```
resolveInspectorModel(node, definition, breakpoint)
  → { schema, values: Record<fieldId, InspectorResolvedValue> }
```

- **Style fields**: base value = `node.style[key]`; at `tablet`/`mobile` the
  override is `node.viewport?.[breakpoint]?.[key]`. Effective value =
  `override ?? base`. `overridden` = override exists; `inherited` = no
  override at this breakpoint.
- **Geometry fields**: `node.geometry?.[key]` (x/y/width/height/rotation/
  mode — not breakpoint-scoped).
- **Props / a11y fields**: `node.props[key]` / `node.a11y?.[key]`.

Resolution is pure and deterministic; the UI merely renders the resolved
values.

---

## 6. Value validation (`validation.ts`) — the D7/D8 boundary

Centralized normalization + bounds for inspector inputs:

- **Numbers**: finite, integer-or-decimal, clamped to `[min, max]`; unit-aware
  (`px`, `%`, `deg`, unitless). `"12"` / `"12px"` normalize to the number `12`.
- **Colors**: accept `#rgb/#rgba/#rrggbb/#rrggbbaa`, `rgb()/rgba()/hsl()/
  hsla()`, `var(--token, …)`. Anything else (including anything containing
  `javascript:`, `expression(`, etc.) is rejected before commit.
- **Spacing tokens**: expand/collapse 1/2/4-part shorthand
  (`"1rem"`, `"1rem 2rem"`, `"1rem 2rem 3rem 4rem"`) into top/right/bottom/
  left and back.
- **Strings**: length-capped per field; trimmed.
- **Security posture (P20/P21 intact)**: values are still run through the
  existing `ElementStyleTokensSchema` / `ElementPropsSchema` / geometry /
  viewport Zod boundaries at commit time. Malformed, oversized, or dangerous
  values never reach the tree — the commit returns a structured error. No
  `eval`, no `Function()`, no raw HTML, no unsafe style construction.

---

## 7. Mutation adapter (`mutate.ts`) — the C path

```
applyInspectorFieldChange(tree, elementId, field, value, breakpoint)
  → ElementResult<ElementTree>
```

Routes by `field.source` + breakpoint to the EXISTING pure element ops:

| field.source | base (desktop) | tablet / mobile |
| --- | --- | --- |
| `style` | `updateElementStyle(tree, id, { key: value })` | `updateElementViewport(tree, id, "tablet"\|"mobile", { key: value })` |
| `geometry` | `updateElementGeometry(tree, id, { key: value })` | n/a |
| `props` | `updateElementProps(tree, id, { key: value })` | n/a |
| `a11y` | `updateElementAccessibility(tree, id, { key: value })` | n/a |

`resetInspectorField(tree, elementId, field, breakpoint)` deletes the key —
from `style`, from a viewport override record (dropping the record when it
empties), from geometry, or from props — with the same validation.

Every result is validated by the element ops themselves (`validateResult` →
`validateElementTree`), so the tree handed to `commitElementTree` is always
schema-clean.

---

## 8. History / undo-redo / collaboration (D5)

- Each **committed** inspector change calls `commitElementTree(pageId,
  sectionId, nextTree)` — the P22-B store boundary → `withHistory` →
  `commitLocalProject`. One history entry per commit.
- **Transient inputs never touch the store or history**: text entry holds a
  local draft and commits on blur/Enter; color and opacity/letter-spacing
  sliders hold a local draft during the gesture and commit on pointer-up.
  Steppers commit per discrete click. This matches the existing
  `_editingSession` philosophy (per-keystroke history avoided) without
  touching the session machinery.
- Collaboration: `commitElementTree` already routes through the shape-agnostic
  Yjs bridge unchanged (P16). No CRDT change; the generic bridge keeps working
  and collaborating clients receive updates through the existing projection.
- Undo/redo: the existing `undo()`/`redo()` stack. A canvas resize and an
  inspector width change both write the SAME `geometry` field on the SAME
  node, so undo is coherent across surfaces.

---

## 9. Responsive foundation (D6)

- Breakpoint context = the editor's existing `viewport` state
  (`desktop | tablet | mobile`, switched via the StatusBar). The inspector
  renders the current breakpoint prominently ("Editing for Mobile") so the
  user always knows which value they are changing.
- Editing while `desktop` writes the **base** value into `node.style`.
- Editing while `tablet`/`mobile` writes an **override** into
  `node.viewport.tablet/mobile` — the base value is never touched.
- Each responsive-capable field shows an **override indicator** at the current
  breakpoint and a **reset override** action (deletes the override key only).
- Effective display resolution: override > base (top-down inheritance,
  `resolveElementStyle` semantics).
- The full Responsive-AI / automatic breakpoint intelligence is explicitly
  deferred (P22-F). This phase only establishes the base+override foundation.

---

## 10. Section compatibility (D2/D8)

- **Custom-block sections** persist the whole element tree (already true for
  geometry since P22-B). P22-C adds the optional `viewport` node field to the
  durable custom-block schema + normalizer (mirroring the P22-B geometry
  addition) so responsive overrides survive the
  normalize → project → fold round-trip. Old stored trees (without viewport)
  still validate.
- **Regular sections** (hero, header, …) keep their existing section-specific
  inspectors and existing fold behavior — the universal inspector is scoped to
  custom-block sections, whose element trees are fully editable and durable.
  This preserves every existing E2E interaction on `inspector-panel`
  (textareas, switches, inputs) and every P16–P21 invariant. The same
  `ElementInspectorPanel` component becomes available to the element renderer
  + element library (P22-D) without further changes.
- The fold path (`elementTreeToSection`) is unchanged; only the custom-block
  node schema/normalizer gained an optional field.

---

## 11. Canvas ↔ inspector sync

Both surfaces write the same node fields:

| Interaction | Writes | Read back by inspector |
| --- | --- | --- |
| Inspector width/height | `geometry.width/height` | Layout → Width/Height |
| Canvas resize (P22-B overlay) | `geometry.width/height` | Layout → Width/Height |
| Canvas rotate (P22-B overlay) | `geometry.rotation` | Layout → Rotation |
| Inspector font size/color | `style.fontSize/color` | Typography |
| Canvas nudge | `geometry.x/y` | Advanced → X/Y |
| Inspector mode (flow/absolute) | `geometry.mode` | Advanced → Position |

The inspector re-materializes the selected section's tree from the CURRENT
store on every commit and on every relevant store change, so canvas gestures
and inspector edits always observe each other. BlockRenderer applies geometry
(width/height/rotation/zIndex/absolute x/y) and viewport overrides so the
visual canvas matches what the inspector shows.

---

## 12. UI architecture — keeping the panel simple (D3)

- **Progressive disclosure**: collapsible sections; only sections relevant to
  the selected element render. Default-open: the first relevant section.
- **One control per need**: controls are small, focused components with
  keyboard entry, steppers, bounds, reset affordances, and theme-aware polish
  — never 40 raw inputs at once.
- **Empty selection**: the existing general properties state remains
  ("Theme / Pages / Sections …") — a minimal, helpful state.
- **Element header**: label + type + breadcrumb back to the section root when
  a nested block is selected.
- **No giant panel**: sections are single-column, compact, and scoped; the
  Advanced section holds positioning/visibility/lock; future capabilities
  (animation, interaction, binding, accessibility, link, AI) plug in as new
  sections/fields in the schema — no structural change.

---

## 13. Extension points for future phases (P22-G/H/J +)

| Future capability | Plug-in point |
| --- | --- |
| Animations (P22-G) | new `animation` field sources + `InspectorSectionDef` |
| Interactions / links | new `interaction`/`navigation` sources + sections |
| Data binding | `binding` source + section (schema already exists) |
| Accessibility | `a11y` source already supported by the adapter |
| Element-scoped AI | toolbar affordance in the panel header |
| Custom code/data | `customCode` source + section (data-only posture preserved) |
| Element library (P22-D) | the same `ElementInspectorPanel` renders any registered element |

The registry + schema map means new element types need no inspector code.

---

## 14. Security review posture (P20/P21 boundaries intact)

- No new execution path; no `eval`/`Function()`; no raw HTML.
- Inspector values pass through the existing Zod boundaries
  (`ElementStyleTokensSchema`, `ElementPropsSchema`, `ElementGeometrySchema`,
  `ElementViewportStylesSchema`) before persistence.
- Colors/numbers/spacing are validated in `validation.ts` before even reaching
  the tree.
- The new durable `viewport` field is bounded (2 keys max, 64 style keys per
  breakpoint, capped strings) and validated at the custom-block persistence
  boundary — same posture as `geometry`.
- Collaboration and export pipelines consume the same JSON; nothing new is
  executed or injected.

---

## 15. Performance strategy

- The tree is materialized once per section (memoized) for READING; commits
  re-materialize from the latest store state only at commit time (user-paced,
  not per keystroke).
- Local draft state keeps keystrokes/drags out of the store entirely.
- No full-project cloning on transient interactions (that cost exists only at
  commit, exactly as in P22-B).
- The panel subscribes narrowly: section, selected block id, viewport, and the
  commit action.

---

## 16. Explicitly deferred (NOT implemented in P22-C)

- Element library + drag-from-library (P22-D)
- AI element editing / AI site generation (P22-H+)
- Advanced animations / interactions editors (P22-G)
- Database / payment integrations
- Automatic responsive intelligence (P22-F)
- Template marketplace, collaboration UI redesign, Canva shell polish (P22-K)
- A11y/link/binding EDITORS (schema sources exist; UI deferred)

---

**P22-C architecture complete. Implementation follows.**
