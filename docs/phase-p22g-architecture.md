# Phase P22-G — Interactions + Animations (Architecture)

> Buildora AI — Canva-style AI website builder. P22-G delivers the
> **declarative interactions + animations** capability on the existing P22-A
> element model: typed `NavTarget` authoring, hover/focus/click behaviors,
> entrance animations (load + scroll reveal), preview runtime behavior,
> reduced-motion support, accessibility, and **export emission parity** with
> the canvas.
>
> **Baseline:** P22-A/B/C/D/E/F complete and validated (see their reports).
> **Boundary:** `P22-A through P22-F remain closed. P22-H NOT started.`

---

## 1. P22-G objective and authoritative scope

Per the master P22 architecture (`docs/phase-p22-architecture.md` §24):

> **P22-G — Interactions + animations** — *"Typed `NavTarget` + picker;
> hover/scroll effects; animation data + render; export emission"* — exit
> criteria *"Unit (resolution) + component + E2E."*

The gap table (§11) rated this **High**: buttons today carry raw `href`
strings, and there is no interaction/animation authoring at all. P22-G turns
the P22-A **data-only** model (`ElementAnimation`, `ElementInteraction`,
`NavTarget`) into a **rendered, durable, exportable** behavior:

- **Animation** — entrance animations (load + scroll/viewport reveal) with
  keyframes, hover/click-triggered animations, bounded duration/delay/easing.
- **Hover / focus** — declarative hover and keyboard-focus effects (color,
  background-color, scale, shadow) rendered as pure CSS rules.
- **Click → navigation** — a **full typed `NavTarget` picker** (page, section,
  external, email, phone, back) that writes a `NavTarget` into the click
  interaction; navigation always resolves through the existing routing /
  safe-URL boundaries.
- **Click → scroll-to** — a bounded, deterministic scroll to an element id in
  the element's own tree.
- **Preview runtime** — the visitor preview renders safe, real anchors for
  navigation, `role="link"` keyboard-accessible handlers for scroll/back, and
  `tabIndex` focusability — no raw user JavaScript anywhere.
- **Reduced motion** — entrance animations are disabled under
  `prefers-reduced-motion`; interaction feedback (hover/focus) is kept.
- **Export emission** — the generated custom-block site component emits the
  same keyframes, rules, reduced-motion guard, safe-navigation runtime, and
  route map so the exported site behaves like the canvas.

## 2. Scope boundaries (approved, binding)

- **Do NOT** reopen P22-A/B/C/D/E/F; create a second renderer/runtime; add
  new dependencies; execute raw JavaScript; expose CSS keyframe/script
  authoring to beginners; redesign the element model; or modify unrelated
  product code to make tests pass.
- **Explicitly deferred** (never produce renderable behavior in P22-G):
  `toggle`, `open-modal`, `submit-form`, `custom` handlers,
  `start-animation`, sticky/parallax scroll effects, timeline animation
  editor, cross-element animation orchestration, raw JavaScript execution,
  and a second `ElementRenderer`.
- The **existing renderer is extended** (`BlockRenderer`), not replaced.

## 3. Reused P22-A data model (unchanged)

P22-G consumes the P22-A declarative model verbatim — no model changes:

- **`ElementAnimation`** (`animation/types.ts`) — `trigger: load | hover |
  click | scroll | viewport`, `type: fade | slide | scale | bounce | reveal |
  blur | rotate | custom`, bounded `durationMs`/`delayMs`/`easing`/`repeat`/
  `direction`.
- **`ElementInteraction`** (`interaction/types.ts`) — `click?`, `hover?`,
  `focus?`, `scroll?`, `load?`. `hover`/`focus` reuse `ElementHoverEffect`
  (color, backgroundColor, scale, shadow, animation).
- **`ElementAction`** — `navigate` (with a `NavTarget`), `scroll-to`
  (`elementId`), plus the deferred kinds (`toggle`, `open-modal`,
  `submit-form`, `start-animation`, `custom`).
- **`ElementScrollEffect`** — `reveal` (with an `ElementAnimation`), and the
  deferred `sticky` / `parallax`.
- **`NavTarget`** (`navigation/types.ts`) — `page` / `section` / `external` /
  `email` / `phone` / `back`; `resolveNavTarget` + `navTargetToHref` resolve
  through the existing `computePageRoutes` route table with
  `isSafeNavUrl` defense.

Every field is optional; old trees without these fields render exactly as
before (additive change, no migration).

## 4. Durable schema / persistence path

- `src/features/code-import/schemas/custom-block-schema.ts` — the stored
  custom-block **tree node schema** gains optional, Zod-bounded
  `animation: ElementAnimationSchema` and `interaction:
  ElementInteractionSchema` fields (validated, capped strings/numbers).
  Old stored trees still validate; new trees may carry the fields.
- `ProjectSchema` → `project-normalizer` → `project-serializer` flow the
  tree through unchanged (shape-agnostic pass-through; the serializer
  allow-list keeps the top-level project keys, and the tree lives inside
  section `props`, which is already durable).
- The collab `tree-normalizer` is **shape-agnostic** (P22-F convention): it
  bridges element trees to Yjs without knowing the field names, so
  animation/interaction data normalizes identically for collaboration
  (`tree-normalizer-p22g.test.ts` locks this in).
- The share-projection whitelist drops the fields automatically (P22-A
  convention).

## 5. Store / history path

`src/features/editor/store/editor-store.ts` gains two additive actions on the
existing P22-B `commitElementTree` / `withHistory` boundary:

- `updateElementAnimation(pageId, sectionId, elementId, animation | null)`
- `updateElementInteraction(pageId, sectionId, elementId, interaction | null)`

Both:
1. reject non-writable sessions (`readonlyDenied`);
2. validate the value against `ElementAnimationSchema` / `ElementInteractionSchema`
   at the store boundary (invalid configs are rejected, never coerced);
3. resolve page → section → element tree via the existing adapter;
4. detect **no-ops by durable content** (identical stored value skips history);
5. apply the validated op (`applyElementOperation`) and fold the tree back
   into the section through `elementTreeToSection`;
6. commit **ONE atomic `withHistory` entry** (one project-reference change →
   one revision → one autosave sequence); undo/redo revert the whole entry.

Clearing an animation/interaction commits `null` (the field is removed).

## 6. Pure presentation / resolution layer

`src/features/elements/interactions/present.ts` — the single,
framework-independent resolution layer consumed identically by the canvas,
the visitor preview, and the export generator. Guarantees: deterministic
(same model + pages ⇒ same CSS/attributes every time), safe by construction
(navigation always resolves through `resolveNavTarget` + `isSafeNavUrl`,
never re-parsed here), allow-listed hover/focus values, and inert no-ops for
unsupported/unsafe configuration.

- `resolveAnimationPresentation(node)` — entrance (load → inline animation
  properties + fill-mode both; scroll/viewport → `data-ba-reveal` +
  `ba-reveal-in` rule + from-state base style), hover/click-triggered
  animations via `:hover` / `:active` CSS rules. `custom` type is inert.
- `resolveInteractionPresentation(node, tree, pages)` — click action
  resolution (page/external/email/phone/back via `resolveNavTarget`,
  scroll-to bounded to the tree's own nodes), hover/focus effect CSS
  (`buildEffectRule`, allow-listed colors/shadow tokens), `focusable` flag.
- `presentTree(tree, pages)` — one deterministic `<style>` for the whole
  tree: keyframes (deduped by type), per-element rules, and the
  reduced-motion guard. Empty for trees without any animation/interaction
  data.
- `performClickAction(action)` / `scrollElementIntoView(id)` — bounded,
  framework-agnostic click behavior (used by preview + export runtime).

## 7. BlockRenderer integration

`src/features/blocks/render/BlockRenderer.tsx` is **extended** (see §19):

- `presentTree` output is injected as one `<style>` sibling of the tree roots
  (scoped container when the tree needs the scroll-reveal observer).
- `useScrollReveal` — one `IntersectionObserver` per tree; elements with
  `data-ba-reveal` get `ba-reveal-in` when they enter the viewport, running
  the injected keyframe animation. Already-revealed ids are never re-hidden.
- Every block render carries its element `id` (the scroll-to target),
  `data-block-id`, and the animation attributes (`data-ba-anim` etc.).
- Hover/focus CSS rules match `[data-block-id="…"]:hover` /
  `:focus-visible` and apply to the same DOM element in canvas and preview.
- Non-editable (visitor preview) rendering:
  - click → navigate becomes a **real safe `<a href>`** whose click bubbles
    to the preview shell for route classification (internal → in-app
    navigation; external → new tab); `back` is handled inline.
  - click → scroll-to becomes an `<a href="#id">` with a bounded click
    handler that calls `performClickAction`.
  - focus effects add `tabIndex` so the element is keyboard-focusable and
    the `:focus-visible` rule applies.
  - content nodes (not layout containers) with a safe click action are
    wrapped in `InteractiveContentLink`; layout/navigation containers are
    excluded to avoid nested anchors / re-parenting.
- Editable (canvas) rendering keeps links inert and selection-first — clicks
  select the block; the button `href` is preserved structurally.

## 8. Preview behavior

- The visitor preview (`PreviewShell` + `VisitorPageView`) renders custom-block
  sections through the **same** `CustomBlockSection` → `BlockRenderer` path
  with `editable=false` and the project pages (so typed NavTargets resolve).
- Internal navigation anchors bubble to the existing `PreviewShell` click
  handler, which classifies via the existing `classifyPreviewLink` security
  model (internal → in-app route change; external → `_blank` with
  `noopener,noreferrer`; mailto/tel pass through; unsafe → blocked).
- Scroll-to uses the bounded `scrollElementIntoView` (`scrollIntoView`,
  instant under reduced motion).
- The canvas remains mounted behind the preview shell (fixed overlay); all
  preview assertions are scoped to `visitor-preview-content`.

## 9. Full NavTarget picker

`src/features/editor/components/NavigateToPicker.tsx` hosts the full
authoring picker (`NavTargetPicker`):

- Kind select: **page** (route table dropdown), **section** (page → section
  targets), **external** (URL input), **email**, **phone**, **back**.
- Writes a **typed `NavTarget`** into the click interaction (the durable
  model — unlike P22-E's picker, which wrote a resolved href string).
- Shows the resolved href (or "(unresolved)") via `navTargetToHref` so the
  author sees exactly what will render; unsafe external URLs are flagged.
- Wired into the **Interactions → Click → Navigate** inspector control.

## 10. Inspector architecture

- The P22-C inspector schema (`schemas.ts`) appends two **universal groups**
  to every element schema: **Animation** and **Interactions** (they sit last
  so the first section keeps its default-open behavior).
- `animationField()` / `interactionField()` are composite field definitions
  with `source: "animation" | "interaction"` routed through the existing
  field mutation path to `updateElementAnimation` /
  `updateElementInteraction`.
- `AnimationField.tsx` — trigger (`load`/`scroll`/`hover`/`click`), preset
  type, duration, delay, easing (bounded presets), clear.
- `InteractionField.tsx` — Click (navigate + full `NavTargetPicker`, or
  scroll-to + in-tree target select), Hover (color / background-color /
  scale / shadow), Focus (color / background-color / scale / shadow).
- All values pass the shared validated schemas before commit; clearing
  commits `null`.

## 11. Animation execution model

- **Load entrances** — inline `animation-*` properties (name `ba-<type>`,
  duration, delay, easing, iteration, direction, fill-mode `both`); the
  keyframes live in the tree `<style>`.
- **Scroll/viewport reveals** — element carries `data-ba-reveal=<id>`; the
  `IntersectionObserver` adds `ba-reveal-in`, which runs the injected
  `animation: <shorthand> both` rule. The from-state (opacity 0 / clip /
  transform) is the element's base style until revealed.
- **Hover/click-triggered animations** — pure CSS `:hover` / `:active` rules
  referencing the same keyframes (no JS).
- Keyframe presets are deterministic and **shared with export** via
  `keyframeStopsForType` / `keyframesCssForType`.

## 12. Interaction execution model

- **Click → navigate** — `resolveNavTarget(target, pages)` → safe href →
  real anchor in the preview/export; the preview shell intercepts internal
  routes; export renders a native anchor with the same route map.
- **Click → scroll-to** — resolved only when the target exists in the
  element's own tree; rendered as `<a href="#id">` + bounded
  `scrollElementIntoView`.
- **Back** — `href="#"` + inline handler calling `performClickAction`
  (window.history.back) in the preview.
- **Hover / focus** — allow-listed CSS rules (color/background/scale/
  shadow) with a shared transition; scale composes with geometry rotation
  via `--ba-ht` when needed.
- Deferred kinds never produce behavior (inert no-op).

## 13. Export emission

`src/features/export/generators/section-generators/custom-block-generator.ts`
emits, for a tree carrying animation/interaction data:

- the keyframes (`@keyframes ba-fade` etc.) and per-element hover/focus/
  trigger rules (the same rules the canvas injects);
- the reduced-motion guard
  (`prefers-reduced-motion: reduce { [data-ba-anim="load"] { animation: none
  !important } … }`);
- a **bounded runtime** (`baIsSafeNav`, `baScrollTo`, click resolution) that
  mirrors `present.ts` — no `eval`, no `new Function`, no raw user JS;
- the **route map** (`routes={"page-1":"/",…}`) so typed NavTargets resolve
  to the real exported routes;
- the serialized `animation` / `interaction` fields in the emitted page data
  (the page file passes the tree through).

The `export-build` gate compiles the generated site.

## 14. Reduced-motion behavior

- `presentTree` emits the guard only when a tree has an entrance animation.
- `[data-ba-anim="load"]` and `[data-ba-anim="scroll"]` get
  `animation: none !important` (scroll reveals also force `opacity: 1`) —
  the element is shown without the entrance effect.
- Hover/focus feedback is **not** removed (interaction feedback never
  carries critical functionality); `scrollElementIntoView` uses instant
  scrolling under `prefers-reduced-motion`.

## 15. Accessibility behavior

- Elements with a focus effect become keyboard-focusable (`tabIndex=0`) in
  the non-editable preview; the `:focus-visible` rule gives visible keyboard
  feedback.
- Scroll-to / back interactions render as `role="link"` with `tabIndex` and
  Enter-key handling, so they work without a mouse.
- Real navigation is a native `<a href>` (screen-reader friendly); layout
  containers are never wrapped in anchors.
- Text semantics of headings/paragraphs/buttons are preserved; no raw
  interactive chrome is added to the canvas editing surface.

## 16. Security / safe-navigation constraints

- `isSafeNavUrl` rejects `javascript:`, `vbscript:`, `data:text/html`; the
  existing `resolveNavTarget` marks unknown pages/sections `unresolved`
  (inert — never a dead or unsafe link).
- The renderer re-checks the resolved href against `isSafeNavUrl` before
  emitting an anchor (defense in depth — `present.ts`).
- Hover/focus color values and shadow tokens are allow-listed
  (`isSafeColorValue`, `hoverShadowToken`); animation durations/delays are
  clamped; easings are bounded presets.
- No `eval` / `new Function` / raw JS anywhere in the editor, preview, or
  export runtime (asserted in unit + E2E tests).
- `custom` animation type and all deferred action kinds are inert.

## 17. Responsive relationship

- P22-F viewport overrides and P22-G animation/interaction are **orthogonal
  additive fields on the same `ElementNode`**; both fold through
  `applyBlockPresentation` (geometry + viewport) and the same
  `custom-block-generator` (viewport fold + animation/interaction emission).
- No interaction between them is required in P22-G: an element can be
  animated at every viewport, and viewport overrides do not interact with
  animation timing.

## 18. Deferred interaction capabilities (explicit non-goals)

- `toggle`, `open-modal`, `submit-form`, `custom` handlers,
  `start-animation` — typed in the P22-A model but **inert** in P22-G.
- `sticky` / `parallax` scroll effects, timeline animation editor,
  cross-element animation orchestration, raw JavaScript execution, a second
  renderer/runtime, and any new dependency.

## 19. Why BlockRenderer was extended (instead of an ElementRenderer)

- `ElementNode extends BlockNode` with **optional** fields, so every
  `BlockNode` is structurally a valid `ElementNode` — the existing renderer
  already consumes the superset. A new `ElementRenderer` would be a parallel
  implementation with drift risk and no renderer benefit.
- The animation/interaction presentation is **additive**: trees without the
  fields render byte-for-byte as before (guard: `presentTree` is empty; no
  observer, no `<style>`, no wrappers).
- One renderer keeps canvas, visitor preview, and export parity by
  construction (the same present layer + the same node rendering logic).
- The master P22 architecture named `ElementRenderer` as the P22-B plan, but
  P22-B through P22-F already converged on extending `BlockRenderer` (see
  the P22-B/C decisions); P22-G stays on that established line.

## 20. Canvas ↔ preview ↔ export parity strategy

- **One pure resolution layer** (`present.ts`) produces the CSS/attributes/
  hrefs; the canvas and preview consume it in `BlockRenderer` (editable vs
  non-editable), and the export generator re-emits the same rules
  deterministically from the same model.
- The E2E spec asserts the three surfaces agree: canvas attributes/animations
  (`data-ba-anim`, `animation-name`, injected rules), visitor-preview DOM
  (real anchors, `href`s, tabIndex, focus-visible), and the exported ZIP
  (keyframes, reduced-motion guard, safe runtime, route map).

## 21. Testing architecture

- **Unit:** `elements/__tests__/present.test.ts` (resolution layer:
  keyframes, entrances, reveals, hover/focus rules, safe/unsafe navigation,
  reduced-motion guard), `elements/__tests__/element-schemas.test.ts` /
  `element-navigation.test.ts`, `editor/store/__tests__/editor-store-element-animation.test.ts`
  (store actions: schema rejection, no-op skip, one atomic entry, undo/redo,
  persistence round-trip), `code-import/__tests__/custom-block-p22g-persistence.test.ts`
  (durable schema round-trip), `collaboration/__tests__/tree-normalizer-p22g.test.ts`,
  `export/__tests__/custom-block-p22g-export.test.ts` (emitted code: keyframes,
  reduced motion, safe runtime, no eval).
- **Component:** `inspector/__tests__/AnimationInteractionFields.test.tsx`
  (the composite controls), `editor/components/__tests__/NavTargetPicker.test.tsx`
  + `NavigateToPicker.test.tsx` (the full picker).
- **E2E:** `e2e/interactions-animations.spec.ts` (6 tests — see the report):
  animation config + persist + render + export + reduced motion; hover +
  keyboard focus; click → page navigation via the picker; click → scroll-to;
  export emission; reduced-motion navigation + focus.

## 22. Dependencies on P22-A through P22-F

- **P22-A** — the element model, schemas, ops engine, and typed navigation
  foundations (consumed verbatim).
- **P22-B** — canvas selection + `commitElementTree`/`withHistory` store
  boundary (the two new store actions build on it).
- **P22-C** — universal inspector schema/capabilities/mutation path
  (Animation + Interactions groups extend it) and `applyBlockPresentation`.
- **P22-D** — element library + custom-block section surface (unchanged).
- **P22-E** — routing + page model (the NavTarget resolution reuses the
  route table; the P22-G picker supersedes the P22-E href-writing picker for
  interaction targets while P22-E stays for section link fields).
- **P22-F** — responsive engine + viewport overrides (orthogonal; the
  generator folds both).

## 23. Explicit statement

**P22-A through P22-F remain closed. P22-H has not been started.**
No previously shipped phase was reopened, refactored, or weakened; P22-G is
additive on the validated P22-A/B/C/D/E/F working tree.

---

**P22-G architecture complete. See `docs/phase-p22g-report.md` for
implementation + validation results.**
