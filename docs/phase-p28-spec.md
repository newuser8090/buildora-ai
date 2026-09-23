# Phase P28 — Canvas Layer Ordering, Grouping & Keyboard Controls

**Type:** Formal specification (design record, written before implementation).
**Anchored on:** `PROJECT_FULL_CONTEXT.md` + `docs/phase-p25-report.md` + `docs/phase-p26-report.md` + `docs/phase-p27-spec.md` (commit `aee7ae7`) + `docs/phase-p27-report.md` (commit `1b54738`, current HEAD).
**Branch:** `phase-p22-canva-elements`.
**Status:** `SPECIFICATION — awaiting review`. Nothing in this document is implemented. **This document modifies no source file and no test file.**
**Provenance:** Every symbol, line reference and behaviour below was verified by reading the working tree at `1b54738` (post-P27-closeout HEAD). Items that are inference rather than verified fact are explicitly marked **[inference]**.

---

## 0. Why this phase exists

P27 closed the manipulation-side remainder of P25's OQ-4 decision: marquee selection, a composite
overlay, batch moves and snap guides all ship, and every durable write funnels through the shared
`prepareDurableSectionCommit` boundary. But three interaction families remain unwired or
section-root-bound, and the P27 closeout recorded them as follow-ups:

> **Follow-up #3** (`docs/phase-p27-report.md` §8): *"Duplicate/delete for multi-sets (OQ-3):
> element-level multi-duplicate batching (the store's duplicate is section-level — verified gap in
> the spec)."*

The gaps are concrete and verified at `1b54738`:

- **Layer ordering has an engine and no UI.** `applyLayerAction` (`layering.ts:26`) and
  `buildLayerOps` (`layering.ts:72`) implement deterministic sibling reordering
  (`"forward" | "backward" | "front" | "back"`), tree-valid and tested in `canvas-ops.test.ts:139-176`
  — but nothing outside the engine and its tests references `buildLayerOps`. The selection overlay
  has quick actions, yet no Bring-to-Front / Send-to-Back affordance exists anywhere in the canvas
  feature. The engine's own header states the contract: *z-order is CHILDREN ORDER within a parent
  (later = on top)*, *root-level reordering is intentionally NOT part of this engine*.
- **The keyboard surface is section-root-bound.** `CanvasManipulationLayer.tsx:473-490` wires
  `useCanvasKeyboard` with `onCopy` that copies **`[selectedSectionId]`** — the whole section, never
  the element selection — and `onPaste` that pastes under the section root. `onDelete` and
  `onDuplicate` are not wired at all (the P22-B header comment: *"Delete/Cmd+D remain the EXISTING
  section-level shortcuts to avoid double handling"*). There is no element-level batch delete, no
  element duplicate chord, and no group/ungroup concept anywhere in the codebase (no `group` type in
  `ELEMENT_ONLY_TYPES`, `types.ts:51`).
- **What already works must be pinned, not rebuilt.** Arrow-key nudging exists and is mode-aware:
  `nudge` (`useCanvasManipulation.ts:436-476`) resolves the selection through the P27 engines
  (`resolveGestureIds`, `:46-52`), offsets flow elements' durable `x/y` without mode flips (P27
  D4/OQ-6 semantics), and commits once. `nudgeAmount` (`shortcuts.ts:114`) already encodes the
  1 px / Shift-10 px contract, and the typing guard (`isTypingTarget`, `TYPING_SELECTORS` —
  input/textarea/select/contenteditable/`[role=textbox]`) already suppresses shortcuts while typing.
  The gap is coverage and parity, not existence.

P28 is the phase that pays this: **visible layer-order controls over the existing reorder engine,
Canva-style group/ungroup with exact dissolution math, and element-level keyboard ergonomics
(nudge pinned, batch delete, duplicate/copy/paste) — all bounded to the active section and all
committing as ONE history entry through the existing durable boundary.**

**Naming note (honest derivation):** no roadmap document defines a "P28". The motivating anchors are
P27's follow-ups #3 (multi-duplicate/delete) and the interaction-surface remainder of the P22-B
engine inventory (`layering.ts`, `shortcuts.ts`, `clipboard.ts` were all built engine-first with
explicit "the mount site decides which handlers are wired" deferrals). This document is the **first**
artifact to name P28; only the filename and heading change if the project prefers a different label.

---

## 1. Objective & boundaries

### 1.1 Objective (one sentence)

Extend the canvas interaction surface from geometry manipulation to **structural ordering and
selection lifecycle** — sibling layer reordering, group/ungroup, batch delete and
duplicate/copy/paste over element selections inside the active section — by wiring the existing
P22-B engines and adding the minimal new tree-mutation math, with every operation committing as
exactly ONE history entry through `commitElementTree` (`prepareDurableSectionCommit` / `withHistory`),
and zero regression to the P25–P27 selection/marquee/snap contracts.

### 1.2 In scope

| # | Scope item | Anchor |
|---|---|---|
| S1 | **Visual layer ordering.** Bring to Front / Send to Back / Move Forward / Move Backward over selected sibling elements inside durable section trees (`section.tree` / custom-block `props.tree`), via the existing `buildLayerOps` engine, exposed through overlay/context-menu controls and keyboard chords. Deterministic DOM/z-index stack order (children-order rule preserved; `geometry.zIndex` is never introduced as a second ordering source). | `src/features/canvas/engine/layering.ts`, `components/SelectionOverlay.tsx`, `components/CanvasManipulationLayer.tsx` |
| S2 | **Grouping & ungrouping.** Group the selected top-level siblings into a container/group node; ungroup dissolves it while preserving members' relative geometry (exact inverse translation) and relative order. New tree-mutation math (`groupElements` / `ungroupElements`), committed as ONE batch. | `src/features/elements/engine/` (new), `src/features/canvas/` (wiring) |
| S3 | **Keyboard ergonomics.** Arrow nudge (1 px, 10 px with Shift — exists, pin + extend coverage), batch element deletion (Delete/Backspace), duplicate (Cmd/Ctrl+D) and copy/paste (Cmd/Ctrl+C/V) bound to the **element selection** within the active section. | `src/features/canvas/hooks/useCanvasKeyboard.ts`, `engine/shortcuts.ts`, `engine/clipboard.ts` |
| S4 | Unit + component tests: reorder boundary conditions, group/ungroup dissolution math, keyboard delta multipliers, clipboard subtree duplication, keyboard-event isolation, single-history-commit guarantees. | §6 |
| S5 | Preserve every P22-B/P22-C/P25/P26/P27 invariant unchanged. | §5 |

### 1.3 Out of scope (explicit non-goals)

1. **No cross-section grouping or ordering.** Group members must be siblings under one parent inside
   the active section's tree; layer reordering stays scoped per parent (`buildLayerOps` already
   rejects root-level reordering — page-level section ordering owns that surface). A selection
   spanning parents is rejected for grouping (fail-closed, structured no-op) and filtered per parent
   for reorder.
2. **No server-side CRDT bridge or `formatVersion: 3` changes.** `collab-doc.ts` is a generic
   JSON↔Yjs bridge; `tree-normalizer.ts` is untouched; `CURRENT_FORMAT_VERSION = 3` and
   `DATABASE_VERSION = 9` are frozen. A `group` node is plain `ElementNode` data and flows through
   the existing bridges with no bridge change (PROJECT_FULL_CONTEXT.md §2.3 boundary rule 3).
3. **No responsive flow-mode auto-layout rule changes.** P27 D4/OQ-6 semantics are frozen: flow-mode
   elements keep their offset-translation behaviour; grouping must not silently convert
   flow→absolute for members (see D3/OQ-2 for the precise rule).
4. **No schema-layer rewrite.** IF a new element-only `group` type is chosen (OQ-1), it is additive:
   one entry in `ELEMENT_ONLY_TYPES` + one registry definition + schema/normalizer coverage that the
   existing machinery already provides for every element family. No new schema layer, no migration,
   no version bump. If `container` reuse is chosen instead, no type surface changes at all.
5. **No new store, no new commit path.** All durable writes route through the existing
   `commitElementTree` → `prepareSectionTreeCommit` → `prepareDurableSectionCommit` → `withHistory`
   boundary (`editor-store.ts:319, :405, :503, :525`). The transient interaction store may gain
   transient keys only (e.g. context-menu open state), each cleared by `reset()`.
6. **No AI-plan surface change.** `singleNestedSelectionId`'s multi → `null` contract, the AI element
   target (fail-closed on multi) and the copilot are frozen (P27 REQ-10b preserved).
7. **No multi-resize/multi-rotate** (P27 OQ-3b stays deferred) and no per-element outlines (P27
   OQ-7 stays deferred). Grouping changes what is selected, not what the overlay can do.
8. **No custom-block contract regression.** Legacy `custom-block` keeps its frozen single-target
   click contract (P25 §2.4 / P27 OQ-5 resolution); P28 operations are available exactly where the
   P25 D6 gate (`isCustomBlock || durableTreeEnablesCustomCode(section)`) renders manipulable
   elements — the same shared predicate discipline, no private re-implementation.

---

## 2. Verified current state — the P27 baseline (and the P22-B engines it inherited)

### 2.1 What already exists

| Capability | Where | Verified behaviour |
|---|---|---|
| Layer-order math | `layering.ts` (`applyLayerAction:26`, `buildLayerOps:72`) | Pure, deterministic sibling reorder per `LayerAction`; preserves the selected set's RELATIVE order ("back" processes from the array end); groups ops by parent; skips root ids (page-level ordering owns roots); emits sequential `move` ops in an order that stays correct under sequential application. Tested in `canvas-ops.test.ts:139-176`. **No UI caller.** |
| Z-order model | `layering.ts` header (lines 1–14) | z-order = children order within a parent (later = on top) + rootIds order for roots. The tree is NEVER flattened; nested hierarchy preserved. |
| Keyboard engine | `shortcuts.ts` (`matchCanvasShortcut`, `isTypingTarget`, `TYPING_SELECTORS`, `arrowDirection:97`, `nudgeAmount:114`) | Delete/Backspace→delete (mod-guarded: Cmd+Backspace never hijacked), Cmd/Ctrl+D→duplicate, Cmd/Ctrl+C/V→copy/paste, Escape→deselect, Arrow→nudge, Shift+Arrow→nudge-large, Cmd/Ctrl+A→select-all; typing surfaces return `null` before any mapping. |
| Keyboard dispatch | `useCanvasKeyboard.ts:39` | Pure dispatcher over `matchCanvasShortcut`; `enabled()` gate; `preventDefault` per action; `onNudge(dx, dy, large)` receives the already-multiplied delta. |
| Keyboard mount | `CanvasManipulationLayer.tsx:473-490` | Wires `onDeselect`, `onCopy` (copies `[selectedSectionId]` — section root, NOT the element selection), `onPaste` (under section root), `onNudge → api.nudge`. **No `onDelete`, no `onDuplicate`.** |
| Nudge | `useCanvasManipulation.ts:436-476` | Resolves `resolveGestureIds` (top-level + unlocked, `:46-52`); flow elements offset their DURABLE `x/y` (rounded to 0.1, never a mode flip); absolute/modeless materialize absolute from measured rect + delta; builds geometry ops → `applyElementOpBatch` → ONE `commit`. |
| Clipboard engine | `clipboard.ts` (`copySelection:53`, `serializeClipboard`, `parseClipboard`, `buildPasteOps`, `applyPasteOps`) | Copy serializes deep-cloned subtrees (top-level of selection only; descendants ride along); strips `_`-prefixed internal props; paste assigns FRESH ids to every node (schema-re-validated, ≤ 200 nodes, versioned payload), default 24 px down-right offset, pre-order parent-before-child ops, atomic subtree merge with nesting + full-tree validation. |
| Tree ops engine | `element-operations.ts` (`deleteElement:268`, `duplicateElement:302`, `moveElement:369`, `insertElement:213`; `ElementOperation` union `:817-840`) | Validated, immutable, structured-error ops. `delete` removes a node with its subtree; `duplicate` exists for a SINGLE element (no multi-batch composition exists at the store level — P27 report §8 item 3's verified gap). |
| Nesting policy | `element-validation.ts:26` (`canNestElement`) | Registry-driven child-type enforcement, used by insert and paste boundaries. |
| Commit boundary | `editor-store.ts` (`commitElementTree:319`, `withHistory:405`, `prepareSectionTreeCommit:503` → `prepareDurableSectionCommit:525`) | ONE `withHistory` entry per commit; no-op detection via key-order-insensitive deep equality (re-committing an identical tree creates no history entry); collab hook + autosave intercept the same mutation. |
| Batch application | `batch.ts` (`applyElementOpBatch`) | Sequential validated application, stop-at-first-failure; caller commits the resulting tree once. |
| Selection resolution | `selection.ts` (`topLevelSelection:155`, `selectionHasLocked:163`, `splitManipulable`, `singleNestedSelectionId:132`) | P27 engines, consumed by `resolveGestureIds` for gestures and nudge; multi → `null` for inspector/AI targeting (frozen). |
| Overlay | `SelectionOverlay.tsx` | Single box with 8 handles + rotation + move strip + dims chip + quick actions; composite variant (count chip, no handles) for multi-sets — P27 byte-for-byte contracts. |

### 2.2 Findings that shape the design (all verified)

**F1 — `buildLayerOps` returns ops that must be applied, not a reordered tree.** The engine emits
sequential `move` ops with emission order chosen for sequential correctness (`layering.ts:104-110`
comment). The wiring must feed them through `applyElementOpBatch` (same stop-at-first-failure
discipline as gestures) and commit once. Any re-derivation of "cleverer" ordering at the call site
would invalidate the engine's tested contract.

**F2 — The keyboard mount copies the section root, not the selection.** `onCopy` at
`CanvasManipulationLayer.tsx:478` passes `[selectedSectionId]`. `copySelection` handles element ids
fine (it tree-walks whatever ids it receives), so the gap is purely in the mount's wiring: the
element selection (`store.selection.ids`) must take precedence when non-empty, falling back to the
section-root contract when empty (P22-B parity).

**F3 — Delete/Cmd+D double-handling is a real hazard, and the codebase already names it.** The
P22-B mount comment says Delete/Cmd+D "remain the EXISTING section-level shortcuts to avoid double
handling". P28 must wire element-level handlers with an `enabled()` gate that is true **only when an
element selection is active**, and must verify the section-level handler does not also fire for the
same keypress. This is a correctness requirement, not polish (REQ-9, R3).

**F4 — Grouping has zero foundation today.** No `group` type, no group ops, no group math. This is
the only scope item that is genuinely net-new model surface — and the only one that touches the
element registry/schemas (additively, per OQ-1).

**F5 — Ungroup math must be an exact inverse.** In this model, `geometry.x/y` is *relative to the
parent*. Re-parenting members INTO a group must translate their coordinates from
parent-relative to group-relative (subtract the group's parent-relative origin); dissolution must
translate back (add it). A round-trip property (group → ungroup restores the original member
geometry bit-exactly) is the cheapest correct-by-construction test (REQ-4).

**F6 — The typing guard exists but its isolation is under-tested at the interaction level.**
`isTypingTarget` duck-types on `matches`/`closest` (environment-safe) and covers input, textarea,
select, `[contenteditable]` and `[role=textbox]` — which subsumes typical code editors
(contenteditable/textarea-based). No test pins that a keydown dispatched at a focused input inside
the canvas leaves the document untouched. Invariant 4 of this phase makes that a required test
(REQ-11).

**F7 — P27's batch/nudge machinery already gives P28 its commit discipline.** One batch → one
`applyElementOpBatch` → one `commit(tree)` → one `withHistory` entry is the established pattern
(`canvas-batch-drag.test.tsx` pins it for gestures). Every P28 operation is "a different op family,
same commit shape".

---

## 3. Design decisions

### D1 — Layer ordering wires the existing engine; the call site never re-derives order

`buildLayerOps(tree, resolvedIds, action)` is the single source of reorder truth:

1. Resolve ids exactly as gestures do: `topLevelSelection` (one reorder per branch — a selected
   container absorbs its selected descendants), then `splitManipulable` (locked elements are
   excluded; an entirely-locked selection no-ops fail-closed).
2. `buildLayerOps` groups by parent; root ids are skipped by the engine itself (page-level section
   ordering is out of scope, §1.3 item 1).
3. Ops are applied via `applyElementOpBatch` (stop-at-first-failure) against the CURRENT tree and
   committed ONCE through `commitElementTree` — one `withHistory` entry regardless of how many
   `move` ops the action emitted.
4. `geometry.zIndex` is NOT consulted or written: children order is the only ordering source
   (P22-B header contract). `buildGeometryOps`' merge-over-existing rule (never clobber
   `mode`/`zIndex`) is untouched — P28 simply never emits geometry patches for reordering.

**UI surface (OQ-3):** the proposed default is a layer-order cluster (four actions) on the
selection overlay's floating action bar for single-element selections, the composite box's chrome
for multi-sets, plus a right-click context menu mirroring the same actions — all dispatching the
same handler; keyboard chords (OQ-4) dispatch the same handler too. One code path, N affordances.
[inference on chrome placement; the behavioural requirement is that all surfaces dispatch one
handler and never rewrite the selection they operate on (P27 REQ-12 exclusion preserved).]

### D2 — Group node representation: a registry-backed element, not a transient marker

Two viable options, pinned as **OQ-1**:

- **Option A (proposed): a new element-only `"group"` type** — one additive entry in
  `ELEMENT_ONLY_TYPES` (`types.ts:51`), one registry definition (`canHaveChildren: true`, neutral
  defaults), flowing through the existing schema/normalizer/adapter machinery exactly like every
  other element family. Clean semantics, inspectable, exportable, and strippable at distribution
  boundaries by the existing machinery.
- **Option B: reuse the existing `container`/`stack` type** with no new type surface. Cheaper, but
  a group is semantically distinct from a layout container (ungroup targets, chrome labelling,
  inspector behaviour), and nothing in the document would distinguish a user-made container from a
  group — making ungroup discovery and future group chrome guesswork.

Option A is proposed because P22's D1 decision ("extend the model additively, never fork") is
exactly the machinery this uses, and the boundary rules (dual schema-layer declaration, dual
untrusted-boundary normalization) are satisfied by the existing element-family pipeline. The
implementer must not silently choose the other option.

Group node shape: `mode: "absolute"` geometry whose box is the measured/derived bounding box of the
members, inserted into the parent's children **at the top of the local stack** (the max member
index — grouping must not change visual stacking), with children ordered by the members' previous
relative order (bottom-most member first). No `zIndex` written; stacking stays children-order.

### D3 — Grouping math (pure, engine-level)

`groupElements(tree, parentId, ids, nextId)` (name indicative; location per §8):

1. **Preconditions (fail-closed, structured no-op):** every id exists in `tree.nodes`; every id is a
   child of `parentId`; no id is a root id; the resolved set is top-level-of-itself
   (`topLevelSelection` collapses descendant noise first); the set has ≥ 2 members (a 1-member group
   is a pointless indirection); `canNestElement(parentType, "group")` and
   `canNestElement("group", memberType)` hold for every member.
2. **Bounding box:** derived from member geometry where `width`/`height` are numeric (mirroring
   `copySelection`'s bbox fallback rules); the caller MAY pass measured rects for flow-mode members
   whose geometry alone is insufficient [inference on measurement source; the invariant is that the
   group box covers every member]. The group node is `mode: "absolute"` with that box.
3. **Member translation (F5):** each member's `x/y` becomes group-relative:
   `x' = x − groupX`, `y' = y − groupY` (missing coordinates treated as 0, matching the nudge
   precedent). **Flow-mode members keep `mode: "flow"`** — their stored offsets translate exactly
   like absolute coordinates and their mode never flips (P27 D4/OQ-6 discipline; §1.3 item 3).
4. **Op composition:** one `insert` op (the group node at the top-of-stack index) + one `move` op
   per member (`toParentId: groupId`), emitted parent-before-child so sequential application stays
   valid; applied via `applyElementOpBatch`, committed ONCE.
5. **Selection after grouping (transient only):** the group id becomes the selection
   (`setSelection([groupId])`) — Canva behaviour; the write is to the transient interaction store
   only (Invariant 2).

### D4 — Ungroup math: the exact inverse

`ungroupElements(tree, groupId)`:

1. **Preconditions:** the node exists, is a group (per OQ-1's chosen representation), its parent
   exists, and every member type passes `canNestElement(parentType, memberType)` — if any member
   could not legally live in the grandparent, the whole operation no-ops fail-closed (never a
   partial dissolve).
2. **Inverse translation:** each member's `x/y` becomes parent-relative again:
   `x' = x + groupX`, `y' = y + groupY`.
3. **Re-insertion order:** members are re-parented to the grandparent at the group's former index,
   in their previous relative (bottom-most first) order — the stack position the group occupied is
   inherited by the member set.
4. **Group styles disposition (OQ-5):** proposed default — the group node's own `style` tokens are
   DROPPED (members keep their own styles). Inheriting group styles onto members would silently
   rewrite member styling; dropping is the conservative, reversible-by-redo behaviour.
5. **Op composition:** one `move` per member (back to the grandparent at computed indices, emitted
   bottom-most-first so sequential application lands correctly) + one `delete` op for the (now
   empty) group node, applied as ONE batch, committed ONCE.
6. **Round-trip property (REQ-4):** `ungroup(group(tree, ids))` restores every member's geometry,
   style and relative order bit-exactly, and restores the parent's child list to the original
   sequence with members replacing the group at its index. This property is the primary unit test.

### D5 — Batch delete: the gesture resolution + delete ops, one commit

`Delete`/`Backspace` with an active element selection:

1. `resolveGestureIds(tree, selection.ids)` — top-level + unlocked (locked elements are never
   deleted by the keyboard; an entirely-locked selection no-ops fail-closed).
2. One `delete` op per resolved id (descendants ride along with their parents — never double-delete
   a branch), applied via `applyElementOpBatch`, committed ONCE.
3. Selection is cleared afterwards (transient store write only). If the selection becomes empty,
   the overlay falls back to its existing section-root contract (P27 D7b three-case resolution,
   unchanged).
4. Destructive gating parity: no confirm dialog is ADDED for element deletion [inference — the
   existing section-level delete gates are the precedent and undo exists; pinned as OQ-6].

### D6 — Duplicate / copy / paste: the clipboard engine, selection-bound

- **Copy (Cmd/Ctrl+C):** `copySelection(tree, selection.ids)` — the element selection when
  non-empty, `[selectedSectionId]` fallback when empty (F2, P22-B parity). Payload serialized into
  the existing transient `clipboard` interaction-store key. No OS-clipboard integration is added or
  required (the existing engine is store-transient by design; that is preserved).
- **Paste (Cmd/Ctrl+V):** `buildPasteOps` under the **members' original parent when it still
  exists** (the copied set's parent), else the active section root; `applyPasteOps` (fresh ids,
  schema re-validation, atomic merge) → commit ONCE. New copies become the selection (transient).
- **Duplicate (Cmd/Ctrl+D):** copy + paste composed into ONE commit — the clipboard payload is
  built, pasted with the default 24 px down-right offset, and committed as a single
  `applyElementOpBatch`/`applyPasteOps` result. No intermediate history entry, no intermediate
  selection write. [inference: the clipboard-path composition is chosen over composing `duplicate`
  ops because `applyPasteOps` already solves fresh-id assignment, subtree atomicity and nesting
  validation — the exact problems a duplicate batch would re-solve. Pinned as OQ-7, including
  whether duplicate selects the new copies (proposed: yes).]
- The 200-node paste cap and `_`-prop stripping are existing engine contracts, unchanged.

### D7 — Keyboard dispatch: one gate, one dispatcher, no new event listeners

All P28 shortcuts flow through the existing `useCanvasKeyboard` mount:

- The mount's `enabled()` gate becomes element-selection-aware: element-level handlers (delete,
  duplicate, reorder chords, group/ungroup chords) act only when `selection.ids` is non-empty and
  tree-valid; the section-root copy/paste fallback keeps today's behaviour otherwise (F2/F3).
- The typing guard (`isTypingTarget`) is untouched and stays the FIRST check in
  `matchCanvasShortcut` — no P28 handler can ever see a keydown that originated in a typing surface
  (REQ-11 / Invariant 4).
- New chords (OQ-4): proposed Cmd/Ctrl+`]` / Cmd/Ctrl+`[` = forward/backward,
  Cmd/Ctrl+Shift+`]` / `[` = front/back (Canva-convention), Cmd/Ctrl+G / Cmd/Ctrl+Shift+G =
  group/ungroup. All are additive `CanvasShortcut` variants dispatched by the existing switch; the
  mod-guard rule (`Cmd+Backspace` never hijacked) extends to all new chords (browser-reserved
  combinations are never intercepted).
- No new window listeners outside `useCanvasKeyboard`; the context menu (D1) dispatches handlers
  directly, never synthesizes keyboard events.

### D8 — Commit boundary: unchanged, by construction

Every operation in §3 lands as ONE tree → ONE `commitElementTree` call
(`editor-store.ts:319`) → `prepareSectionTreeCommit` (`:503`) → `prepareDurableSectionCommit`
(`:525`) → ONE `withHistory` entry (`:405`). The P27 OQ-2 resolution (keep `commitElementTree`;
`commitSectionTree` remains its byte-identical sibling) carries forward. No-op detection is
preserved for free: reordering an already-ordered set, grouping and immediately ungrouping a
round-trip-identical set, or deleting an empty selection produce no history entry at all.

---

## 4. Detailed requirements

| ID | Requirement |
|---|---|
| **REQ-1** | Layer actions (front/back/forward/backward) reorder only the selected ids' positions among their own siblings, preserving the selected set's relative order; other siblings' relative order is unchanged; root-level ids are skipped (page-level ordering untouched); the tree is never flattened. |
| **REQ-2** | Layer reorder, group, ungroup, batch delete and duplicate each produce exactly ONE history entry through `commitElementTree`/`withHistory`, regardless of the number of ops emitted; undo restores the pre-operation tree exactly. |
| **REQ-3** | Grouping requires ≥ 2 top-level siblings sharing one parent inside the active section; any violation (cross-parent set, root id, locked member, nesting-policy rejection, single member) is a structured fail-closed no-op — never a partial group. |
| **REQ-4** | Ungroup is the exact inverse of group: member geometry (x/y translated back), styles, visibility/lock flags and relative order are preserved; the parent's child order restores with members at the group's former index; a group→ungroup round-trip is bit-exact. |
| **REQ-5** | Flow-mode elements keep `mode: "flow"` through group/ungroup/reorder/nudge; no P28 operation converts a member's geometry mode as a side effect. |
| **REQ-6** | Group/ungroup/reorder never write `geometry.zIndex`; children order remains the sole stacking source; the rendered DOM order follows the tree order after every P28 operation. |
| **REQ-7** | Batch delete resolves through `topLevelSelection` + `splitManipulable`: locked elements are never deleted; descendants are never double-deleted; an entirely-locked or empty selection no-ops fail-closed; selection clears afterwards (transient write only). |
| **REQ-8** | Copy/paste/duplicate operate on the element selection when non-empty (section-root fallback preserved when empty); pasted nodes receive fresh ids (never shared mutable references), internal `_`-props never cross the clipboard, the payload is schema-re-validated and capped at 200 nodes; duplicate = one commit (no intermediate history entry). |
| **REQ-9** | Element-level Delete/Backspace and Cmd/Ctrl+D fire only when an element selection is active; the pre-existing section-level shortcuts must not double-handle the same keypress (verified by test at the interaction level). |
| **REQ-10** | Arrow nudging is pinned end-to-end: 1 px plain, 10 px with Shift, direction per `arrowDirection`, mode-aware (flow offsets durable x/y, absolute materializes), resolved through the P27 gesture engines, ONE commit per keypress. |
| **REQ-11** | Keyboard shortcuts never fire when the event target is inside an input, textarea, select, contenteditable — including code-editor surfaces — or `[role=textbox]`; a keydown at a focused typing surface leaves the project, history and selection untouched. |
| **REQ-12** | All P28 overlay chrome (layer buttons, group/ungroup, context menu) is editor-only, pointer-events-disciplined per the existing overlay plane rules, and never rewrites the selection it operates on (P27 REQ-12 exclusion preserved); a pointerdown on layer/group chrome must not start a marquee or rewrite `selection.ids`. |
| **REQ-13** | No regression to single-element selection, composite multi-selection, marquee, snap guides, batch drag or nudge contracts: `canvas-selection`, `canvas-marquee`, `canvas-geometry`, `canvas-transform`, `canvas-batch-drag`, `canvas-snap`, `canvas-snap-lines`, `canvas-overlay-targeting`, `canvas-nested-selection`, `canvas-interaction-store` suites stay green byte-for-byte unless extended additively. |
| **REQ-14** | Zero durable schema pollution: selection, clipboard payload, context-menu state and any other P28 transient key live only in `useCanvasInteractionStore` (cleared by `reset()`); `serializeProject()` is byte-identical before/after any P28 operation that is followed by undo. |
| **REQ-15** | `formatVersion: 3`, `DATABASE_VERSION = 9`, the export pipeline, the sandbox model and the AI-plan surface are unchanged; no persistence/export/sandbox/CRDT file is touched. |
| **REQ-16** | Fail-closed everywhere: absent tree, stale/purged ids, unmeasurable rects, nesting-policy rejections, or a failed batch apply never throw and never commit a partial batch (`applyElementOpBatch` stop-at-first-failure preserved). |
| **REQ-17** | Legacy `custom-block` keeps its frozen single-target click contract; P28 operations are available exactly where the P25 D6 gate renders manipulable elements, via the same shared predicate — no private re-implementation. |
| **REQ-18** | Every new transient store key P28 introduces is cleared by `reset()` and pinned in `canvas-interaction-store.test.ts`. |

---

## 5. Invariants (must hold at every commit in this phase)

| Invariant | Why it must hold |
|---|---|
| **Single-history entry per operation (Invariant 1)** | Every P28 operation builds ONE tree on the transient side (pure ops via `applyElementOpBatch` / `applyPasteOps`), then commits ONCE through `commitElementTree` → `prepareDurableSectionCommit` → `withHistory`. No nested history, no second commit path, no per-op commits inside a batch. Undo restores the exact pre-operation tree. |
| **Zero transient selection pollution (Invariant 2)** | Selection, clipboard payload, context-menu state and group-selection writes live ONLY in the transient interaction store; nothing selection-shaped enters the durable document, the serialized JSON, or the editor store. `serializeProject()` is byte-identical across any P28 interaction (REQ-14). |
| **P25–P27 behaviours unregressed (Invariant 3)** | Single-element overlay, composite box, marquee (intersection rule, producer precedence), snap guides (thresholds, provenance, spans), batch drag (one entry, exact undo), rAF coalescing and nudge behave byte-for-byte as at `1b54738` (REQ-13). |
| **Keyboard never hijacks text input (Invariant 4)** | `isTypingTarget`/`TYPING_SELECTORS` is the first gate of `matchCanvasShortcut` and is modified only additively (if at all); every new chord inherits the guard; interaction tests pin isolation for input, textarea, contenteditable and code-editor surfaces (REQ-11). |
| **Children-order stacking (Invariant 5)** | z-order is expressed through sibling order; `geometry.zIndex` is never written by P28; DOM/stack order follows tree order deterministically after every operation (REQ-6). |
| **Section-bounded operations (Invariant 6)** | Reorder, group, ungroup, delete, duplicate, copy and paste cannot reach across sections or above the section root: ids are tree-validated against the active section's tree, roots are skipped/rejected, and the commit path is the section's own durable boundary. |
| **Plan purity analog for structure ops** | All group/ungroup/reorder math is pure (tree in → tree/ops out, structured errors); the durable tree is written only at commit; preview/selection state never mutates the tree. |
| **Non-gesture surfaces frozen** | Export, preview, share, thumbnails, AI plans, persistence, CRDT bridge — untouched (§1.3, REQ-15). |

---

## 6. Test & verification strategy

### 6.1 Targeted unit tests (Vitest, `testTimeout: 10_000`)

| Suite | What it must pin |
|---|---|
| `canvas/__tests__/canvas-ops.test.ts` *(exists — extend the layering block)* | Reorder boundary conditions: first-sibling backward and last-sibling forward are identity no-ops; front/back of an already-polar position is a no-op; multi-select relative-order preservation for all four actions; emission order stays correct under SEQUENTIAL op application (apply the emitted ops and assert the final order); root ids skipped; unknown ids ignored; ids spanning multiple parents reorder only within their own parents. |
| `elements/__tests__/element-grouping.test.ts` *(new)* | `groupElements`/`ungroupElements` math: group creation inserts at the top of the local stack with members in bottom-most-first order; member coordinate translation (parent-relative → group-relative, exact values incl. negative and fractional); dissolution inverse translation; flow-mode members keep `mode: "flow"`; group node geometry equals the member bounding box; every fail-closed precondition (cross-parent, root id, locked member, nesting rejection, single member, missing node) returns a structured error and leaves the input tree untouched; **round-trip property** — group → ungroup restores member geometry/styles/order and the parent's child sequence bit-exactly. |
| `canvas/__tests__/canvas-shortcuts.test.ts` *(new, or extend `canvas-ops.test.ts`)* | Keyboard delta multipliers: `nudgeAmount(false) === 1`, `nudgeAmount(true) === 10`; `arrowDirection` for all four arrows (and identity for non-arrows); `matchCanvasShortcut` maps Delete/Backspace/mod-guard/Escape/arrows/chords exactly as P22-B defined, plus the new additive chords (OQ-4) incl. their modifier guards; **typing-target isolation**: `isTypingTarget` true for input/textarea/select/contenteditable/`[role=textbox]` targets and ancestors, and `matchCanvasShortcut` returns `null` for a keydown on each. |
| `canvas/__tests__/canvas-clipboard.test.ts` *(new, or extend `canvas-ops.test.ts`)* | Clipboard subtree duplication: multi-element copy carries top-level members + descendants in one flat list; paste assigns FRESH ids to every node and remaps children; offset applied to geometry (24 px default); `_`-props stripped; version mismatch / malformed / > 200-node payloads rejected; `applyPasteOps` atomicity — a nesting-policy failure leaves the input tree untouched. |

### 6.2 Component & interaction tests (Testing Library)

| Suite | What it must pin |
|---|---|
| `canvas/__tests__/canvas-keyboard.test.tsx` *(new)* | Interaction-level keyboard isolation and commit discipline: keydown with an active element selection dispatches the element handler exactly once and the section-level handler does not double-fire (REQ-9); a keydown dispatched at a focused `<input>`/`<textarea>`/`contenteditable` inside the canvas produces ZERO mutations in project, history and selection (REQ-11); nudge keypress → exactly one `history.past` increment with the exact 1 px/10 px delta; Delete → one history entry, selection cleared, undo restores. |
| `canvas/__tests__/canvas-structure-ops.test.tsx` *(new)* | Hook-level group → ONE history entry (exact undo); ungroup → ONE history entry and bit-exact restore; reorder chord → ONE history entry and correct final sibling order; layer/group chrome pointerdown does NOT rewrite the selection or start a marquee (REQ-12); locked-member selections no-op fail-closed. |
| `canvas/__tests__/canvas-overlay-targeting.test.tsx` *(exists — extend additively)* | Layer-order affordances render on the single box and the composite box chrome; context menu surfaces the same actions; single-element and composite P27 rendering is unchanged otherwise. |

### 6.3 E2E (Playwright, `--workers=1`, deterministic helpers — no arbitrary sleeps)

Not part of the mandatory gate list for this phase (§6.4), but any E2E spec added MUST be committed
in the same phase (P27 spec §6.4 discipline). The natural candidate, deferred by P27 as follow-up
#1, remains `e2e/canvas-multi-select.spec.ts`; a P28 candidate would extend it with
reorder/group/delete chords. [inference — optional; the phase exit requirement is §6.4.]

### 6.4 Required gate order (sequential, never concurrent)

```
npm run typecheck   →   npm run lint   →   npm test (vitest, testTimeout: 10_000)   →   npm run build   →   npm run test:export-build
```

Known pre-existing E2E flake families (`workspace-version-history` post-restore reload race,
`realtime-structure` `STALE_REVISION` mock race) must be classified per the established discipline
if a run is executed — never silently excluded.

### 6.5 Known hazards to plan around (documented pre-existing — not introduced here)

1. **`boundedErrorToken` / `.next/dev/types` artifact** — source-only typecheck mitigation
   (`.p24b-tsconfig.json`, gitignored) if the E2E-regenerated artifact trips the default config;
   record which was used.
2. **Export-build cold-cache fragility** — passes warm (~51–57 s band across P26/P27); has timed
   out cold (> 600 s).
3. **Pre-existing ESLint warning** — `e2e/ai-element-editing.spec.ts:310` (`reviewAndApply`).
4. **`commitSectionTree`/`commitElementTree` duplication** — inherited P26 OQ-7 / P27 follow-up #8;
   P28 keeps `commitElementTree` and does not consolidate (out of scope), carrying the follow-up
   forward.

---

## 7. Risks & mitigations

| # | Risk | Mitigation |
|---|---|---|
| R1 | **Double-handling of Delete/Cmd+D** between the new element-level handlers and the pre-existing section-level shortcuts. | F3/REQ-9: element handlers gate on a non-empty tree-valid element selection; a dedicated interaction test pins that exactly one handler acts per keypress. |
| R2 | **Ungroup translation drift** (rounding, missing coordinates, flow-mode members) silently corrupts layout. | D4's exact-inverse math + the bit-exact round-trip unit test (REQ-4); coordinates translate additively with 0-fallbacks matching the nudge precedent; flow members keep their mode (REQ-5). |
| R3 | **Sequential `move` op application lands members at wrong indices** if the call site re-sorts ops. | F1: `buildLayerOps`' emission order is load-bearing and already tested; the wiring applies ops verbatim via `applyElementOpBatch`; the extended `canvas-ops` tests apply the emitted ops and assert final order. |
| R4 | **Grouping changes visual stacking.** | D2: the group node inserts at the max member index (top of local stack) and members ride inside it in their previous relative order — net visual order is unchanged; REQ-6 pins children-order determinism. |
| R5 | **`group` type leaks into surfaces that must not know about it** (custom-code gating, nesting defaults, inspector). | OQ-1 Option A rides the existing registry pipeline (definition declares its own `canHaveChildren`/nesting/defaults); `elementSupportsCustomCode` and inspector schemas derive from the registry, so the new family is inert-by-default; distribution stripping already covers every tree location generically. |
| R6 | **Keyboard chords collide with browser/OS reserved combos.** | D7: the mod-guard rule extends to all new chords; browser-reserved combinations are never intercepted; OQ-4 records the final chord table. |
| R7 | **Copy/paste bound to the wrong parent** (paste under the section root when the copied set lived deeper). | D6: paste targets the copied set's original parent when it still exists, else the section root; pinned in the clipboard suite. |
| R8 | **Selection writes after structural ops leak into durable state.** | Invariant 2 + REQ-14: post-op selection writes are transient-store-only; `serializeProject()` byte-identity is pinned. |
| R9 | **Store key proliferation.** | REQ-18: every new transient key is cleared by `reset()` and pinned in `canvas-interaction-store.test.ts`. |

---

## 8. Likely implementation areas **[inference — file-level surface, not a committed diff plan]**

| Area | File | Expected nature of change |
|---|---|---|
| Group/ungroup math | `src/features/elements/engine/` (new module, or additive exports in `element-operations.ts`) | Pure `groupElements`/`ungroupElements` op builders (D3/D4) — no React, no store, structured errors. |
| Element model (only if OQ-1 Option A) | `src/features/elements/types.ts`, `registry/default-elements.ts`, `schemas/element-schemas.ts` | Additive `"group"` element-only family: one type entry + one registry definition + schema coverage via the existing element-family machinery. No migration, no version bump. |
| Layer-order wiring | `src/features/canvas/hooks/useCanvasManipulation.ts` (or the layer's commit path) | `layerAction(action)` handler: resolve → `buildLayerOps` → `applyElementOpBatch` → ONE commit (D1). |
| Keyboard dispatch | `src/features/canvas/hooks/useCanvasKeyboard.ts`, `engine/shortcuts.ts` | Additive `CanvasShortcut` variants + chord table (D7); dispatcher cases. **Correction to the brief's file list:** the keyboard hook is `useCanvasKeyboard.ts` (there is no `useCanvasKeyboardShortcuts.ts` in the tree). |
| Keyboard mount + element handlers | `src/features/canvas/components/CanvasManipulationLayer.tsx` | Element-selection-aware `enabled()` gate; wire `onDelete`/`onDuplicate` (D5/D6); selection-bound `onCopy`/`onPaste` (F2); context-menu plumbing. |
| Overlay chrome | `src/features/canvas/components/SelectionOverlay.tsx` | Layer-order + group/ungroup affordances on the single box and composite chrome — additive props; P27 rendering unchanged otherwise (REQ-13). |
| Transient store | `src/features/canvas/store/canvas-interaction-store.ts` | At most: context-menu transient key; `reset()` clears it (REQ-18). No durable surface. |
| Commit boundary | `src/features/editor/store/editor-store.ts` | **No change expected** — all operations route through the existing `commitElementTree` boundary (D8). |
| Export/persistence/CRDT/AI | `src/features/export/**`, `persistence/**`, `collaboration/**`, `ai-editing/**`, `ai-copilot/**` | **No change expected** (§1.3, REQ-15). |
| Tests | §6.1–§6.2 suites | Per §6. |

---

## 9. Open questions (require review/decision before implementation)

| # | Question | Why it matters |
|---|---|---|
| **OQ-1** | Group node representation: new additive element-only `"group"` type (proposed) vs reuse of `container`/`stack`? | D2 — the only net-new model surface in the phase; determines registry/schema work and chrome/inspector semantics (R5). |
| **OQ-2** | Group bounding box for sets containing flow-mode members: measured-rect-derived box with members keeping flow offsets (proposed), or flow members excluded from grouping? | D3 — grouping flow elements must not imply a layout-mode conversion (P27 D4/OQ-6 discipline; §1.3 item 3). |
| **OQ-3** | Layer-order UI surface: overlay action bar + context menu (proposed) vs context menu only vs inspector-only? | D1 — chrome placement and test surface (REQ-12). |
| **OQ-4** | Keyboard chord table for layer/group actions: Cmd/Ctrl+`]`/`[` + Cmd/Ctrl+Shift+`]`/`[` and Cmd/Ctrl+G / Cmd/Ctrl+Shift+G (proposed, Canva-convention) or alternatives? | D7 — chord collisions with browser/OS combos must be checked before implementation (R6). |
| **OQ-5** | Ungroup style disposition: group's own style tokens dropped (proposed) vs inherited by members? | D4 — inheritance silently rewrites member styling; dropping is conservative and undo-recoverable. |
| **OQ-6** | Delete confirm gating for element batches: none beyond existing gates (proposed — undo is the recovery path) or a confirm for large batches? | D5 — destructive-action parity with existing section-level delete. |
| **OQ-7** | Duplicate implementation: clipboard-path composition (proposed — reuses fresh-id/atomicity machinery) vs a composed `duplicate`-op batch; and does Cmd/Ctrl+D select the new copies (proposed: yes)? | D6/OQ-7 — determines the duplicate commit shape and post-op selection. |
| **OQ-8** | Post-ungroup selection: the former members become the selection (proposed — Canva behaviour) vs selection cleared? | Transient-only either way (Invariant 2); affects UX continuity and overlay fallback paths. |

---

## 10. Deliverables

1. `docs/phase-p28-spec.md` — this document.
2. Implementation slices with their own commits, at minimum: **Slice 1** layer ordering (engine
   wiring + overlay/context-menu chrome + reorder chords) (S1, D1, OQ-3/OQ-4); **Slice 2** grouping
   & ungrouping (element-engine math + type decision + chords) (S2, D2/D3/D4, OQ-1/OQ-2/OQ-5);
   **Slice 3** keyboard ergonomics (element delete/duplicate/copy/paste wiring + nudge coverage)
   (S3, D5/D6/D7, OQ-6/OQ-7/OQ-8); **Slice 4** tests + verification (S4).
3. `docs/phase-p28-report.md` — outcome, verified changes per slice, invariant confirmations with
   evidence, gate results table, flake classification, and recorded follow-ups.
4. Answers to OQ-1 … OQ-8 recorded in the report, even when resolved by implementation.

---

## 11. STOP

This document specifies only. It modifies no source file, no test, and no schema; it changes no
version constant, no cap, and no sandbox property. Implementation must not begin until **OQ-1**
(group node representation) and **OQ-2** (flow-mode members in groups) are answered, because
together they define what the grouping slice actually ships; **OQ-4** (chord table) must be
answered before any keyboard slice lands.
