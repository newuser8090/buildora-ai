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
  onMoveStart?: (point: Point) => void;
  onRotateStart?: (point: Point) => void;
  onHandleStart?: (handle: ResizeHandle, point: Point) => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
}

export const SelectionOverlay = memo(function SelectionOverlay({
  rect,
  rotation = 0,
  manipulable,
  elementId,
  onMoveStart,
  onRotateStart,
  onHandleStart,
  onDuplicate,
  onDelete,
}: SelectionOverlayProps) {
  const dims = `${Math.round(rect.width)} × ${Math.round(rect.height)}`;

  return (
    <div
      data-testid="canvas-selection-box"
      data-element-id={elementId}
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

      {/* Resize handles */}
      {manipulable &&
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

      {/* Rotation handle */}
      {manipulable && (
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
