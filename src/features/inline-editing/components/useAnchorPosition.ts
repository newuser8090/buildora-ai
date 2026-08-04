"use client";

import { useEffect, useState, useCallback } from "react";

// ---------------------------------------------------------------------------
// useAnchorPosition — positions floating inline-editing UI near the selected
// field element. Uses viewport coordinates from getBoundingClientRect, so it
// stays correct even inside the scaled preview frame.
// ---------------------------------------------------------------------------

export interface AnchorPosition {
  top: number;
  left: number;
}

export interface AnchorState {
  position: AnchorPosition | null;
  /** The anchor element itself, so callers can focus-related logic on it. */
  anchor: HTMLElement | null;
  update: (el: HTMLElement) => void;
  clear: () => void;
}

export function useAnchorPosition(): AnchorState {
  const [position, setPosition] = useState<AnchorPosition | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  const update = useCallback((el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    setPosition({ top: rect.top, left: rect.left });
    setAnchor(el);
  }, []);

  const clear = useCallback(() => {
    setPosition(null);
    setAnchor(null);
  }, []);

  // Re-measure on scroll/resize so the floating UI follows the field.
  useEffect(() => {
    if (!anchor) return;
    const remeasure = () => {
      const rect = anchor.getBoundingClientRect();
      setPosition({ top: rect.top, left: rect.left });
    };
    window.addEventListener("scroll", remeasure, true);
    window.addEventListener("resize", remeasure);
    return () => {
      window.removeEventListener("scroll", remeasure, true);
      window.removeEventListener("resize", remeasure);
    };
  }, [anchor]);

  return { position, anchor, update, clear };
}
