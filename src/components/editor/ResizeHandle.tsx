"use client";

// ---------------------------------------------------------------------------
// ResizeHandle (Phase P22-K) — accessible, deterministic panel divider
//
// A focusable separator that resizes an adjacent editor sidebar:
//   - pointer drag (Pointer Events + pointer capture, clamped by the caller)
//   - keyboard: ArrowLeft / ArrowRight adjust by 8px, Home/End jump to the
//     bounds (clamped by the caller)
//   - announced via role="separator" + aria-valuenow/min/max
//
// No external dependency. `multiplier` maps the drag direction to the panel:
//   +1 → dragging right grows the panel (left sidebar's right edge)
//   -1 → dragging right shrinks the panel (right sidebar's left edge)
// ---------------------------------------------------------------------------

import { useCallback, useRef } from "react";

export interface ResizeHandleProps {
  testId: string;
  label: string;
  value: number;
  min: number;
  max: number;
  /** +1 for the left sidebar (right edge), -1 for the right sidebar (left edge). */
  multiplier: 1 | -1;
  onChange: (nextWidth: number) => void;
  /** Fired while a pointer drag is active so the panel can drop its width
   *  transition (a live drag must track the pointer, not animate). */
  onDraggingChange?: (dragging: boolean) => void;
}

const KEY_STEP = 8;

export function ResizeHandle({
  testId,
  label,
  value,
  min,
  max,
  multiplier,
  onChange,
  onDraggingChange,
}: ResizeHandleProps) {
  // The drag anchor — pointer delta is always measured from the original
  // down position against the original width, so continuous drags never drift.
  const startRef = useRef<{ x: number; width: number } | null>(null);

  const applyDelta = useCallback(
    (delta: number, width: number) => {
      onChange(Math.min(max, Math.max(min, width + multiplier * delta)));
    },
    [min, max, multiplier, onChange],
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    const start = { x: e.clientX, width: value };
    startRef.current = start;
    // Native listeners + pointer capture keep the drag tracking even across
    // React re-renders (the panel width changes every move).
    el.setPointerCapture?.(e.pointerId);
    const onMove = (ev: PointerEvent) => {
      const anchor = startRef.current;
      if (!anchor) return;
      applyDelta(ev.clientX - anchor.x, anchor.width);
    };
    const onEnd = (ev: PointerEvent) => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onEnd);
      el.removeEventListener("pointercancel", onEnd);
      startRef.current = null;
      onDraggingChange?.(false);
      try {
        el.releasePointerCapture?.(ev.pointerId);
      } catch {
        // capture may already be released — best-effort
      }
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onEnd);
    el.addEventListener("pointercancel", onEnd);
    onDraggingChange?.(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Home") {
      e.preventDefault();
      onChange(min);
      return;
    }
    if (e.key === "End") {
      e.preventDefault();
      onChange(max);
      return;
    }
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      applyDelta(e.key === "ArrowRight" ? KEY_STEP : -KEY_STEP, value);
    }
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      data-testid={testId}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
      className="editor-panel-handle group relative z-10 flex w-1.5 flex-shrink-0 cursor-col-resize items-stretch justify-center outline-none"
    >
      {/* Hit area + visible divider */}
      <div className="absolute inset-y-0 left-1/2 w-[3px] -translate-x-1/2 rounded-full transition-colors duration-150 group-hover:bg-accent/30 group-focus-visible:bg-accent/50" />
    </div>
  );
}
