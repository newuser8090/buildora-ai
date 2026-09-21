"use client";

// ---------------------------------------------------------------------------
// SnapGuides (Phase P27 Slice 3, D5/REQ-4) — visual alignment snap lines
//
// A pure renderer over the transient interaction store's `snapGuides`:
// one 1px line per active match, drawn at the matched value along its axis and
// spanning the perpendicular extent computed by `snapGuideLines`.
//
//   - `axis: "x"` → a VERTICAL line (x-coordinate match) at `guide.value`,
//     spanning `spanStart…spanEnd` in Y.
//   - `axis: "y"` → a HORIZONTAL line (y-coordinate match) at `guide.value`,
//     spanning `spanStart…spanEnd` in X.
//
// The overlay plane is pointer-events:none and absolutely positioned INSIDE
// the scaled frame (CSS px == logical px), the same plane as the marquee
// rectangle (D1c). Guide data is transient interaction state — never
// persisted, never history, never synchronized (REQ-11). Guides render only
// while a move session publishes non-empty `snapGuides`; the gesture drive
// clears them on end/cancel (REQ-4).
//
// Editor-only: mounted inside CanvasManipulationLayer, never rendered on
// preview/share/thumbnail/export surfaces (REQ-15).
// ---------------------------------------------------------------------------

import { useCanvasInteractionStore } from "../store/canvas-interaction-store";

/** Canva/Figma-style guide color (matches the selection accent). */
export const SNAP_GUIDE_COLOR = "#ff4d6d";

export function SnapGuides() {
  const guides = useCanvasInteractionStore((s) => s.snapGuides);
  if (guides.length === 0) return null;

  return (
    <div
      data-testid="canvas-snap-guides"
      className="pointer-events-none absolute inset-0 z-40"
      aria-hidden="true"
    >
      {guides.map((guide, index) => {
        const isVertical = guide.axis === "x";
        const span = guide.spanEnd - guide.spanStart;
        return (
          <div
            key={`${guide.axis}:${guide.value}:${index}`}
            data-testid="canvas-snap-guide-line"
            data-guide-axis={guide.axis}
            data-guide-value={guide.value}
            data-guide-span-start={guide.spanStart}
            data-guide-span-end={guide.spanEnd}
            data-guide-kind={guide.kind}
            className="absolute bg-[#ff4d6d]"
            style={{
              backgroundColor: SNAP_GUIDE_COLOR,
              ...(isVertical
                ? {
                    left: guide.value,
                    top: guide.spanStart,
                    width: 1,
                    height: Math.max(span, 1),
                  }
                : {
                    left: guide.spanStart,
                    top: guide.value,
                    width: Math.max(span, 1),
                    height: 1,
                  }),
            }}
          />
        );
      })}
    </div>
  );
}
