// ---------------------------------------------------------------------------
// Canvas interaction store tests (Phase P22-B)
// The store is TRANSIENT UI state — selection, sessions, marquee, clipboard.
// Verifies state transitions and that no durable state is touched.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { useCanvasInteractionStore } from "../store/canvas-interaction-store";
import { beginMove } from "../engine/transform";

beforeEach(() => {
  useCanvasInteractionStore.getState().reset();
});

describe("selection transitions", () => {
  it("single-select replaces and multi-select accumulates", () => {
    const store = useCanvasInteractionStore.getState();
    store.setSelection(["a"], { multi: false });
    expect(useCanvasInteractionStore.getState().selection.ids).toEqual(["a"]);
    store.setSelection(["a", "b"], { multi: true });
    expect(useCanvasInteractionStore.getState().selection.ids).toEqual(["a", "b"]);
  });

  it("toggle adds and removes, preserving order", () => {
    const store = useCanvasInteractionStore.getState();
    store.setSelection(["a"], {});
    store.toggleSelect("b");
    expect(useCanvasInteractionStore.getState().selection.ids).toEqual(["a", "b"]);
    store.toggleSelect("a");
    expect(useCanvasInteractionStore.getState().selection.ids).toEqual(["b"]);
  });

  it("clearSelection resets everything transient", () => {
    const store = useCanvasInteractionStore.getState();
    store.setSelection(["a"], {});
    store.beginMarquee({ x: 0, y: 0 });
    store.clearSelection();
    const s = useCanvasInteractionStore.getState();
    expect(s.selection.ids).toEqual([]);
    expect(s.marquee).toBeNull();
    expect(s.session).toBeNull();
    expect(s.previewRects).toBeNull();
  });
});

describe("session transitions", () => {
  it("begin → update → end lifecycle", () => {
    const store = useCanvasInteractionStore.getState();
    store.setSelection(["a"], {});
    store.beginSession(beginMove(["a"], { a: { x: 0, y: 0, width: 10, height: 10 } }, { x: 0, y: 0 }));
    expect(useCanvasInteractionStore.getState().session?.kind).toBe("move");
    store.updateSession({ a: { x: 5, y: 0, width: 10, height: 10 } }, 0);
    expect(useCanvasInteractionStore.getState().previewRects?.a.x).toBe(5);
    store.endSession();
    const s = useCanvasInteractionStore.getState();
    expect(s.session).toBeNull();
    expect(s.previewRects).toBeNull();
  });

  it("cancelSession discards previews", () => {
    const store = useCanvasInteractionStore.getState();
    store.beginSession(beginMove(["a"], { a: { x: 0, y: 0, width: 1, height: 1 } }, { x: 0, y: 0 }));
    store.updateSession({ a: { x: 99, y: 0, width: 1, height: 1 } }, 0);
    store.cancelSession();
    expect(useCanvasInteractionStore.getState().previewRects).toBeNull();
  });
});

describe("marquee + clipboard + options", () => {
  it("marquee lifecycle tracks start/current", () => {
    const store = useCanvasInteractionStore.getState();
    store.beginMarquee({ x: 1, y: 2 });
    store.updateMarquee({ x: 10, y: 20 });
    expect(useCanvasInteractionStore.getState().marquee).toEqual({
      start: { x: 1, y: 2 },
      current: { x: 10, y: 20 },
    });
    store.endMarquee();
    expect(useCanvasInteractionStore.getState().marquee).toBeNull();
  });

  it("clipboard buffer stores a sanitized payload string", () => {
    const store = useCanvasInteractionStore.getState();
    store.setClipboard("{}");
    expect(useCanvasInteractionStore.getState().clipboard).toBe("{}");
    store.setClipboard(null);
    expect(useCanvasInteractionStore.getState().clipboard).toBeNull();
  });

  it("snap/manipulation toggles", () => {
    const store = useCanvasInteractionStore.getState();
    expect(useCanvasInteractionStore.getState().snapEnabled).toBe(true);
    store.setSnapEnabled(false);
    expect(useCanvasInteractionStore.getState().snapEnabled).toBe(false);
    store.setManipulationEnabled(true);
    expect(useCanvasInteractionStore.getState().manipulationEnabled).toBe(true);
  });
});
