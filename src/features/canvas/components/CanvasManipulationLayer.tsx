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
// export-aligned instead of widening to props-rendered sections. Marquee
// selection is engine/store-ready; multi-element overlays remain out of scope
// (OQ-4).
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from "react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import {
  durableTreeEnablesCustomCode,
  sectionToElementTree,
} from "@/features/elements/adapters/section-element-adapter";
import { isCustomBlockSection } from "@/features/blocks/adapters/section-block-adapter";
import { useCanvasInteractionStore } from "../store/canvas-interaction-store";
import { singleNestedSelectionId } from "../engine/selection";
import type { BaseSection } from "@/types/section";
import type { Project } from "@/types/project";
import { useCanvasManipulation } from "../hooks/useCanvasManipulation";
import { useCanvasKeyboard } from "../hooks/useCanvasKeyboard";
import { SelectionOverlay } from "./SelectionOverlay";
import { clientToCanvas, type CanvasFrame } from "../engine/coords";
import type { ElementRect } from "../engine/geometry";
import {
  applyPasteOps,
  buildPasteOps,
  copySelection,
  parseClipboard,
  serializeClipboard,
} from "../engine/clipboard";
import { DEFAULT_SNAP_OPTIONS } from "../engine/snap";

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

  // Materialized element tree for the selected section (the manipulation target).
  const tree = useMemo(() => (section ? sectionToElementTree(section) : null), [section]);

  // ---- Overlay target: the focused nested element, else the section root ----
  // The producer (D3) writes both `selection.ids` and `anchorId`; resolving
  // through BOTH means a single nested focus frames the element, while an
  // empty/ambiguous/stale selection falls back to the section container. Only
  // ids that are genuinely NESTED in this section's tree resolve, so a stale
  // id from another section can never frame the wrong DOM node.
  const nestedSelectionId = useMemo(() => {
    if (!tree) return null;
    return (
      singleNestedSelectionId(tree, selectionIds) ??
      singleNestedSelectionId(tree, anchorId ? [anchorId] : [])
    );
  }, [tree, selectionIds, anchorId]);
  const targetId = nestedSelectionId ?? selectedSectionId;

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

    if (sectionEl instanceof HTMLElement && nestedSelectionId) {
      const target = sectionEl.querySelector(
        `[data-block-id="${CSS.escape(nestedSelectionId)}"], [data-element-id="${CSS.escape(nestedSelectionId)}"]`,
      );
      if (target instanceof HTMLElement) {
        out[nestedSelectionId] = measure(target);
      }
    }
    return out;
  }, [contentRef, frame, zoom, activePage, section, nestedSelectionId]);

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
      interaction.setSelection([sectionId], { multi: false, anchorId: sectionId });
    });
  }, [selectedSectionId, tree]);

  // ---- Nested element selection producer (Phase P25, decision D3) ----
  // The canvas had no writer of nested element ids (F1), so P24-C's inspector
  // routing was unreachable at runtime. This listens for pointerdowns inside
  // the preview content and focuses the element node that was hit:
  //   - a node carrying `data-element-id` / `data-block-id` that resolves to a
  //     NESTED node of its owning section's tree → `setSelection([elementId])`
  //     (and selects the owning section if it was not already active);
  //   - the section ROOT node, or section/canvas background → the section-root
  //     selection (`[selectedSectionId]`).
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
            ownerTree &&
            ownerTree.nodes[elementId] &&
            !ownerTree.rootIds.includes(elementId)
          ) {
            if (editor.selectedSectionId !== ownerSectionId) {
              editor.selectSection(ownerSectionId);
            }
            interaction.setSelection([elementId], { multi: false, anchorId: elementId });
            return;
          }
          // The section's ROOT node (or an unknown node) is section-level.
          interaction.setSelection([ownerSectionId], { multi: false, anchorId: ownerSectionId });
          return;
        }
      }

      // Background click → the selected section's root (never an element).
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
  }, [contentRef]);

  // ---- Measure the selected section's rect (re-measure on changes) ----
  const [measuredRect, setMeasuredRect] = useState<ElementRect | null>(null);
  useEffect(() => {
    // State writes happen inside `update` only — via a microtask for the
    // initial measure and via event listeners afterwards (never synchronously
    // inside the effect body).
    const update = () => {
      if (!targetId) {
        setMeasuredRect(null);
        return;
      }
      const rects = measureRects();
      setMeasuredRect(rects[targetId] ?? null);
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

  // Preview rects are keyed by the gesture's element id, so the live drag
  // preview follows the same target (nested element or section root).
  const displayedRect =
    targetId && previewRects && previewRects[targetId]
      ? previewRects[targetId]
      : measuredRect;

  // ---- Durable commit path (ONE history entry per gesture) ----
  // The gesture engine builds `update-geometry` ops for the selected ids (a
  // nested element id included) and `applyElementOpBatch` applies them through
  // the element engine's `updateElementGeometry`, so a nested transform writes
  // `node.geometry` on the owning section's durable tree in exactly ONE entry.
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
  });

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
  });

  if (!section) return null;

  return (
    <>
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
        />
      )}
    </>
  );
}
