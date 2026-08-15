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
// Handles are rendered only for custom-block sections, whose element trees
// persist geometry durably. Regular sections get the selection box + quick
// actions; their geometry gains a durable home when the element renderer +
// tree persistence land (P22-C/D). Marquee selection is engine/store-ready
// and activates with the element renderer.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from "react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { sectionToElementTree } from "@/features/elements/adapters/section-element-adapter";
import { isCustomBlockSection } from "@/features/blocks/adapters/section-block-adapter";
import { useCanvasInteractionStore } from "../store/canvas-interaction-store";
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
  const previewRects = useCanvasInteractionStore((s) => s.previewRects);
  const previewRotation = useCanvasInteractionStore((s) => s.previewRotation);
  const setSelection = useCanvasInteractionStore((s) => s.setSelection);
  const clearInteractionSelection = useCanvasInteractionStore((s) => s.clearSelection);
  const setClipboard = useCanvasInteractionStore((s) => s.setClipboard);
  const clipboard = useCanvasInteractionStore((s) => s.clipboard);

  const activePage = project.pages.find((p) => p.id === selectedPageId) ?? project.pages[0];
  const section = activePage?.sections.find((s) => s.id === selectedSectionId) ?? null;
  const isCustomBlock = !!section && isCustomBlockSection(section);

  // Materialized element tree for the selected section (the manipulation target).
  const tree = useMemo(() => (section ? sectionToElementTree(section) : null), [section]);

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

  // ---- Measure every section in logical canvas coordinates ----
  const measureRects = useCallback((): Record<string, ElementRect> => {
    const el = contentRef.current;
    if (!el) return {};
    const f = frame();
    if (!f) return {};
    const out: Record<string, ElementRect> = {};
    const scale = zoom / 100;
    for (const s of activePage?.sections ?? []) {
      const node = el.querySelector(`[data-section-id="${CSS.escape(s.id)}"]`);
      if (!(node instanceof HTMLElement)) continue;
      const r = node.getBoundingClientRect();
      const origin = clientToCanvas(r.left, r.top, f);
      out[s.id] = {
        x: origin.x,
        y: origin.y,
        width: r.width / scale,
        height: r.height / scale,
      };
    }
    return out;
  }, [contentRef, frame, zoom, activePage]);

  // ---- Selection sync: editor section selection → transient selection ----
  // Mirrored asynchronously (microtask) so the transient store write never
  // happens synchronously inside the effect body.
  useEffect(() => {
    queueMicrotask(() => {
      if (selectedSectionId) {
        setSelection([selectedSectionId], { multi: false, anchorId: selectedSectionId });
      } else {
        clearInteractionSelection();
      }
    });
  }, [selectedSectionId, setSelection, clearInteractionSelection]);

  // ---- Measure the selected section's rect (re-measure on changes) ----
  const [measuredRect, setMeasuredRect] = useState<ElementRect | null>(null);
  useEffect(() => {
    // State writes happen inside `update` only — via a microtask for the
    // initial measure and via event listeners afterwards (never synchronously
    // inside the effect body).
    const update = () => {
      if (!selectedSectionId) {
        setMeasuredRect(null);
        return;
      }
      const rects = measureRects();
      setMeasuredRect(rects[selectedSectionId] ?? null);
    };
    queueMicrotask(update);
    const el = contentRef.current;
    el?.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      el?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [selectedSectionId, measureRects, contentRef, project, zoom]);

  const displayedRect =
    selectedSectionId && previewRects && previewRects[selectedSectionId]
      ? previewRects[selectedSectionId]
      : measuredRect;

  // ---- Durable commit path (ONE history entry per gesture) ----
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
          elementId={section.id}
          rect={displayedRect}
          rotation={previewRotation}
          manipulable={isCustomBlock && selectionIds.includes(section.id)}
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
