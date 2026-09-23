"use client";

// ---------------------------------------------------------------------------
// useCanvasKeyboard (Phase P22-B) — canvas shortcut dispatch
//
// Matches keyboard events against the canvas shortcut map and delegates to
// handlers. Shortcuts are ALWAYS suppressed while the user types inside a
// text field / contenteditable (future inline text editing depends on normal
// keyboard behavior).
//
// The mount site decides which handlers are wired: the live section canvas
// wires deselect/copy/paste/nudge (Delete/Cmd+D remain the EXISTING
// section-level shortcuts to avoid double handling); the future element
// renderer wires the full set.
//
// Phase P28 Slice 1: layer ordering chords (Cmd/Ctrl+]/[ with Shift for the
// stack ends) dispatch `onLayerAction` — the same handler the overlay chrome
// uses, guarded by the same typing gate as every other shortcut.
// ---------------------------------------------------------------------------

import { useEffect } from "react";
import {
  arrowDirection,
  isMultiSelectModifier,
  matchCanvasShortcut,
  nudgeAmount,
  type CanvasShortcut,
} from "../engine/shortcuts";
import type { LayerAction } from "../engine/layering";

export interface CanvasKeyboardHandlers {
  onDeselect?: () => void;
  onCopy?: () => void;
  onPaste?: () => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
  onSelectAll?: () => void;
  /** Nudge callback receiving the logical delta and whether it was Shift+Arrow. */
  onNudge?: (dx: number, dy: number, large: boolean) => void;
  /** P28 Slice 1 (D7): layer ordering — front / back / forward / backward. */
  onLayerAction?: (action: LayerAction) => void;
  /** True when the canvas layer owns the keyboard (e.g. element selection active). */
  enabled?: () => boolean;
}

export function useCanvasKeyboard(handlers: CanvasKeyboardHandlers): void {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (handlers.enabled && !handlers.enabled()) return;
      const shortcut = matchCanvasShortcut(event);
      if (!shortcut) return;

      switch (shortcut) {
        case "deselect":
          event.preventDefault();
          handlers.onDeselect?.();
          return;
        case "copy":
          handlers.onCopy?.();
          return;
        case "paste":
          handlers.onPaste?.();
          return;
        case "delete":
          event.preventDefault();
          handlers.onDelete?.();
          return;
        case "duplicate":
          handlers.onDuplicate?.();
          return;
        case "select-all":
          handlers.onSelectAll?.();
          return;
        // P28 Slice 1 (D7): layer ordering chords. The matcher already
        // called preventDefault (like duplicate/copy/paste); a chord without
        // a wired handler is a no-op so plain Cmd+[ / Cmd+] stay inert.
        case "layer-front":
          handlers.onLayerAction?.("front");
          return;
        case "layer-back":
          handlers.onLayerAction?.("back");
          return;
        case "layer-forward":
          handlers.onLayerAction?.("forward");
          return;
        case "layer-backward":
          handlers.onLayerAction?.("backward");
          return;
        case "nudge":
        case "nudge-large": {
          if (!handlers.onNudge) return;
          const dir = arrowDirection(event);
          const amount = nudgeAmount(event.shiftKey);
          event.preventDefault();
          handlers.onNudge(dir.x * amount, dir.y * amount, event.shiftKey);
          return;
        }
        default:
          return;
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handlers]);
}

export { isMultiSelectModifier };

export type { CanvasShortcut };
