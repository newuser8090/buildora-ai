"use client";

// ---------------------------------------------------------------------------
// CanvasManipulationLayer (Phase P22-B) — editor-only interaction surface
//
// Mounted INSIDE the editor's preview content (the canonical section
// renderer). Responsibilities:
//   - keeps the transient selection in sync with the editor's section
//     selection (selection is UI state, never persisted)
//   - measures the selected section's bounding rect (zoom/scroll aware)
//   - renders the SelectionOverlay (bounding box, dims chip, quick actions,
//     and — where geometry is durable — transform handles)
//   - converts pointer coordinates, runs move/resize/rotate sessions, and
//     commits geometry ONCE per gesture through the editor store boundary
//     (commitElementTree → withHistory → one undo entry)
//   - wires canvas keyboard shortcuts that do NOT collide with the existing
//     section-level shortcuts (Escape / Cmd+C / Cmd+V / arrows)
//
// Phase P25 (Slice 2, decisions D3/D6): the layer is also the canvas's nested
// ELEMENT SELECTION PRODUCER. A pointerdown on an element node carrying
// `data-element-id` / `data-block-id` writes a single nested element focus to
// the transient interaction store (`setSelection([elementId])`), and a
// pointerdown on section/canvas background mirrors the section root. The
// section-sync effect yields to an active element focus so the two writers can
// never fight (D3). Selection remains UI state only — never persisted, never
// history, never synchronized.
//
// Phase P25 (Slice 3, decisions D6/S3): the overlay and the transform handles
// TARGET the selection. When a single nested element is focused, the bounding
// box, dims chip and 8 resize/rotate handles are measured from that element's
// own DOM node (`[data-block-id]` / `[data-element-id]`), and a gesture commits
// geometry for that element id on the owning section's durable tree. With no
// element focused (section-root selection) the box frames the section container
// `[data-section-id]` exactly as before. Handles render only for sections the
// canvas actually renders through `BlockRenderer` — `custom-block`, or a
// durable tree whose custom code the export emits (D8) — so D6's clamp stays
// export-aligned instead of widening to props-rendered sections. Nested focus
// is produced for the durable tree path only; legacy `custom-block` keeps its
// frozen canvas selection contract (see the producer below, D3).
//
// Phase P27 (Slice 1, decisions D1/D1b/D1c/D2): the layer also hosts the
// element MARQUEE. A pointer drag on the section/canvas background (never on
// an element node, overlay handle or control) starts the marquee gesture; the
// hook drives it on window pointermove/pointerup and resolves the intersecting
// element ids of the active section into the transient selection (OQ-1
// intersection model, topLevelResolution). A background CLICK (no drag) keeps
// the frozen P25 section-root contract: the producer writes the section root
// immediately on pointerdown, and an empty marquee re-applies it on release.
// While the marquee is active a dashed rectangle is rendered (D1c). Element
// nodes of manipulation-enabled sections are ALWAYS measured (D2), so the
// marquee can hit-test every candidate of the active section.
//
// Phase P27 (Slice 3, decisions D5/D6): during an active MOVE gesture the
// layer renders the visual snap guides (SnapGuides) — 1px alignment lines fed
// by the transient interaction store's `snapGuides` (published by the gesture
// drive path, one store write per frame). Guides are editor-only overlay
// chrome: pointer-events:none, transient, cleared on gesture end/cancel.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from "react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import {
  durableTreeEnablesCustomCode,
  sectionToElementTree,
} from "@/features/elements/adapters/section-element-adapter";
import { isCustomBlockSection } from "@/features/blocks/adapters/section-block-adapter";
import { useCanvasInteractionStore } from "../store/canvas-interaction-store";
import {
  marqueeRect,
  purgeSelection,
  singleNestedSelectionId,
} from "../engine/selection";
import type { BaseSection } from "@/types/section";
import type { Project } from "@/types/project";
import { useCanvasManipulation } from "../hooks/useCanvasManipulation";
import { useCanvasKeyboard } from "../hooks/useCanvasKeyboard";
import { SelectionOverlay } from "./SelectionOverlay";
import { SnapGuides } from "./SnapGuides";
import { clientToCanvas, type CanvasFrame } from "../engine/coords";
import { compositeSelectionBox, type ElementRect } from "../engine/geometry";
import {
  applyPasteOps,
  buildPasteOps,
  copySelection,
  parseClipboard,
  serializeClipboard,
} from "../engine/clipboard";
import { DEFAULT_SNAP_OPTIONS } from "../engine/snap";
import type { LayerAction } from "../engine/layering";

export interface CanvasManipulationLayerProps {
  /** The scrollable preview content element (data-preview-root). */
  contentRef: React.RefObject<HTMLDivElement | null>;
}

/** Find a section anywhere in the project (the owner of a clicked node). */
function findSection(project: Project, sectionId: string): BaseSection | null {
  for (const page of project.pages) {
    const found = page.sections.find((s) => s.id === sectionId);
    if (found) return found;
  }
  return null;
}

export function CanvasManipulationLayer({ contentRef }: CanvasManipulationLayerProps) {
  // ---- Editor store (durable + selection source of truth) ----
  const selectedSectionId = useEditorStore((s) => s.selectedSectionId);
  const selectedPageId = useEditorStore((s) => s.selectedPageId);
  const project = useEditorStore((s) => s.project);
  const zoom = useEditorStore((s) => s.zoom);
  const clearSelection = useEditorStore((s) => s.clearSelection);
  const commitElementTree = useEditorStore((s) => s.commitElementTree);
  const duplicateSection = useEditorStore((s) => s.duplicateSection);
  const deleteSection = useEditorStore((s) => s.deleteSection);

  // ---- Transient interaction store ----
  const selectionIds = useCanvasInteractionStore((s) => s.selection.ids);
  const anchorId = useCanvasInteractionStore((s) => s.anchorId);
  const previewRects = useCanvasInteractionStore((s) => s.previewRects);
  const previewRotation = useCanvasInteractionStore((s) => s.previewRotation);
  const setClipboard = useCanvasInteractionStore((s) => s.setClipboard);
  const clipboard = useCanvasInteractionStore((s) => s.clipboard);

  const activePage = project.pages.find((p) => p.id === selectedPageId) ?? project.pages[0];
  const section = activePage?.sections.find((s) => s.id === selectedSectionId) ?? null;
  const isCustomBlock = !!section && isCustomBlockSection(section);
  // P27 D2 — the measurement/marquee gate is the SAME export-aligned predicate
  // the P25 handle gate uses (never a private re-implementation).
  const isManipulableSection =
    !!section && (isCustomBlock || durableTreeEnablesCustomCode(section));

  // Materialized element tree for the selected section (the manipulation target).
  const tree = useMemo(() => (section ? sectionToElementTree(section) : null), [section]);

  // ---- Overlay target: focused element → composite multi-selection → root ----
  // The producer (D3) writes both `selection.ids` and `anchorId`; resolving
  // through BOTH means a single nested focus frames the element, while an
  // empty/ambiguous/stale selection falls back to the section container. Only
  // ids that are genuinely NESTED in this section's tree resolve, so a stale
  // id from another section can never frame the wrong DOM node.
  //
  // P27 Slice 2 (D7/D7b): a MULTI-selection of this tree's nested elements
  // renders the COMPOSITE box around the union of the elements' measured
  // rects — the frozen single-element and section-root contracts are
  // unchanged. `batchIds` keeps selection order, tree-validated + purged
  // (stale/foreign ids can never join), and is the same list the gesture
  // layer resolves through topLevelSelection + locked exclusion.
  const nestedSelectionId = useMemo(() => {
    if (!tree) return null;
    // P27 Slice 2 (D7): a MULTI-selection renders the COMPOSITE box — the
    // single-element box must not leak through the anchor fallback.
    if (selectionIds.length > 1) return null;
    return (
      singleNestedSelectionId(tree, selectionIds) ??
      singleNestedSelectionId(tree, anchorId ? [anchorId] : [])
    );
  }, [tree, selectionIds, anchorId]);

  const batchIds = useMemo(() => {
    if (!tree || selectionIds.length <= 1) return [];
    return purgeSelection(tree, selectionIds).filter(
      (id) => !tree.rootIds.includes(id),
    );
  }, [tree, selectionIds]);
  const isComposite = batchIds.length > 1;

  const targetId = nestedSelectionId ?? (isComposite ? "__composite__" : null) ?? selectedSectionId;

  // ---- P28 Slice 1 (D1): layer-order context ----
  // The ids a layer action targets: the composite batch set, else the single
  // nested focus; EMPTY for the section-root selection (root-level ordering
  // is page-level section ordering, NOT layer ordering — the engine skips
  // roots by contract).
  const layerTargetIds = useMemo(() => {
    if (!tree) return [];
    if (isComposite) return batchIds;
    if (nestedSelectionId) return [nestedSelectionId];
    return [];
  }, [tree, isComposite, batchIds, nestedSelectionId]);

  // Gate (spec §1.3 item 8): layer actions are available exactly where the
  // P25 D6 predicate says the canvas renders/manipulates the tree — ordering
  // a props-rendered legacy section would not be WYSIWYG (the template, not
  // the tree, drives that DOM order).
  const hasLayerSelection = layerTargetIds.length > 0 && isManipulableSection;

  // Per-action boundary flags (REQ-1): an action that cannot move the set is
  // a guaranteed no-op — the chrome disables its button. Every target's OWN
  // parent edge counts (multi-parent sets inherit the union's reach).
  const layerBoundaries = useMemo(() => {
    if (!tree || layerTargetIds.length === 0) return { atFront: false, atBack: false };
    let atFront = true;
    let atBack = true;
    for (const id of layerTargetIds) {
      const parentId = tree.nodes[id]?.parentId;
      if (!parentId) continue;
      const siblings = tree.nodes[parentId]?.children ?? [];
      if (siblings[siblings.length - 1] !== id) atFront = false;
      if (siblings[0] !== id) atBack = false;
    }
    return { atFront, atBack };
  }, [tree, layerTargetIds]);

  // ---- Coordinate frame (zoom/scroll aware) ----
  const frame = useCallback((): CanvasFrame | null => {
    const el = contentRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      width: el.clientWidth,
      height: el.clientHeight,
      zoom,
      scrollLeft: el.scrollLeft,
      scrollTop: el.scrollTop,
    };
  }, [contentRef, zoom]);

  // ---- Measure rects in logical canvas coordinates ----
  // Every section container is measured (snap targets / section-root overlay),
  // and — when a nested element is focused — that element's OWN DOM node is
  // measured too, keyed by the element id, so the overlay and the transform
  // gestures target the element rather than its section (P25 D6/S3).
  const measureRects = useCallback((): Record<string, ElementRect> => {
    const el = contentRef.current;
    if (!el) return {};
    const f = frame();
    if (!f) return {};
    const scale = zoom / 100;
    const measure = (node: HTMLElement): ElementRect => {
      const r = node.getBoundingClientRect();
      const origin = clientToCanvas(r.left, r.top, f);
      return { x: origin.x, y: origin.y, width: r.width / scale, height: r.height / scale };
    };

    const out: Record<string, ElementRect> = {};
    const sectionEl = section
      ? el.querySelector(`[data-section-id="${CSS.escape(section.id)}"]`)
      : null;
    for (const s of activePage?.sections ?? []) {
      const node = el.querySelector(`[data-section-id="${CSS.escape(s.id)}"]`);
      if (!(node instanceof HTMLElement)) continue;
      out[s.id] = measure(node);
    }

    if (sectionEl instanceof HTMLElement && isManipulableSection) {
      // P27 Slice 1 (D2): element nodes of a manipulation-enabled section are
      // ALWAYS measured — not only when one is focused — so the marquee can
      // hit-test every candidate of the active section, and Slice 2's
      // composite box can union the selected elements' rects. Bounded by the
      // tree normalizer's node cap; `data-element-id` wins over
      // `data-block-id`.
      const nodes = sectionEl.querySelectorAll("[data-element-id], [data-block-id]");
      for (const node of nodes) {
        if (!(node instanceof HTMLElement)) continue;
        const id =
          node.getAttribute("data-element-id") ?? node.getAttribute("data-block-id");
        if (!id || out[id] !== undefined) continue;
        out[id] = measure(node);
      }
    } else if (sectionEl instanceof HTMLElement && nestedSelectionId) {
      // Legacy sections without durable geometry keep the P25 behaviour: only
      // the focused element's own node is measured.
      const target = sectionEl.querySelector(
        `[data-block-id="${CSS.escape(nestedSelectionId)}"], [data-element-id="${CSS.escape(nestedSelectionId)}"]`,
      );
      if (target instanceof HTMLElement) {
        out[nestedSelectionId] = measure(target);
      }
    }
    return out;
  }, [contentRef, frame, zoom, activePage, section, nestedSelectionId, isManipulableSection]);

  // ---- Durable commit path (ONE history entry per gesture) ----
  // The gesture engine builds `update-geometry` ops for the selected ids (a
  // nested element id included) and `applyElementOpBatch` applies them through
  // the element engine's `updateElementGeometry`, so a nested transform writes
  // `node.geometry` on the owning section's durable tree in exactly ONE entry.
  // (Declared before the pointerdown listeners so the marquee trigger can
  // reach `api` — P27 Slice 1.)
  const commit = useCallback(
    (nextTree: ReturnType<typeof sectionToElementTree>) => {
      if (!activePage || !section) return;
      commitElementTree(activePage.id, section.id, nextTree);
    },
    [activePage, section, commitElementTree],
  );

  const snap = useCallback(
    () => ({ ...DEFAULT_SNAP_OPTIONS, enabled: useCanvasInteractionStore.getState().snapEnabled }),
    [],
  );

  const api = useCanvasManipulation({
    frame,
    tree: () => tree,
    rects: measureRects,
    commit,
    snap,
    onMarqueeEmpty: () => {
      // OQ-1: an empty marquee behaves like a background click — the frozen
      // P25 section-root contract.
      const editor = useEditorStore.getState();
      if (editor.selectedSectionId) {
        useCanvasInteractionStore.getState().setSelection([editor.selectedSectionId], {
          multi: false,
          anchorId: editor.selectedSectionId,
        });
      }
    },
  });

  // P28 Slice 1 (D1/D7): ONE layer-action handler shared by the overlay
  // chrome and the keyboard chords — one code path, N affordances. Gated by
  // the same P25 D6 predicate as the chrome itself.
  const handleLayerAction = useCallback(
    (action: LayerAction) => {
      if (!isManipulableSection) return;
      api.layerAction(action);
    },
    [api, isManipulableSection],
  );

  // ---- Selection sync: editor section selection → transient selection ----
  // Mirrored asynchronously (microtask) so the transient store write never
  // happens synchronously inside the effect body.
  //
  // Phase P25 (D3) precedence rule: the section-root mirror is written ONLY
  // when no element of the CURRENT section is focused. An explicit nested
  // element focus always wins until it is cleared — so a section/tree re-render
  // (or a project edit) can never clobber the element the inspector is showing.
  // The sync still fires when the active section genuinely changes or when the
  // current transient selection does not belong to the selected section.
  useEffect(() => {
    queueMicrotask(() => {
      // Re-read the FRESHEST store state inside the microtask so a queued
      // microtask from a previous section can never clobber a newer element
      // focus with stale data.
      const editor = useEditorStore.getState();
      const sectionId = editor.selectedSectionId;
      const interaction = useCanvasInteractionStore.getState();
      if (!sectionId) {
        interaction.clearSelection();
        return;
      }
      const owner = findSection(editor.project, sectionId);
      const freshTree = owner ? sectionToElementTree(owner) : null;
      if (freshTree && singleNestedSelectionId(freshTree, interaction.selection.ids)) return;
      // P27 Slice 2 (D5): a valid MULTI-selection of this section's nested
      // nodes also survives sync — a durable-tree commit re-materializes the
      // section (new `tree` reference → this effect re-fires) and must never
      // collapse the batch selection to the section root mid-workflow.
      if (
        freshTree &&
        interaction.selection.ids.length > 1 &&
        interaction.selection.ids.every(
          (id) =>
            freshTree.nodes[id] !== undefined && !freshTree.rootIds.includes(id),
        )
      ) {
        return;
      }
      interaction.setSelection([sectionId], { multi: false, anchorId: sectionId });
    });
  }, [selectedSectionId, tree]);

  // Stable marquee-start callback (destructured so the producer effect below
  // can depend on the function itself, not the per-render `api` object).
  const { handleMarqueeStart: marqueeStart } = api;

  // ---- Nested element selection producer (Phase P25, decision D3) ----
  // The canvas had no writer of nested element ids (F1), so P24-C's inspector
  // routing was unreachable at runtime. This listens for pointerdowns inside
  // the preview content and focuses the element node that was hit:
  //   - a node carrying `data-element-id` / `data-block-id` that resolves to a
  //     NESTED node of a section the P25 TREE PATH renders (a durable tree) →
  //     `setSelection([elementId])` (and selects the owning section if it was
  //     not already active);
  //   - the section ROOT node, section/canvas background, or any node inside a
  //     legacy `custom-block` → the section-root selection.
  //
  // Legacy `custom-block` is deliberately EXCLUDED from the nested write: its
  // element-selection surface is the build tree (P22-C), and its canvas click
  // contract (click bubbles to the container) is frozen by §5. D3 scopes the
  // write to non-`custom-block` sections for exactly this reason; widening it
  // would silently change every existing custom-block canvas flow.
  //
  // Pure transient write: no durable state, no history, no editor-store key.
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const target = event.target;
      if (!(target instanceof Element)) return;

      // The manipulation overlay's own chrome (move / resize / rotate handles,
      // quick actions) must never rewrite the selection it operates on.
      if (target.closest('[data-testid="canvas-selection-box"]')) return;

      const editor = useEditorStore.getState();
      const interaction = useCanvasInteractionStore.getState();

      const node = target.closest("[data-element-id], [data-block-id]");
      if (node) {
        const elementId =
          node.getAttribute("data-element-id") ?? node.getAttribute("data-block-id");
        const ownerSectionId =
          node.closest("[data-section-id]")?.getAttribute("data-section-id") ?? null;
        if (elementId && ownerSectionId) {
          const owner = findSection(editor.project, ownerSectionId);
          const ownerTree = owner ? sectionToElementTree(owner) : null;
          if (
            owner !== null &&
            !isCustomBlockSection(owner) &&
            ownerTree !== null &&
            ownerTree.nodes[elementId] !== undefined &&
            !ownerTree.rootIds.includes(elementId)
          ) {
            if (editor.selectedSectionId !== ownerSectionId) {
              editor.selectSection(ownerSectionId);
            }
            interaction.setSelection([elementId], { multi: false, anchorId: elementId });
            return;
          }
          // The section ROOT node, an unknown node, or a legacy custom-block
          // click is section-level (the frozen contract).
          interaction.setSelection([ownerSectionId], { multi: false, anchorId: ownerSectionId });
          return;
        }
      }

      // Background click → the selected section's root (never an element).
      // P27 Slice 1 (D1b): a background drag starts the element MARQUEE instead
      // — the hook drives it on window pointermove/pointerup and resolves the
      // intersecting element ids on release. The section-root write still
      // happens (below) so a plain CLICK keeps the frozen P25 contract; an
      // empty marquee re-applies it via onMarqueeEmpty. Only the manipulation
      // gate passes — the frozen custom-block click contract is unchanged.
      if (
        editor.selectedSectionId &&
        isManipulableSection &&
        marqueeStart({ x: event.clientX, y: event.clientY })
      ) {
        // Marquee started; the section-root write below still runs so the
        // background-click contract holds for a plain click.
      }
      if (editor.selectedSectionId) {
        interaction.setSelection([editor.selectedSectionId], {
          multi: false,
          anchorId: editor.selectedSectionId,
        });
      } else {
        interaction.clearSelection();
      }
    };

    el.addEventListener("pointerdown", onPointerDown);
    return () => el.removeEventListener("pointerdown", onPointerDown);
    // P27 D1b: `isManipulableSection` gates the marquee trigger;
    // `marqueeStart` is a stable hook callback, so the listener does not churn
    // per render.
  }, [contentRef, isManipulableSection, marqueeStart]);

  // ---- Measure the selected section's rect (re-measure on changes) ----
  const [measuredRect, setMeasuredRect] = useState<ElementRect | null>(null);
  // P27 Slice 2 (D7): the full measured map is kept so the composite union can
  // be computed at rest (the gesture's preview rects take over during a drag).
  const [measuredMap, setMeasuredMap] = useState<Record<string, ElementRect> | null>(null);
  useEffect(() => {
    // State writes happen inside `update` only — via a microtask for the
    // initial measure and via event listeners afterwards (never synchronously
    // inside the effect body).
    const update = () => {
      const rects = measureRects();
      setMeasuredMap(rects);
      setMeasuredRect(targetId ? (rects[targetId] ?? null) : null);
    };
    queueMicrotask(update);
    const el = contentRef.current;
    el?.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      el?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [targetId, measureRects, contentRef, project, zoom]);

  // The live marquee object (not a boolean) so the layer re-renders while the
  // marquee grows — the same per-move subscription pattern `previewRects` uses
  // during transform sessions. Layer-local render only; never a page re-render.
  const marqueeState = useCanvasInteractionStore((s) => s.marquee);

  // Preview rects are keyed by the gesture's element id, so the live drag
  // preview follows the same target (nested element or section root).
  // P27 Slice 2 (REQ-5): during a COMPOSITE drag the preview rects are per
  // element, so the union box is recomputed PER FRAME from the live previews —
  // never a snapshot captured at gesture start; at rest it unions the measured
  // rects.
  const compositeRect: ElementRect | null = useMemo(() => {
    if (!isComposite || batchIds.length === 0) return null;
    const source =
      previewRects && batchIds.every((id) => previewRects[id]) ? previewRects : measuredMap;
    const rects = batchIds.map((id) => source?.[id]).filter(Boolean) as ElementRect[];
    if (rects.length < batchIds.length) return null;
    return compositeSelectionBox(rects);
  }, [isComposite, batchIds, previewRects, measuredMap]);

  const displayedRect =
    targetId && previewRects && previewRects[targetId]
      ? previewRects[targetId]
      : measuredRect;

  // The composite box IS the multi-selection overlay (the per-element single
  // box is not rendered for a multi-set).

  // ---- Keyboard (avoids collisions with existing section shortcuts) ----
  useCanvasKeyboard({
    enabled: () => !!selectedSectionId,
    onDeselect: () => clearSelection(),
    onCopy: () => {
      if (!tree || !selectedSectionId) return;
      const payload = copySelection(tree, [selectedSectionId]);
      setClipboard(serializeClipboard(payload));
    },
    onPaste: () => {
      if (!tree || !selectedSectionId || !clipboard) return;
      const payload = parseClipboard(clipboard);
      if (!payload) return;
      const ops = buildPasteOps(tree, selectedSectionId, payload);
      const result = applyPasteOps(tree, ops);
      if (result.ok && result.tree) commit(result.tree);
    },
    onNudge: (dx, dy) => api.nudge(dx, dy),
    // P28 Slice 1 (D7): Cmd/Ctrl+]/[ (+Shift) dispatch the SAME handler the
    // overlay chrome uses — one code path, N affordances.
    onLayerAction: handleLayerAction,
  });
  if (!section) return null;

  const activeMarqueeRect = marqueeState
    ? marqueeRect(marqueeState.start, marqueeState.current)
    : null;

  return (
    <>
      {/* P27 Slice 2 (D7): the COMPOSITE box for a multi-selection — union
          rect, count chip, move affordance; no resize/rotate handles. A
          pointerdown on it starts a batch move (it never rewrites the
          selection it operates on — REQ-12). */}
      {isComposite && compositeRect && (
        <SelectionOverlay
          elementId="__composite__"
          selectionCount={batchIds.length}
          rect={compositeRect}
          rotation={previewRotation}
          manipulable={isCustomBlock || durableTreeEnablesCustomCode(section)}
          onMoveStart={api.handleMoveStart}
          onLayerAction={hasLayerSelection ? handleLayerAction : undefined}
          layerBoundaries={layerBoundaries}
        />
      )}
      {/* P27 Slice 3 (D5): the visual snap guide lines — rendered only while
          a move session publishes non-empty snapGuides; cleared on end/cancel.
          Editor-only overlay chrome, pointer-events:none. */}
      <SnapGuides />
      {/* P27 Slice 1 (D1c): the marquee rectangle — dashed outline + translucent
          fill, pointer-events:none, transient (never persisted). */}
      {activeMarqueeRect && (
        <div
          data-testid="canvas-marquee-rect"
          className="pointer-events-none absolute z-40 rounded-[2px] border border-dashed border-[#7c5cfc] bg-[#7c5cfc]/10"
          style={{
            left: activeMarqueeRect.x,
            top: activeMarqueeRect.y,
            width: activeMarqueeRect.width,
            height: activeMarqueeRect.height,
          }}
        />
      )}
      {displayedRect && (
        <SelectionOverlay
          elementId={targetId ?? section.id}
          rect={displayedRect}
          rotation={previewRotation}
          manipulable={isCustomBlock || durableTreeEnablesCustomCode(section)}
          onMoveStart={api.handleMoveStart}
          onRotateStart={api.handleRotateStart}
          onHandleStart={api.handleResizeStart}
          onDuplicate={() => duplicateSection(section.id)}
          onDelete={() => deleteSection(section.id)}
          // P28 Slice 1 (D1): layer controls ride the element/composite box —
          // absent for the section-root box (root ordering is page-level).
          onLayerAction={hasLayerSelection ? handleLayerAction : undefined}
          layerBoundaries={layerBoundaries}
        />
      )}
    </>
  );
}
