// ---------------------------------------------------------------------------
// Help (Phase P9) — keyboard shortcut registry tests
//
// The registry documents ONLY real shortcuts. This test pins the structure so
// a future edit cannot silently drop or duplicate entries.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { SHORTCUT_GROUPS, SHORTCUT_COUNT } from "../keyboard-shortcuts";

describe("keyboard-shortcuts registry", () => {
  it("is deterministic and grouped", () => {
    const groupIds = SHORTCUT_GROUPS.map((g) => g.id);
    expect(groupIds).toEqual(["editing", "navigation", "ai", "preview", "publishing"]);
  });

  it("has unique entry ids across all groups", () => {
    const ids = SHORTCUT_GROUPS.flatMap((g) => g.entries.map((e) => e.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("includes the real editing shortcuts", () => {
    const editing = SHORTCUT_GROUPS.find((g) => g.id === "editing")!;
    const labels = editing.entries.map((e) => e.label);
    expect(labels).toContain("Save your project");
    expect(labels).toContain("Undo your last change");
    expect(labels).toContain("Redo the change you undid");
  });

  it("count matches the actual entries", () => {
    const real = SHORTCUT_GROUPS.reduce((n, g) => n + g.entries.length, 0);
    expect(SHORTCUT_COUNT).toBe(real);
  });

  it("palette-only entries never invent a key chord", () => {
    const editing = SHORTCUT_GROUPS.find((g) => g.id === "editing")!;
    const realChordCount = editing.entries.filter((e) => e.keys !== "").length;
    // Save, undo, redo, redo-win, duplicate, delete — all real chords.
    expect(realChordCount).toBe(6);
  });
});
