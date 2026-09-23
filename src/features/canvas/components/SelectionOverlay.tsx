"use client";

// ---------------------------------------------------------------------------
// SelectionOverlay (Phase P22-B) — editor-only transform surface
//
// Renders a bounding box around the selected element with 8 resize handles, a
// rotation handle, a move affordance, and a dimensions chip. It is an overlay
// AROUND the canonical renderer — never an alternate renderer. The container
// is pointer-events:none so element content stays fully interactive; only the
// handles/box edges capture pointer events.
//
// All coordinates are LOGICAL canvas units within the scroll container; the
// overlay is rendered inside the scaled frame so CSS pixels == logical px.
// ---------------------------------------------------------------------------

import { memo } from "react";
import type { ElementRect, ResizeHandle, Point } from "../engine/geometry";
import { RESIZE_HANDLES } from "../engine/geometry";
import type { LayerAction } from "../engine/layering";

const HANDLE_SIZE = 8;

const HANDLE_POSITION: Record<
  ResizeHandle,
  { left?: string; top?: string; right?: string; bottom?: string; transform?: string }
> = {
  nw: { left: "-4px", top: "-4px" },
  n: { left: "50%", top: "-4px", transform: "translateX(-50%)" },
  ne: { right: "-4px", top: "-4px" },
  e: { right: "-4px", top: "50%", transform: "translateY(-50%)" },
  se: { right: "-4px", bottom: "-4px" },
  s: { left: "50%", bottom: "-4px", transform: "translateX(-50%)" },
  sw: { left: "-4px", bottom: "-4px" },
  w: { left: "-4px", top: "50%", transform: "translateY(-50%)" },
};

export interface SelectionOverlayProps {
  /** Bounding rect in logical canvas units. */
  rect: ElementRect;
  /** Current rotation in degrees (drives the box transform). */
  rotation?: number;
  /** True when the transform handles should be rendered (durable geometry). */
  manipulable: boolean;
  /** Data id placed on the box for tests. */
  elementId: string;
  /**
   * P27 Slice 2 (D7): count of selected elements. 1 (default) renders the
   * byte-identical single-element box with handles; ≥2 renders the COMPOSITE
   * box — union rect, count chip, move affordance, NO resize/rotate handles
   * (multi-resize is out of scope).
   */
  selectionCount?: number;
  onMoveStart?: (point: Point) => void;
  onRotateStart?: (point: Point) => void;
  onHandleStart?: (handle: ResizeHandle, point: Point) => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
  /**
   * P28 Slice 1 (D1): layer ordering affordances — wired by the layer for
   * element/composite selections. Absent on the section-root box (page-level
   * section ordering owns the root surface).
   */
  onLayerAction?: (action: LayerAction) => void;
  /**
   * P28 Slice 1 (REQ-1): per-action boundary flags — the action is a no-op at
   * the corresponding sibling-stack boundary and the button reflects it.
   */
  layerBoundaries?: { atFront?: boolean; atBack?: boolean };
}

/** P28 Slice 1 (D1): the layer-order cluster — one button per action. */
const LAYER_ACTIONS: Array<{
  action: LayerAction;
  testId: string;
  label: string;
  disabledBy: "atFront" | "atBack" | null;
  icon: React.ReactNode;
}> = [
  {
    action: "front",
    testId: "canvas-layer-front",
    label: "Bring to Front",
    disabledBy: "atFront",
    icon: (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        {/* Box rising above a stack (Figma-style bring-to-front glyph). */}
        <rect x="8" y="3" width="13" height="13" rx="2" />
        <path d="M16 16v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2h3" />
      </svg>
    ),
  },
  {
    action: "forward",
    testId: "canvas-layer-forward",
    label: "Move Forward",
    disabledBy: "atFront",
    icon: (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="9" y="9" width="12" height="12" rx="2" />
        <path d="M15 5l4 4-4 4" />
      </svg>
    ),
  },
  {
    action: "backward",
    testId: "canvas-layer-backward",
    label: "Move Backward",
    disabledBy: "atBack",
    icon: (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="12" height="12" rx="2" />
        <path d="M9 19l-4-4 4-4" />
      </svg>
    ),
  },
  {
    action: "back",
    testId: "canvas-layer-back",
    label: "Send to Back",
    disabledBy: "atBack",
    icon: (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        {/* Box sinking beneath a stack (Figma-style send-to-back glyph). */}
        <rect x="3" y="8" width="13" height="13" rx="2" />
        <path d="M8 8V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-3" />
      </svg>
    ),
  },
];

export const SelectionOverlay = memo(function SelectionOverlay({
  rect,
  rotation = 0,
  manipulable,
  elementId,
  selectionCount = 1,
  onMoveStart,
  onRotateStart,
  onHandleStart,
  onDuplicate,
  onDelete,
  onLayerAction,
  layerBoundaries,
}: SelectionOverlayProps) {
  const dims = `${Math.round(rect.width)} × ${Math.round(rect.height)}`;
  const composite = selectionCount > 1;

  return (
    <div
      data-testid="canvas-selection-box"
      data-element-id={elementId}
      data-selection-count={composite ? selectionCount : undefined}
      className="pointer-events-none absolute z-30"
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        transform: `rotate(${rotation}deg)`,
        transformOrigin: "center",
      }}
    >
      {/* Outline */}
      <div
        className="absolute inset-0 rounded-[2px] border-2 border-[#7c5cfc]"
        style={{ boxShadow: "0 0 0 1px rgba(255,255,255,0.7)" }}
        aria-hidden="true"
      />

      {/* Composite count chip (P27 D7) — union dims + selected count. */}
      {composite && (
        <div
          data-testid="canvas-selection-count"
          className="absolute -bottom-7 left-0 rounded-md bg-[#1a2235] px-2 py-0.5 font-mono text-[11px] font-medium text-white shadow-sm"
          style={{ pointerEvents: "none" }}
        >
          {`${selectionCount} selected · ${dims}`}
        </div>
      )}

      {/* Move affordance: a thin grab strip along the top edge */}
      <div
        data-testid="canvas-move-handle"
        className="absolute -top-2 left-1/2 h-2 w-1/2 -translate-x-1/2 cursor-grab rounded-t-sm bg-[#7c5cfc]/0 active:cursor-grabbing"
        style={manipulable ? { pointerEvents: "auto" } : undefined}
        onPointerDown={(e) => {
          if (!manipulable) return;
          e.stopPropagation();
          e.preventDefault();
          onMoveStart?.({ x: e.clientX, y: e.clientY });
        }}
        aria-hidden={!manipulable}
      />

      {/* Resize handles — suppressed on the composite box (no multi-resize). */}
      {manipulable && !composite &&
        RESIZE_HANDLES.map((handle) => (
          <div
            key={handle}
            data-testid={`canvas-resize-handle-${handle}`}
            className="absolute cursor-nwse-resize rounded-[2px] border border-white/80 bg-[#7c5cfc]"
            style={{
              ...HANDLE_POSITION[handle],
              width: HANDLE_SIZE,
              height: HANDLE_SIZE,
              pointerEvents: "auto",
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onHandleStart?.(handle, { x: e.clientX, y: e.clientY });
            }}
          />
        ))}

      {/* Rotation handle — suppressed on the composite box. */}
      {manipulable && !composite && (
        <div
          data-testid="canvas-rotate-handle"
          className="absolute -top-9 left-1/2 cursor-grab rounded-full border border-white/80 bg-[#7c5cfc]"
          style={{
            width: 10,
            height: 10,
            transform: "translateX(-50%)",
            pointerEvents: "auto",
          }}
          onPointerDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onRotateStart?.({ x: e.clientX, y: e.clientY });
          }}
        />
      )}

      {/* Dimensions chip */}
      <div
        data-testid="canvas-selection-dims"
        className="absolute -bottom-7 left-0 rounded-md bg-[#1a2235] px-2 py-0.5 font-mono text-[11px] font-medium text-white shadow-sm"
        style={{ pointerEvents: "none" }}
      >
        {dims}
      </div>

      {/* P28 Slice 1 (D1): layer-order cluster — left of the quick actions.
          Rendered only when the layer wires `onLayerAction` (element and
          composite selections); never rendered on the section-root box. Every
          button stops propagation so chrome never rewrites the selection it
          operates on (P27 REQ-12 exclusion, inherited via the existing
          `canvas-selection-box` closest() guard). Disabled at stack
          boundaries (REQ-1). */}
      {onLayerAction && (
        <div
          data-testid="canvas-layer-actions"
          className="absolute -top-7 right-0 flex items-center gap-1 rounded-md bg-[#1a2235] pr-1.5 py-0.5 pl-1.5 shadow-sm"
          style={{ pointerEvents: "auto", transform: "translateX(calc(-100% - 16px))" }}
        >
          {LAYER_ACTIONS.map(({ action, testId, label, disabledBy, icon }) => {
            const disabled =
              (disabledBy === "atFront" && layerBoundaries?.atFront) ||
              (disabledBy === "atBack" && layerBoundaries?.atBack);
            return (
              <button
                key={action}
                type="button"
                data-testid={testId}
                data-action={action}
                className="flex h-5 w-5 cursor-pointer items-center justify-center rounded text-white/90 hover:bg-white/20 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
                disabled={disabled}
                aria-label={label}
                title={label}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  if (disabled) return;
                  onLayerAction(action);
                }}
              >
                {icon}
              </button>
            );
          })}
        </div>
      )}

      {/* Quick actions */}
      <div
        className="absolute -top-7 right-0 flex items-center gap-1 rounded-md bg-[#1a2235] px-1.5 py-0.5 shadow-sm"
        style={{ pointerEvents: "auto" }}
      >
        {onDuplicate && (
          <button
            type="button"
            data-testid="canvas-duplicate"
            className="flex h-5 w-5 cursor-pointer items-center justify-center rounded text-white/90 hover:bg-white/20"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onDuplicate();
            }}
            aria-label="Duplicate"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="9" width="13" height="13" rx="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            data-testid="canvas-delete"
            className="flex h-5 w-5 cursor-pointer items-center justify-center rounded text-white/90 hover:bg-white/20 hover:text-red-300"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            aria-label="Delete"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
});
