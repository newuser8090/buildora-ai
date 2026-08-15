# Phase P22-B — Canvas Selection & Manipulation (Architecture)

> Buildora AI — Canva-style AI website builder. P22-B builds the interaction
> layer on top of the P22-A universal `ElementNode` model.

---

## 1. Objective

Turn every future Buildora element into a real visual element on the canvas:

```
SELECT → MOVE → RESIZE → ROTATE → ALIGN → REORDER → DUPLICATE → COPY/PASTE → DELETE
```

with proper undo/redo, without breaking the existing P16–P21 editor.

P22-B deliberately implements the **interaction foundation** only. The durable
element renderer (P22-C/D) and the Canva-style shell (P22-K) remain future
work.

---

## 2. Architecture overview

```
┌─────────────────────────────────────────────────────────────────────┐
│ CanvasManipulationLayer (mounted inside preview-content)            │
│   ├─ SelectionOverlay          (bounding box + handles + quick acts)│
│   ├─ useCanvasManipulation     (pointer → session → durable commit) │
│   ├─ useCanvasKeyboard         (Escape/Cmd+C/V/arrows, typing-guard)│
│   └─ canvas-interaction-store  (TRANSIENT: selection/session/clip)  │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ one commit per gesture
                           ▼
               commitElementTree (editor-store)
                           │
              withHistory → commitLocalProject
                           │
        existing persistence / collaboration / undo-redo pipeline
```

Three layers, each with a strict responsibility:

1. **Pure engine** (`src/features/canvas/engine/`) — deterministic,
   framework-independent math and tree operations. No React, no DOM, no store.
2. **Transient store** (`canvas-interaction-store`) — UI-only state: the
   current selection, the active drag session preview, the marquee, the
   internal clipboard buffer, and the snap toggle. **Never persisted.**
3. **Orchestration** (`hooks` + `components`) — converts pointers, runs
   sessions, and commits exactly one durable mutation per gesture through the
   existing editor store boundary.

---

## 3. Selection architecture (B1)

- Selection lives in the **transient** interaction store, keyed by stable
  element ids. It never mutates durable document state.
- **Hit-testing** (`hitTestElement`) walks the element tree and returns the
  **deepest** selectable element under the pointer — clicking a child never
  accidentally selects its parent.
- **Guards**: `hidden`/`invisible` elements are not pointer-selectable;
  `locked` elements MAY be selected but are excluded from manipulation
  (`splitManipulable`).
- **Self-cleaning**: `purgeSelection` drops ids that no longer exist, so
  selection cleans itself when elements disappear.
- **Sync**: the editor's section selection (existing `selectedSectionId`) is
  mirrored into the transient selection asynchronously (microtask) — the
  editor store stays the single durable source of truth.

## 4. Transform overlay (B2)

`SelectionOverlay` is a single, element-type-independent overlay:

- 8 resize handles (nw/n/ne/e/se/s/sw/w), a rotation handle, a move strip,
  a dimensions chip, and quick duplicate/delete actions.
- The container is `pointer-events: none`; only handles/buttons capture
  pointer events — element content stays fully interactive underneath.
- It is an editor-only overlay **around** the canonical renderer, never an
  alternate renderer (B15).

## 5. Coordinate system (B12)

`coords.ts` converts screen space ↔ logical canvas units:

```
logical = (client - frameOrigin) / scale + scroll
```

- `frameOrigin` is the `getBoundingClientRect()` of the scroll container
  (already scaled by the CSS transform).
- `scale = zoom / 100`; pointer deltas are divided by scale, so a drag at
  50%/100%/200% zoom produces the **same logical movement**.
- All values (clientX/Y, bounding rect, scroll offsets) are CSS pixels — no
  DPR factor is applied (regression-guarded by a dedicated test).
- The overlay is rendered inside the scaled frame, so CSS px == logical px
  and the frame transform scales the overlay with the content.

## 6. Transient vs durable interaction state (B3/B14)

- **Transient** (interaction store): pointer origin, session object, preview
  rects, marquee, clipboard buffer.
- **Durable** (element model): `ElementGeometry` (`mode/x/y/width/height/
  rotation/zIndex`) on `ElementNode`.
- During a drag, every `pointermove` computes a **preview** (cheap — no tree
  cloning) and publishes it to the transient store. `pointerup` builds ONE
  batch of `update-geometry` operations, applies them immutably through the
  engine, and commits the resulting tree **once** through
  `commitElementTree` → `withHistory` (one undo entry per gesture).
- Geometry is merged over the node's existing geometry (never clobbers
  untouched fields like `zIndex`).

## 7. Mutation / history integration

`commitElementTree(pageId, sectionId, tree)` is a new additive action on the
existing editor store:

- Materializes the element tree back through the P22-A section-block adapter
  and folds it with the **same atomic commit machinery** as
  `commitBlockTree` (`withHistory` + `commitLocalProject`).
- Custom-block sections persist the **whole tree including geometry** (the
  `geometry` field is additive on the custom-block node schema and survives
  the normalize → project → fold round-trip).
- Regular sections continue to fold only bound props (existing behavior);
  their geometry gains a durable home when the element renderer + tree
  persistence land in P22-C/D. **No existing mutation path was modified.**

No independent canvas-history system exists. Undo/redo remains the existing
`withHistory` pipeline.

## 8. Nested hierarchy handling (B16)

- The tree is never flattened. Layer ordering operates on **sibling order
  within each parent** (`buildLayerOps` groups by parent; root-level ordering
  remains page-level section ordering).
- `topLevelSelection` resolves multi-selections so each manipulation is
  applied once per branch (ancestor+descendant mixes collapse to the
  ancestor).
- Delete removes descendants; duplicate remaps every id (parent + children)
  so hierarchy stays intact.

## 9. Multi-selection (B6)

- Modifier-click toggles membership (`toggleSelection`); the set preserves
  order.
- The marquee engine (`beginMarquee`/`updateMarquee`/`endMarquee`) is
  store-ready and implemented in the hook; it activates for the element
  renderer surface. Current mount uses single-select (sections), so marquee
  is available but not yet surfaced in the UI — documented, not invented.
- Multi-move translates every selected rect by the same delta (relative
  positions preserved).

## 10. Snapping (B13)

- Pure, opt-in post-process: `snapRectToTargets` compares each rect's
  left/center/right (and top/center/bottom) to a target list and applies the
  smallest within-threshold correction.
- Targets: canvas frame edges/center + other elements' edges/centers
  (excluding dragged ids).
- Extensible abstraction (`SnapTarget`/`SnapOptions`) — later phases can add
  grid/guide providers or toggle snapping without touching the engine.
- **Fixed during review**: a candidate that did NOT snap could previously
  reset an accumulated snap (delta-0 overwrite) — now only real snaps compete.

## 11. Layer ordering (B8)

- `applyLayerAction` reorders a sibling list deterministically, preserving the
  relative order of the selected set (`front`/`back` process from the
  correct end).
- `buildLayerOps` emits scoped `move` ops in an order that stays correct under
  **sequential** application (back-most targets first when moving toward the
  end, front-most first when moving toward the start).

## 12. Copy / paste (B9)

- `copySelection` serializes a deep clone of the selected subtrees (roots +
  descendants), stripping `_`-prefixed internal adapter/collaboration keys.
- `parseClipboard` re-validates every node against `ElementNodeSchema`
  (bounded, versioned, capped at 200 elements) — hostile clipboard data is
  rejected at the boundary.
- Paste assigns **fresh ids to every node**, offsets geometry (default +24px),
  and merges the whole subtree **atomically** (single validated tree clone —
  never per-node insertion, which the engine cannot express for subtrees).
- Pasted elements never share mutable references with originals.

## 13. Delete / lock / hide (B10)

- Delete/Backspace maps to delete; `deleteElement` prunes descendants and
  keeps the tree valid; selection self-cleans.
- Locked elements cannot be moved/resized/rotated/duplicated/deleted through
  the manipulation layer (engine-level `ELEMENT_LOCKED` errors).
- Hidden elements are excluded from pointer hit-testing.

## 14. Keyboard controls (B11)

`useCanvasKeyboard` matches events through a pure `matchCanvasShortcut`:

- Delete/Backspace → delete, Cmd/Ctrl+D → duplicate, Cmd/Ctrl+C → copy,
  Cmd/Ctrl+V → paste, Escape → deselect, arrows → nudge (Shift+Arrow = 10px).
- **Typing guard** (`isTypingTarget`, duck-typed `matches`/`closest`) is
  environment-safe and suppresses every canvas shortcut inside
  inputs/textareas/contenteditable — inline text editing keeps normal
  keyboard behavior.
- Collision policy with the existing section-level shortcuts: the current
  mount wires **Escape / Cmd+C / Cmd+V / arrows only**; Delete and Cmd+D
  remain the existing section shortcuts (no double handling).

## 15. Performance strategy (B18)

- `pointermove` never clones the tree: previews are computed from the session
  (start rects + delta) and published as transient state.
- One immutable batch application + one `commitElementTree` per gesture.
- Full-tree cloning is confined to the commit (once per gesture) — the
  documented O(n) cost of the P22-A engine, unchanged.
- Selection/overlay updates are cheap React state updates on transient data.

## 16. Security / safety (B19)

- No custom code execution, no raw HTML — geometry/interaction state is
  validated (`ElementGeometrySchema`) before entering durable state.
- Custom-block `geometry` is bounded/finite (|x/y/w/h| ≤ 10000, rotation
  ±3600, zIndex ±1000) and rejected when malformed at the persistence
  boundary.
- Clipboard payloads are versioned, capped, and re-validated on read.
- No new network surface; no auth/RLS/rate-limit/header behavior touched.

## 17. Compatibility guarantees

- **P16 collaboration**: the transient store is never synchronized; durable
  element mutations pass only through the existing store boundary.
- **P17 persistence**: autosave/recovery/version-history continue to operate
  on the durable project; nothing new is persisted except the optional
  additive `geometry` field on custom-block nodes.
- **P18–P21**: no changes to auth, RLS, rate limits, security headers,
  logging, publishing, or guided mode. All existing test ids remain.
- Existing custom-block trees **without** geometry still validate (the field
  is optional).

## 18. Explicitly deferred (P22-C+)

- Durable geometry for regular (non-custom-block) sections — requires the
  element renderer + tree persistence.
- Universal inspector UI (typography/colors/spacing) — P22-C.
- Element library drag-and-drop — P22-D.
- Responsive visual editor — P22-F.
- Animations / interactions UI — P22-G.
- AI element editing — P22-H.
- Full Canva-style shell polish — P22-K.

---

**P22-B architecture complete. P22-C NOT started.**
