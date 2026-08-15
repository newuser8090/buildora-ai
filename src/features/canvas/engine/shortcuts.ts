// ---------------------------------------------------------------------------
// Canvas shortcuts (Phase P22-B) — deterministic key handling
//
// Shortcuts are matched from a KeyboardEvent and map to canvas actions. The
// typing guard MUST be respected: while the user is inside a text field,
// contenteditable, or select, canvas shortcuts never fire (future inline
// text editing depends on normal keyboard behavior).
//
// Pure, deterministic, framework-independent.
// ---------------------------------------------------------------------------

export type CanvasShortcut =
  | "delete"
  | "duplicate"
  | "copy"
  | "paste"
  | "deselect"
  | "nudge"
  | "nudge-large"
  | "select-all";

export const TYPING_SELECTORS =
  "input, textarea, select, [contenteditable], [role=textbox]";

/**
 * True when the event target is a text-editing surface (shortcuts suppressed).
 *
 * Duck-typed on `matches`/`closest` instead of `instanceof HTMLElement` so the
 * guard is environment-safe (no DOM globals in unit tests) and works with any
 * element-like object.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  const el = target as {
    matches?: (selector: string) => boolean;
    closest?: (selector: string) => Element | null;
  };
  if (typeof el.matches !== "function") return false;
  if (el.matches(TYPING_SELECTORS)) return true;
  return typeof el.closest === "function" && el.closest(TYPING_SELECTORS) !== null;
}

/**
 * Match a keyboard event to a canvas shortcut.
 *
 *   Delete/Backspace        → delete
 *   Cmd/Ctrl + D            → duplicate
 *   Cmd/Ctrl + C            → copy
 *   Cmd/Ctrl + V            → paste
 *   Escape                  → deselect
 *   Arrow keys              → nudge (Shift + Arrow → nudge-large)
 *   Cmd/Ctrl + A            → select-all
 *
 * Returns null when the key does not map, when the modifier combination is
 * not handled, or when the target is a typing surface.
 */
export function matchCanvasShortcut(event: KeyboardEvent): CanvasShortcut | null {
  if (isTypingTarget(event.target)) return null;

  const mod = event.metaKey || event.ctrlKey;
  const key = event.key;

  if (key === "Delete" || key === "Backspace") {
    if (mod) return null; // Cmd+Backspace is OS-level; never hijack it
    return "delete";
  }
  if (mod) {
    switch (key.toLowerCase()) {
      case "d":
        event.preventDefault();
        return "duplicate";
      case "c":
        event.preventDefault();
        return "copy";
      case "v":
        event.preventDefault();
        return "paste";
      case "a":
        // Select-all is only meaningful for the canvas layer when explicitly
        // enabled; the editor uses Cmd+A for the layers panel. Callers decide.
        return "select-all";
      default:
        return null;
    }
  }
  if (key === "Escape") {
    return "deselect";
  }
  if (key.startsWith("Arrow")) {
    if (event.shiftKey) return "nudge-large";
    if (event.altKey) return null;
    return "nudge";
  }
  return null;
}

/** Arrow key direction from an event (used by nudge actions). */
export function arrowDirection(event: KeyboardEvent): { x: number; y: number } {
  switch (event.key) {
    case "ArrowLeft":
      return { x: -1, y: 0 };
    case "ArrowRight":
      return { x: 1, y: 0 };
    case "ArrowUp":
      return { x: 0, y: -1 };
    case "ArrowDown":
      return { x: 0, y: 1 };
    default:
      return { x: 0, y: 0 };
  }
}

/** Nudge distance in logical px (1 normal, 10 with Shift). */
export function nudgeAmount(shift: boolean): number {
  return shift ? 10 : 1;
}

/** Small helper: does the event carry a plain click modifier (Cmd/Ctrl)? */
export function isMultiSelectModifier(event: {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
}): boolean {
  return event.metaKey || event.ctrlKey || event.shiftKey;
}
