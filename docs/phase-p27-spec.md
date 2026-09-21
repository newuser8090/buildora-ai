# Phase P27 — Canvas Multi-Selection, Marquee & Smart Snapping

**Type:** Formal specification (design record, written before implementation).
**Anchored on:** `PROJECT_FULL_CONTEXT.md` + `docs/phase-p24c-report.md` + `docs/phase-p25-report.md` (commit `c3ca4fb`) + `docs/phase-p26-report.md` (commit `293d713`).
**Branch:** `phase-p22-canva-elements`.
**Status:** `SPECIFICATION — awaiting review`. Nothing in this document is implemented. **This document modifies no source file and no test file.**
**Provenance:** Every symbol, line reference and behaviour below was verified by reading the working tree at `293d713` (post-P26-closeout HEAD). Items that are inference rather than verified fact are explicitly marked **[inference]**.

---

## 0. Why this phase exists

P26 closed the AI-side debt: the copilot now targets and edits any element on a section that owns an
element surface, writing durably through the shared `prepareDurableSectionCommit`. But the P25 closeout
recorded the manipulation-side remainder of its OQ-4 decision, verbatim from `docs/phase-p25-report.md` §7
item 8:

> **Multi-element / marquee overlay** — the overlay is single-target; a multi-selection falls back to the
> section container. Per-element outlines and marquee-over-element-rects remain open (OQ-4 remainder).

The gap is concrete and verified at `293d713`:

- **The marquee is engine/store-ready but unreachable.** `useCanvasManipulation.ts` exports
  `handleMarqueeStart/Move/End` (`:213-260`) and the interaction store has a full marquee lifecycle
  (`beginMarquee`/`updateMarquee`/`endMarquee`, `canvas-interaction-store.ts:111-114`) — but
  `CanvasManipulationLayer.tsx` never calls any of the three: its pointerdown producer (P25 D3) either
  focuses one nested element or mirrors the section root. `grep -rn "handleMarquee" src/components/editor/`
  returns nothing. The user cannot start a marquee with the pointer.
- **The overlay is single-target by construction.** `CanvasManipulationLayer.tsx:311` computes
  `targetId = nestedSelectionId ?? selectedSectionId`, and `singleNestedSelectionId` (`selection.ts:132`)
  deliberately resolves `null` for any multi-selection ("multi-element inspector routing is an open
  decision"), so a multi-set frames the section container, not the selected elements. No composite box
  exists.
- **Multi-drag already half-works, unsafely.** `handleMoveStart` (`useCanvasManipulation.ts:66`) builds
  `startRects` for **every** selected id — including locked and ancestor ids — and `endSession`
  (`:180-212`) commits a geometry patch for each of them in one entry. Nothing applies `topLevelSelection`
  (`selection.ts:155`), `splitManipulable` (`selection.ts:170`) or `selectionHasLocked` (`selection.ts:163`)
  — the engines the P22-B header explicitly names for manipulation resolution — so a selection mixing a
  container and its child would double-move the child, and locked elements would move. No test pins any of
  this.
- **Snapping is silent.** `snapRectToTargets` (`snap.ts:72`) already returns `match` "for guide rendering
  later" — that later never arrived. No guide visual exists anywhere in the canvas feature.

P27 is the phase that pays this: **marquee over element rects, a composite overlay for the multi-set,
batch transforms that resolve the selection correctly, and visible smart-snap guides.**

**Naming note (honest derivation):** no roadmap document defines a "P27". The only forward-looking
statement motivating this scope is the P25 §7 item 8 follow-up above. This document is the **first**
artifact to name P27; only the filename and heading change if the project prefers a different label.

---

## 1. Objective & boundaries

### 1.1 Objective (one sentence)

Extend the canvas manipulation pipeline from single-element targeting to **multi-element selection within
the active section** — marquee hit-testing over nested element rects, a composite overlay, batch geometry
commits as ONE history entry, and rAF-throttled snap guide rendering during drags — without a new store,
a new durable field, a new commit path, or any regression to the P22-B/P22-C/P25/P26 single-element and
section-level contracts.

### 1.2 In scope

| # | Scope item | Anchor |
|---|---|---|
| S1 | **Marquee selection over elements.** A drag-marquee on the section content hit-tests `[data-element-id]` / `[data-block-id]` rects of the active section's tree, writing the hit set into `useCanvasInteractionStore.selection.ids`. | `src/features/canvas/engine/selection.ts`, `hooks/useCanvasManipulation.ts:213-260`, `components/CanvasManipulationLayer.tsx` |
| S2 | **Multi-selection bounding box.** `SelectionOverlay` renders a unified composite bounding box when multiple sibling elements are selected. | `src/features/canvas/components/SelectionOverlay.tsx`, `engine/geometry.ts:138` (`boundingBox`) |
| S3 | **Batch manipulation.** Multi-selected elements move collectively; the gesture resolves the selection (top-level, unlocked) and commits geometry updates through the section's commit boundary (`commitSectionTree` / `commitElementTree` — see D3) as a single history entry via `withHistory`. | `hooks/useCanvasManipulation.ts`, `engine/transform.ts:66` (`beginMove`), `engine/selection.ts:155` (`topLevelSelection`), `editor-store.ts` (`withHistory:405`) |
| S4 | **Visual alignment guides.** Dynamic snap lines (center, edges) render on `CanvasManipulationLayer` from `snapRectToTargets`' existing `match` result and the target lists, during active dragging. | `engine/snap.ts:72-128`, `components/CanvasManipulationLayer.tsx` (new guide visual) |
| S5 | Unit + component tests covering marquee rect intersection, composite box math, batch geometry deltas, snap thresholds, overlay multi-selection rendering and snap-line rendering. | §6 |
| S6 | Preserve every P22-B/P22-C/P22-H/P24/P25/P26 invariant unchanged. | §5 |

### 1.3 Out of scope (explicit non-goals)

1. **No cross-section multi-selection.** Selection remains bounded to elements within the **active
   section**; a marquee/hit set that crosses a section boundary is filtered to the active section. The P25
   D3 producer is section-scoped by construction and stays that way.
2. **No freeform absolute/flow layout switching.** `ElementGeometry.mode` (`"flow" | "absolute"`) semantics
   are frozen; P27 moves elements that already have absolute geometry and does **not** convert flow-mode
   elements to absolute as a side effect of selection (see D4 for the precise rule).
3. **No CRDT bridge changes.** `collab-doc.ts` is a generic JSON↔Yjs bridge; selection is transient and
   never enters the bridge. `tree-normalizer.ts` is untouched.
4. **No schema/version change.** `formatVersion: 3` (`persistence/constants.ts:21`), `DATABASE_VERSION = 9`
   (`:101`), every persistence/generation schema, the export pipeline, the sandbox capability model and the
   capsule caps are frozen inputs.
5. **No new durable field, no new store, no new commit path.** The transient interaction store gains state
   (see D2) but no durable surface changes. `commitSectionTree`/`commitElementTree` remain the only write
   boundaries.
6. **No AI-plan surface change.** `plan-schemas.ts`, `plan-simulator.ts` and the copilot are frozen; P27 is
   a gesture-layer phase.
7. **No inspector multi-targeting.** `singleNestedSelectionId` keeps its current contract (multi-selection
   → `null`, section root → `null`); the inspector keeps routing on single nested selections and section
   roots only. Widening inspector routing is an explicit open question (OQ-4).
8. **No marquee-to-AI targeting.** The AI element target (`resolveElementEditTarget`) requires a single
   selection and keeps that requirement; a multi-selection yields no AI element target (fail-closed,
   REQ-14 of P26 preserved).

---

## 2. Verified current state — the P22-B canvas baseline (and its P25/P26 additions)

### 2.1 What already exists

| Capability | Where | Verified behaviour |
|---|---|---|
| Selection state model | `selection.ts` (`SelectionState`, `selectOnly`, `toggleSelection`, `addToSelection`, `removeFromSelection`, `purgeSelection`) | Additive multi-selection with order preservation; `multi` flag; self-cleaning via `purgeSelection`. |
| Multi-selection resolution engines | `selection.ts:155` (`topLevelSelection`), `:163` (`selectionHasLocked`), `:170` (`singleNestedSelectionId` + `splitManipulable`) | Top-level-of-set resolution, locked detection, manipulable/locked split — **all exist, all untested against the gesture layer, none consulted by the gesture layer.** |
| Hit testing | `selection.ts:52` (`hitTestElement`, deepest-hit-wins) | Point hit-testing exists for P25's producer; rect hit-testing exists only as the marquee's inline overlap check in `handleMarqueeEnd`. |
| Marquee engine + store | `useCanvasManipulation.ts:213-260`, `canvas-interaction-store.ts:111-114` (`beginMarquee`/`updateMarquee`/`endMarquee`) | Store lifecycle + engine methods exist and are store-tested (`canvas-interaction-store.test.ts`); **no UI caller** — the layer never invokes them. |
| Single-element targeting | `CanvasManipulationLayer.tsx:303-309` (`nestedSelectionId`), `:311` (`targetId`) | `singleNestedSelectionId(tree, selectionIds) ?? singleNestedSelectionId(tree, anchorId ? [anchorId] : [])`; multi-set → section root. |
| Overlay | `SelectionOverlay.tsx` | Bounding box + 8 resize handles + rotation handle + move strip + dims chip + quick actions; `data-testid="canvas-selection-box"`; rendered only when `displayedRect` is non-null. |
| Transform sessions | `transform.ts` (`beginMove:66`, `beginResize:83`, `beginRotate:103`, `updateTransform:127`) | Session = transient state in the interaction store; `updateTransform` computes preview rects per pointermove (no cloning); `buildGeometryOps:230` merges patches over existing geometry without clobbering `zIndex`/`mode`. |
| Batch apply + commit | `batch.ts` (`applyElementOpBatch`), `useCanvasManipulation.ts:180-212` (`endSession`) | Ops applied sequentially over the validated engine; on success the caller commits the tree once — ONE history entry per gesture. |
| Snapping math | `snap.ts` (`snapValue:52`, `snapRectToTargets:72`, `canvasSnapTargets:118`, `elementSnapTargets:130`) | Threshold 8 logical px (`DEFAULT_SNAP_OPTIONS`); candidates are left/center/right × top/center/bottom; `SnapResult.match` is produced for guide rendering "later" and currently discarded. |
| Alignment math | `align.ts` (`alignRect:24`, `alignRects:43`, `distributeRects:57`, `buildAlignOps:98`, `buildDistributeOps:113`) | Multi-select align/distribute exists as geometry ops (relative to the selection's own bounding box) — currently **unreachable** from the canvas UI (no caller passes a multi-set). [inference on reachability — no UI caller was found for `buildAlignOps`] |
| Interaction store | `canvas-interaction-store.ts` | Transient: `selection`, `session`, `previewRects`, `marquee`, `clipboard`, `snapEnabled`, `manipulationEnabled`. Explicitly never persisted, never synchronized. |
| Commit boundary | `editor-store.ts` (`withHistory:405`, `commitSectionTree`, `commitElementTree`, `prepareSectionTreeCommit:525`) | ONE `withHistory` entry per commit; no-op detection via key-order-insensitive deep equality; shared durable preparation (P26). |
| Coordinate conversion | `coords.ts` (`clientToCanvas:32`) | Screen → logical units, zoom/scroll-aware; the marquee and gestures already operate in logical units. |

### 2.2 Findings that shape the design (all verified)

**F1 — The marquee exists but has no UI trigger, and its hit-set is unfiltered.**
`handleMarqueeEnd` (`useCanvasManipulation.ts:226-260`) intersects the marquee rect against
`contextRef.current.rects()` — which `measureRects` populates with **every section container plus the
single focused element** (`CanvasManipulationLayer.tsx:262-283`) — and writes the hit ids to selection with
`{ multi: true }`. Two defects: (a) nothing ever calls `handleMarqueeStart`, so a user cannot marquee; (b)
even if they could, the hit set can contain **section container ids** (not just elements), and nothing
filters to the active section's tree, so a marquee could select ids that `singleNestedSelectionId` would
later reject and the overlay would frame the section root. REQ-1 must fix both: wire the trigger and make
the hit-set a tree-validated, section-scoped element set.

**F2 — The gesture layer ignores the selection-resolution engines.**
`handleMoveStart` (`useCanvasManipulation.ts:66-83`) iterates `store.selection.ids` raw. Nothing applies
`topLevelSelection` (ancestor/descendant dedup — a selected container + its child would otherwise apply the
move twice to the child, since the child's rect is derived from the container's), `splitManipulable` /
`selectionHasLocked` (a locked element must never be moved by a batch gesture). The P22-B module header
names these engines as the manipulation contract; the gesture layer must actually consult them (REQ-3).

**F3 — The overlay is single-target and renders at most one box.**
`displayedRect` (`CanvasManipulationLayer.tsx:311-313`) resolves **one** rect for **one** `targetId`. A
multi-selection falls through to the section container box — the user sees a box around the whole section
while `selection.ids` holds three elements. S2's composite box must be additive: single nested selection
keeps the P25 element-targeted box byte-for-byte (REQ-8), and a multi-set renders a NEW composite box.

**F4 — Snap matches are computed then thrown away.**
`snapRectToTargets` returns `match?: { axis, value, kind }` explicitly "for guide rendering later"
(`snap.ts:37`). `driveSession` (`useCanvasManipulation.ts:118-160`) calls it per dragged rect per move and
keeps only the snapped rects. The guide feature is a rendering of data that already exists (REQ-4), plus a
decision about which match wins when multiple rects snap simultaneously (D5).

**F5 — No rAF throttling exists in the canvas feature.**
`grep -rn "requestAnimationFrame" src/features/canvas/` returns **0 matches**. `PROJECT_FULL_CONTEXT.md`
§1.2 claims "pointer events with rAF throttling" — that claim is **not true of the current tree** (it may
have described an earlier design). Pointer moves currently hit `driveSession` → `updateTransform` →
`updateSession` on every `pointermove` event. This phase must NOT regress the existing behaviour and must
add throttling where the spec names it (Invariant 4 / REQ-9). Honest note: this is an improvement over
today's behaviour, not a regression fix.

**F6 — The interaction store documents marquee, multi-selection and clipboard as first-class.**
The store header (`canvas-interaction-store.ts:1-16`) lists "the marquee (selection rectangle) in
progress" and multi-select-capable `selection` as owned state. P27 is the phase that makes the UI honour
the store's own contract.

**F7 — `measureRects` measures only the focused element, not all elements.**
`CanvasManipulationLayer.tsx:262-283` measures every section container plus **only** `nestedSelectionId`'s
node. A marquee needs rects for **all** selectable elements of the active section's tree. S1 must widen
measurement to all `[data-element-id]`/`[data-block-id]` nodes within the section container — bounded by
the tree normalizer's own caps (nodes ≤ 1,000) — or the marquee cannot intersect anything (see D2's
measurement gate).

**F8 — `commitElementTree` is the current commit call, and `commitSectionTree` is byte-identical.**
`CanvasManipulationLayer.tsx:291-296` commits via `commitElementTree`; P26 extracted the shared
`prepareDurableSectionCommit` so both commit functions prepare identically. The task brief names
`commitSectionTree` as the batch commit boundary; this spec requires **one** of the two existing boundaries
— not a new path — and records the choice as OQ-2 (§3 D3).

---

## 3. Design decisions

### D1 — Marquee hit-testing is a pure engine function over measured rects, validated against the tree

`handleMarqueeEnd`'s inline overlap loop is extracted into a pure, deterministic engine function
(`selection.ts`), so it is unit-testable in isolation:

```
marqueeHitTest(
  tree: ElementTree,
  marqueeRect: ElementRect,
  rects: Record<string, ElementRect>,
): string[]
```

Requirements:
- **Tree-validated, section-scoped:** a candidate id must exist in `tree.nodes`, must not be a root id
  (root ids are section-level), and must satisfy `isPointerSelectable(node)`. The caller passes the active
  section's tree, so cross-section ids cannot enter the set by construction.
- **Full containment rule.** An element is hit when the element rect is fully contained by the marquee
  rect (standard design-tool behaviour: partial overlap does not select). [inference: containment vs
  intersection is a product decision; containment is proposed because F1's current implementation is
  intersection, and intersection over a "select what you touch" rule makes accidental container-ish
  selections likely. Pinned as OQ-1.]
- **Top-level resolution is NOT applied here.** The marquee returns all contained selectable ids;
  `topLevelSelection` is applied at manipulation time (D3), so display selection keeps every element
  highlighted while manipulation moves each branch once. [inference on display-vs-manipulation split;
  pinned in OQ-1.]
- Locked elements are included in the marquee result (selectable per P22-B rules) but are excluded from
  manipulation (D3) — matching `isPointerSelectable`/`isManipulable` semantics.

### D1b — Modifier-click multi-selection

The P25 producer (`CanvasManipulationLayer.tsx:319+`) replaces the selection on every click. P27 extends
it: with Shift (or Ctrl/Cmd — OQ-1) held, the producer toggles the hit element id via the store's
`toggleSelect(id)` (`canvas-interaction-store.ts`), preserving order, and keeps the anchor semantics of
`beginMarquee` (anchor cleared on marquee, set on click). Locked elements are toggle-selectable; section
roots and custom-block clicks keep the frozen P25 contract (the producer's exclusions are unchanged).

### D1c — Marquee visual

The transient `marquee` state (`MarqueeState { start, current }`) gets a rendered rectangle: a dashed
outline + translucent fill overlay rendered by `CanvasManipulationLayer` (pointer-events:none) while
`marquee !== null`. Present today only as unrendered store state; this makes the gesture legible to the
user. [inference: visual style is a product choice; behaviour requirement is that the marquee rect is
visible while dragging and disappears on release.]

### D2 — Measurement widens to all selectable elements, gated to manipulation-enabled sections

`measureRects` is extended: when the active section is manipulation-enabled (`isCustomBlock ||
durableTreeEnablesCustomCode(section)` — the P25 D6 gate, unchanged), it measures **every**
`[data-element-id]`/`[data-block-id]` node inside the section container (plus the section containers
themselves, unchanged, so snap targets still work), keyed by element id.

- **Measurement gate rationale:** the P25 tree path renders element nodes only for durable trees /
  custom-block; measuring nodes that never render would produce a silent empty set. The gate keeps
  marquee/multi-targeting available exactly where the canvas renders and manipulates elements.
- **Custom-block nuance:** the P25 producer excludes legacy `custom-block` from the nested-write contract
  (frozen canvas click contract). P27 **keeps that exclusion for producer writes** (D1b) — but the
  measurement widening means a custom-block's element nodes ARE measured. Whether custom-block participates
  in marquee at all is pinned as **OQ-5**; the conservative default is: marquee is available wherever the
  P25 tree path renders element nodes (durable sections), and custom-block keeps its frozen single-target
  behaviour. The conservative default is proposed; the implementer must not silently widen it.
- Boundedness: node count is clamped by `normalizeElementTree` (≤ 1,000 nodes); measurement is per-frame
  DOM work and runs inside the rAF loop (D6), not per React render.

### D3 — Batch manipulation resolves the selection before building ops

The gesture layer finally consults the P22-B resolution engines, in this order:

1. `topLevelSelection(tree, selection.ids)` — one move per branch (a selected container + its selected
   child no longer double-moves the child).
2. `splitManipulable(tree, ids)` / `selectionHasLocked` — locked elements are excluded from the session;
   a selection that is **entirely** locked starts no session (fail-closed, structured no-op).
3. The resolved id list feeds `beginMove` (`transform.ts:66`) exactly as single-selection does today;
   `updateTransform` and `buildGeometryOps` are unchanged — they already handle N rects.
4. Resize/rotate remain single-target only (the composite box has no resize handles — see D7); a multi-set
   exposes **move** (drag from the composite box or from any selected element) and keyboard nudge;
   resize/rotate handles render only for a single-element selection. [inference: multi-resize is a real
   product feature deferred here to keep the phase bounded; pinned as OQ-3.]

### D3b — Batch geometry deltas are computed per-element from start rects

Batch move math stays in `updateTransform`'s move arm: every element's preview rect = its own start rect +
the shared pointer delta (no re-derivation from bounding box; no re-layout). The commit path is unchanged:
`endSession` rebuilds the geometry patch from final preview rects → `buildGeometryOps` (merge-over-existing,
no clobber of `mode`/`zIndex`) → `applyElementOpBatch` (sequential, fail-closed) → ONE commit.

**Commit boundary:** the layer currently commits via `commitElementTree` (`CanvasManipulationLayer.tsx:291-296`).
The brief names `commitSectionTree`; the two are behaviourally identical at `293d713` (P26 extracted the
shared `prepareDurableSectionCommit`), so P27 keeps the existing `commitElementTree` call — **the
requirement is "ONE of the two existing boundaries, ONE history entry"**, not a switch. Recorded as OQ-2.

### D4 — Geometry mode rule: move absolute; do not convert flow→absolute as a side effect

`buildGeometryOps` merges patches over the node's existing geometry (existing `mode` wins unless the patch
sets it). Multi-move commits `{ mode: "absolute", x, y, width, height }` patches — for elements that are
already absolute this is today's behaviour. For a **flow-mode** element with no `x/y`, an absolute patch
would take it out of flow, which out-of-scope item 2 forbids as a side effect. Rule:

- Elements already in `mode: "absolute"`: move commits x/y (today's behaviour, extended to N elements).
- Elements in `mode: "flow"` (or modeless): **excluded from batch move sessions** by default. [inference:
  flow-mode movement requires the layout-shift machinery that P22-B deliberately deferred; the alternative
  — converting flow elements to absolute on first drag — is a silent layout-mode conversion, which
  out-of-scope item 2 forbids. The implementer may instead translate flow elements via `x/y` deltas
  interpreted as offsets — pinned as OQ-6.]
- The interaction store's `manipulationEnabled` flag is not widened; the gate stays the P25 D6
  export-aligned predicate.

### D5 — Snap guides render from the existing `SnapResult.match` + target lists

The guide visual is a pure function of data that already exists:

- `snapRectToTargets` already returns `match: { axis, value, kind }` — the winning snap per rect.
- `elementSnapTargets`/`canvasSnapTargets` already produce the target lists; the guide needs to know
  **which target** matched, so `elementSnapTargets` is extended to return target values **with provenance**
  (the source rect id and edge/center kind) — an additive, backwards-compatible shape
  (`SnapTargetDescriptor { value, axis, sourceId, kind }`), so the guide can draw the line at the matched
  value across the section content area.
- **Multi-rect resolution (the decision):** when multiple elements snap on the same move, the guide shows
  the match of the **dragged set's bounding box** only — not per-element lines. The composite box's edges/
  center become the snap candidates (replacing per-element candidates during a multi-drag), which is both
  the standard design-tool behaviour and the cheapest: one match per axis per frame. Per-element matches
  during a multi-drag are explicitly out of scope.
  [inference on the bounding-box-candidates rule; pinned as OQ-1c.]
- Guides render as absolutely-positioned 1px lines on `CanvasManipulation`'s overlay plane
  (pointer-events:none) inside the scaled frame, at the matched `value` along `axis`, spanning the section
  content bounds, only while `session.kind === "move"` and `snapped === true`. They are transient UI —
  same plane as the marquee rectangle (D1c), never persisted.
- The store gains no new actions for guides; the guide data lives in component state updated inside the
  rAF loop (D6), or — if the implementer prefers store flow — as a new transient key written by
  `driveSession` and cleared by `endSession`/`cancelSession`. [inference: component state vs store key is
  an implementation choice; the invariant is that guides clear when the session ends or is cancelled.]

### D6 — Performance: rAF-throttled pointer-move processing

`useCanvasManipulation` currently processes every `pointermove` (F5). P27 adds rAF coalescing:

- Pointer moves coalesce into at most one `driveSession`/marquee update per animation frame; trailing
  state is processed on the next frame, and session end processes the final pointer position (no lost
  final frame).
- Scope: gesture + marquee drive paths only. The commit path (pointerup) is unaffected.
- This is the mechanism that keeps multi-element drags at 60fps with N preview rects per frame (Invariant
  4 / REQ-9) — and unlike F5's claim, it is net-new work, not a preservation obligation.
- Full page re-render avoidance (Invariant 4): preview rects flow only to the overlay plane
  (`SelectionOverlay` + guides + marquee visual) — the same subscriber pattern the current single-element
  flow uses (`previewRects` → `displayedRect` → overlay). P27 adds no subscriber to the editor store during
  a gesture; the editor store is written once at commit.

### D7 — Composite bounding box (overlay)

`SelectionOverlay` stays a dumb, memoized renderer; composition math lives in the engine:

- New pure function `compositeSelectionBox(rects: ElementRect[]): ElementRect` — for siblings this is
  `boundingBox` (`geometry.ts:138`); the function exists to give the overlay a named, testable entry point
  and a place to evolve (e.g. rotation-aware union later). [inference: a named wrapper over `boundingBox`
  is chosen so tests pin the semantic, not the primitive.]
- Rendering rules:
  - **1 element:** today's box byte-for-byte (handles, dims chip, quick actions, move strip) — REQ-8.
  - **≥2 elements (all in the active section):** ONE composite box at the union rect: outline + move
    affordance + dims chip (of the union) + a count badge (e.g. "3 selected") [inference on the badge —
    pinned as OQ-1b]. **No resize handles, no rotation handle.** Quick actions: duplicate/delete for the
    set are IN scope for the box chrome [inference — pinned as OQ-3]; destructive confirm gating follows
    the existing section-level gates.
  - **Mixed locked selection:** the composite box renders; the move affordance is disabled when
    `selectionHasLocked` (visual parity with the existing `manipulable` gate).
  - The composite box commits its move through the same session pipeline (D3) — it is a move affordance,
    not a separate commit path.
- Per-element individual outlines during a multi-selection are OUT of scope (P25 §7 item 8's "per-element
  outlines" remainder stays open, recorded in §9) — the composite box is the only overlay in a multi-set.
  [inference: deferring per-element outlines keeps the phase bounded; recorded as OQ-7.]

### D7b — Target resolution for the overlay plane

`targetId` resolution becomes explicit about the three cases (replacing the implicit `??` chain):

```
single nested id → element box (unchanged, P25 contract)
multi-set (≥2)   → composite box (D7)
empty/stale set  → section-root box (unchanged, P22-B contract)
```

`singleNestedSelectionId` is NOT modified — its multi → `null` contract is load-bearing for the inspector
and the AI target (out-of-scope item 7/8). The overlay layer resolves the multi case itself by consulting
`selection.ids` (after tree validation + `purgeSelection`), so stale ids from another section can never
frame a composite box.

---

## 4. Detailed requirements

| ID | Requirement |
|---|---|
| **REQ-1** | A drag-marquee on the section content produces a tree-validated, section-scoped element selection in `useCanvasInteractionStore.selection.ids`; the hit-set contains no section root ids, no ids absent from the active section's tree, and no hidden/invisible elements. A marquee with zero hits clears the selection (or keeps it — OQ-1). |
| **REQ-2** | The marquee rectangle is visible during the drag and disappears on release; the marquee state remains transient (never persisted, never history, never a new editor-store key). |
| **REQ-3** | Batch move resolves the selection through `topLevelSelection` + `splitManipulable`/`selectionHasLocked` before starting a session; locked elements are never moved; an entirely-locked selection starts no session. |
| **REQ-4** | Snap guides render only while a move session is active and a snap match exists, at the matched value/axis, spanning the section content area; guides clear on session end/cancel; no guide state is durable. |
| **REQ-5** | Composite box math is exact: the union of the selected elements' measured rects, computed per frame from `previewRects` during a drag and from measured rects at rest. |
| **REQ-6** | A multi-element move commits through an existing store commit boundary (`commitElementTree`/`commitSectionTree`) as exactly ONE `withHistory` entry regardless of element count; undo restores every element exactly; collab and autosave behave as for any other durable edit. |
| **REQ-6b** | Batch geometry deltas are computed from each element's own start rect + the shared pointer delta; no element's geometry is derived from another's; `buildGeometryOps`' merge-over-existing contract (never clobber `mode`/`zIndex`) is preserved. |
| **REQ-7** | Snap threshold semantics are unchanged (8 logical px, `DEFAULT_SNAP_OPTIONS`); the toggle (`setSnapEnabled`) disables snapping AND hides guides; the snap toggle disables both for single- and multi-drag alike. |
| **REQ-8** | Single-element selection: the P25 element-targeted overlay contract is byte-identical (box, handles, dims chip, quick actions, `data-testid` surface, gesture commit path). |
| **REQ-8b** | Section-root selection: the P22-B section box is byte-identical, including the P25 D3 producer precedence and the P26 element-target resolver precedence (canvas → inspector → root). |
| **REQ-9** | Gesture + marquee pointer-move processing is coalesced to one update per animation frame (rAF); the final pointer position is processed on session end; no full page re-render occurs during a gesture (no editor-store write until commit). |
| **REQ-10** | No regression to section-level selection/canvas flows: `element-inspector`, `element-library`, `responsive-engine`, `canvas-selection`, `custom-code-authoring`, `custom-code-export` E2E specs stay green. |
| **REQ-10b** | No regression to P26's AI element targeting: a multi-selection resolves no AI element target (`resolveElementEditTarget` unchanged, fail-closed on multi). |
| **REQ-11** | Selection (single or multi), sessions, marquee and guides remain transient: zero durable document schema pollution; `serializeProject()` is byte-identical before/after any P27 gesture. |
| **REQ-11b** | `formatVersion: 3`, `DATABASE_VERSION = 9`, all persistence/generation schemas, the export pipeline and the sandbox are unchanged. |
| **REQ-12** | The gesture surface's own chrome never rewrites the selection it operates on (the P25 overlay-chrome exclusion is preserved; the marquee/guide visuals are pointer-events:none). |
| **REQ-13** | Fail-closed: an absent tree, an empty selection, a stale id (purged), an unmeasurable rect, or a failed batch apply never throws and never commits a partial batch (`applyElementOpBatch`'s stop-at-first-failure contract is preserved). |
| **REQ-14** | Legacy `custom-block` canvas click contract (P25 §2.4, `f9cb315`) is unregressed: producer writes for custom-block remain section-level, per the OQ-5 resolution. |
| **REQ-15** | The guide/marquee visuals are editor-only (mounted inside `CanvasManipulationLayer`), never rendered on preview/share/thumbnail/export surfaces. |
| **REQ-16** | The transient store may gain new transient keys (guides, marquee visual helpers) but no new durable surface; `reset()` clears everything P27 adds. `reset()` clears them — every new transient key MUST be cleared by `reset()`. |

---

## 5. Invariants (must hold at every commit in this phase)

| Invariant | Why it must hold |
|---|---|
| **Transient multi-selection (Invariant 1)** | Selection, marquee, sessions and guides live ONLY in `useCanvasInteractionStore` (and ephemeral component state); never in the editor store, never persisted, never synchronized, never history. Zero durable document schema pollution: `serializeProject()` is byte-identical after any gesture; no `selectedElementIds`-style key enters the editor store. |
| **One history entry per batch gesture (Invariant 2)** | The batch is built on the transient side, applied via `applyElementOpBatch` (pure, validated), and committed ONCE through the existing store boundary → one `withHistory` entry regardless of element count. No nested history, no second commit path (P26's D7 composition, now applied to gestures). |
| **Single-element + section contracts unregressed (Invariant 3)** | The P25 element box, the P22-B section box, the P25 D3 producer precedence and microtask re-read, the P26 AI target resolution, and the frozen `custom-block` click contract all behave byte-for-byte as at `293d713` (REQ-8/8b/10/14). |
| **60fps gestures, no full page re-renders (Invariant 4 / REQ-9)** | Pointer-move processing is rAF-coalesced; preview state flows only to the overlay plane; the editor store is written once per gesture at commit. Snap math is O(targets) per frame with target lists precomputed per session (not per move) [inference on target-list caching; see OQ-8]. |
| **Single materialization entry** | `sectionToElementTree` stays the only section→tree entry; `reconcileDurableTreeWithProps` stays active; measurement reads DOM, math reads the tree — the tree is never re-derived from rects. |
| **Plan purity analog for gestures** | Preview math never mutates the tree; `updateTransform` computes rects without cloning; `buildGeometryOps` + `applyElementOpBatch` are pure; the tree is written only at commit. |
| **Non-gesture surfaces frozen** | Export, preview, share, thumbnails, AI plans, persistence — untouched (§1.3). |
| **Shared predicate discipline** | The manipulation/marquee gate is `isCustomBlock || durableTreeEnablesCustomCode(section)` — the same predicate P25's handle gate uses; no private re-implementation. |

---

## 6. Test & verification strategy

### 6.1 Targeted unit tests (Vitest, `testTimeout: 10_000`)

| Suite | What it must pin |
|---|---|
| `canvas/__tests__/canvas-selection.test.ts` *(exists — extend)* | `marqueeHitTest`: containment rule, tree validation (root ids rejected, unknown ids rejected, hidden/invisible rejected), section scoping, order preservation, empty-marquee behaviour. |
| `canvas/__tests__/canvas-geometry.test.ts` *(exists — extend)* | `compositeSelectionBox`: exact union math (incl. two, three, N rects; negative coords; float noise via `roundRect`), parity with `boundingBox` for siblings. |
| `canvas/__tests__/canvas-transform.test.ts` *(exists — extend)* | Batch move deltas: N elements each = own start rect + shared delta; `beginMove` with resolved ids; locked exclusion; ancestor/descendant dedup via `topLevelSelection`; merge-over-existing preserved (zIndex/mode not clobbered). |
| `canvas/__tests__/canvas-snap.test.ts` *(new)* | Snap thresholds: match within/outside 8px; `SnapTargetDescriptor` provenance (sourceId/kind); composite-box candidates during multi-drag (D5); toggle-off returns unsnapped + no match. |
| `canvas/__tests__/canvas-interaction-store.test.ts *(exists — extend)* | Marquee lifecycle + new guide transient key cleared by `reset()`; multi-selection write shape (`multi: true`); anchor semantics. |
| `canvas/__tests__/canvas-batch-commit.test.ts` *(new)* | End-to-end (hook-level): multi-drag → `applyElementOpBatch` → ONE history entry (`history.past.length` +1); undo restores every element exactly; locked/ancestor resolution; fail-closed on a failed op. |
| `canvas/__tests__/canvas-overlay-targeting.test.tsx` *(exists — extend)* | Multi-selection renders ONE composite box (not N boxes, not the section box); dims chip shows the union; count badge; move affordance disabled for locked-mixed sets; no resize/rotate handles on the composite box. |
| `canvas/__tests__/canvas-marquee.test.tsx` *(new)* | Marquee visual appears during drag and clears on release; hit-set lands in the store; marquee never rewrites the overlay chrome's selection (REQ-12). |

### 6.2 Component tests (Testing Library)

| Suite | What it must pin |
|---|---|
| `canvas/__tests__/canvas-overlay-targeting.test.tsx` *(extend)* | SelectionOverlay under multi-selection: composite box, no handles, count badge, dims-of-union, quick-action gating. |
| `canvas/__tests__/canvas-snap-lines.test.tsx` *(new)* | SnapLines rendering: line at the matched value/axis during an active move; no lines when snapped=false; no lines when the session is not a move; cleared on end/cancel; pointer-events:none. |

### 6.3 E2E (Playwright, `--workers=1`, deterministic helpers — no arbitrary sleeps)

Any E2E spec added must be committed in the same phase, or the evidence is not reproducible from a clean
clone (the P26 spec §6.4 hazard 5 discipline).

| Spec | Coverage |
|---|---|
| `e2e/canvas-multi-select.spec.ts` *(new)* | Shift-click multi-select → composite box → batch drag → one undo restores all; marquee over two elements → batch move; single-element flows unchanged. |

### 6.4 Required gate order (sequential, never concurrent)

```
npm run typecheck   →   npm run lint   →   npm test   →   npm run build   →   npm run test:export-build
```

Per the brief, E2E is not part of the mandatory gate list for this phase (the five gates above are the
exit requirement), but any E2E spec added MUST still be committed in the same phase (§6.3 discipline), and
the known pre-existing E2E families (`workspace-version-history`, `realtime-structure`) must be classified
per the established discipline if a run is executed.

### 6.5 Known hazards to plan around (documented pre-existing — not introduced here)

1. **`boundedErrorToken` / `.next/dev/types` artifact** — default typecheck can fail after an E2E run
   regenerates the gitignored artifact; source-only config (`.p24b-tsconfig.json`, gitignored) is the
   known mitigation; record which was used.
2. **Export-build cold-cache fragility** — passes warm (~51–54 s); has timed out cold (>600 s).
3. **Pre-existing ESLint warning** — `e2e/ai-element-editing.spec.ts:310` (`reviewAndApply`).
4. **Pre-existing E2E flake families** — `workspace-version-history` (post-restore reload race),
   `realtime-structure` (`STALE_REVISION` mock race). Classify, never silently exclude.

---

## 7. Risks & mitigations

| # | Risk | Mitigation |
|---|---|---|
| R1 | **Locked/ancestor double-move corrupts hierarchy.** A raw-ids gesture would move a child once via its own patch and again via its container's patch. | D3 resolves via `topLevelSelection` + `splitManipulable` before `beginMove`; `canvas-batch-commit.test.ts` pins one-move-per-branch; REQ-3. |
| R2 | **Section-root marquee hits.** The current hit loop includes section container ids. | D1 validates against the tree and rejects root ids; REQ-1. |
| R3 | **Composite box drifts from the elements during drag.** Per-element preview rects exist; the union must be recomputed per frame, not captured at gesture start. | REQ-5 requires per-frame union from `previewRects`; `canvas-overlay-targeting.test.tsx` pins the box following a drag. |
| R4 | **Composite-box drag starts a second session from the same pointerdown.** The overlay chrome exclusion stops overlay chrome from rewriting selection; the composite box's own move strip must not ALSO trigger the producer. | REQ-12 (chrome exclusion, already implemented for `canvas-selection-box`); the composite box reuses the same `data-testid="canvas-selection-box"` surface so the existing exclusion applies by construction. |
| R5 | **Snap guides flicker/stutter.** Guide state updates per frame; React re-renders per move would break 60fps. | D6: guide data updates inside the rAF loop; guides render from coalesced state; target lists precomputed per session (OQ-8). |
| R6 | **`match` is single-winner per rect; multi-drag has multiple winners.** | D5: the composite box is the snap candidate during multi-drag (one match per axis); per-element matches are out of scope. |
| R7 | **Flow-mode elements silently converted to absolute.** | D4: flow-mode elements are excluded from batch move by default (OQ-6 decides the alternative); `canvas-batch-commit.test.ts` pins that a flow-mode element's `mode` is never flipped by a batch gesture. |
| R8 | **Marquee widens selection across sections.** | Out-of-scope item 1 + D1's tree scoping; `marqueeHitTest` takes the active section's tree — cross-section ids cannot enter. |
| R9 | **Measurement widening costs a frame.** | D2: measurement runs inside the rAF loop (bounded by the 1,000-node normalizer cap); at-rest rects are memoized; the marquee measures once at pointerdown. [inference] |
| R10 | **Store key proliferation.** | REQ-16: every new transient key is cleared by `reset()` and pinned in `canvas-interaction-store.test.ts`. |

---

## 8. Likely implementation areas **[inference — file-level surface, not a committed diff plan]**

| Area | File | Expected nature of change |
|---|---|---|
| Marquee engine | `src/features/canvas/engine/selection.ts` | Add `marqueeHitTest` (D1); no change to existing exports. |
| Batch resolution | `src/features/canvas/hooks/useCanvasManipulation.ts` | `handleMoveStart` resolves via the engines (D3); rAF coalescing for `driveSession`/marquee (D6); marquee wiring is layer-side. |
| Marquee trigger + guides + composite target | `src/features/canvas/components/CanvasManipulationLayer.tsx` | Producer modifier-click branch (D1b); marquee visual (D1c); `measureRects` widening (D2); target resolution three-case (D7b); guides render (D5). |
| Composite box | `src/features/canvas/components/SelectionOverlay.tsx` | Composite variant props (count badge, handle suppression) — additive; single-element rendering unchanged. |
| Snap provenance | `src/features/canvas/engine/snap.ts` | `elementSnapTargets` gains provenance descriptors (additive); composite-box candidate helper (D5). |
| Alignment guides visual | `src/features/canvas/components/` *(new component)* | SnapLines overlay (D5) — editor-only, pointer-events:none. |
| Geometry helper | `src/features/canvas/engine/geometry.ts` | `compositeSelectionBox` (D7) — additive. |
| Store | `src/features/canvas/store/canvas-interaction-store.ts` | At most: a transient guide key (D5); `reset()` clears it (REQ-16). No durable surface changes. |
| Commit boundary | `src/features/editor/store/editor-store.ts` | **No change expected** — the gesture commits through the existing boundary (D3b/OQ-2). |
| Element engine | `src/features/elements/engine/element-operations.ts` | **No change expected** — `update-geometry` ops are consumed as-is. |
| AI/copilot | `src/features/ai-editing/**`, `ai-copilot/**` | **No change expected** (out-of-scope item 8; REQ-10b). |
| Export/persistence | `src/features/export/**`, `persistence/**` | **No change expected** (§1.3). |
| Tests | §6.1–§6.3 suites | Per §6. |

**Correction to the brief's file list:** the brief lists `useCanvasManipulation.ts` under "Selection
Engine" and `CanvasManipulationLayer.tsx` under "Overlay & Controls" — accurate as far as it goes, but the
producer/marquee trigger lives in `CanvasManipulationLayer.tsx` (the pointer-listening component), the
overlay target resolution in the same layer (D7b), and the commit call in the layer's `commit` callback
(`:291-296`) — while `useCanvasManipulation.ts` owns session drive, marquee engine wiring and the rAF
coalescing. Both files sit in the critical path; neither alone is sufficient.

---

## 9. Open questions (require review/decision before implementation)

| # | Question | Why it matters |
|---|---|---|
| **OQ-1** | Marquee hit rule: full containment (proposed) vs intersection? Zero-hit marquee: clears selection (proposed) vs keeps? | Defines `marqueeHitTest`'s contract (R2); changes every marquee test. |
| **OQ-1b** | Count badge on the composite box: required, optional, or none? | Overlay chrome (D7); purely presentational but pinned by tests. |
| **OQ-1c** | Multi-drag snap candidates: the composite box's edges/center only (proposed) vs per-element candidates? | Defines guide rendering during multi-drag (R6); the standard-tool behaviour is the composite box. |
| **OQ-2** | Batch commit boundary: keep `commitElementTree` (proposed — behaviourally identical, zero churn) or switch the call site to `commitSectionTree`? | The brief names `commitSectionTree`; the functions are behaviourally identical at `293d713` (P26 shared preparation). Keeping avoids churn; switching is cosmetically aligned. REQ-6 is satisfied either way. |
| **OQ-3** | Duplicate/delete quick actions on the composite box: in scope (proposed) or deferred? | D7 chrome; delete is destructive-gated; duplicate of a multi-set needs `duplicateElement` batching (the existing store duplicate is section-level — **verified gap**: no element-level multi-duplicate exists today). |
| **OQ-3b** | Multi-resize/multi-rotate: deferred (proposed) or in scope? | D3/D7; real product feature but a distinct op family (relative scaling, per-element pivot math). |
| **OQ-4** | Inspector multi-targeting: stays single-target (proposed) or widens? | Out-of-scope item 7; `singleNestedSelectionId`'s multi → `null` contract is load-bearing for the inspector AND the AI target (REQ-10b). |
| **OQ-5** | Custom-block marquee participation: excluded (proposed conservative default) or included? | D2's nuance; the frozen P25 click contract (f9cb315) vs measurement widening. |
| **OQ-6** | Flow-mode elements in batch move: excluded (proposed) or offset-translation? | D4; the alternative must not silently convert mode. |
| **OQ-7** | Per-element outlines during multi-selection: deferred (proposed) or in scope? | P25 §7 item 8 remainder; bounds the overlay work. |
| **OQ-8** | Snap target lists: precomputed per session (proposed) or rebuilt per move? | R5/R9; precomputing changes `driveSession`'s shape but not the math. |

---

## 10. Deliverables

1. `docs/phase-p27-spec.md` — this document.
2. Implementation slices with their own commits, at minimum: **Slice 1** marquee trigger + `marqueeHitTest`
   + marquee visual + measurement widening (S1, D1/D1b/D1c/D2); **Slice 2** batch resolution + composite
   box + batch commit (S2, S3, D3/D3b/D4/D7); **Slice 3** snap provenance + guides + rAF coalescing
   (S4, D5/D6); **Slice 4** tests + E2E spec (S5).
3. `docs/phase-p27-report.md` — outcome, verified changes per slice, invariant confirmations with evidence,
   gate results table, flake classification, and recorded follow-ups.
4. Answers to OQ-1 … OQ-8 recorded in the report, even when resolved by implementation.

---

## 11. STOP

This document specifies only. It modifies no source file, no test, and no schema; it changes no version
constant, no cap, and no sandbox property. Implementation must not begin until **OQ-1** (marquee hit rule),
**OQ-2** (commit boundary) and **OQ-6** (flow-mode rule) are answered, because together they define what
this phase actually ships.
