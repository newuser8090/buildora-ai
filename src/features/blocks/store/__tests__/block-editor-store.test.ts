// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// Block editor store tests (Phase O spec: TESTS → store)
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { useBlockEditorStore } from "../block-editor-store";
import { clearBlockPrefs, loadBlockPrefs } from "../../prefs/block-builder-prefs";

beforeEach(() => {
  clearBlockPrefs();
  useBlockEditorStore.getState().reset();
});

describe("selection & expansion", () => {
  it("selects and clears a block", () => {
    useBlockEditorStore.getState().selectBlock("b-1");
    expect(useBlockEditorStore.getState().selectedBlockId).toBe("b-1");
    useBlockEditorStore.getState().selectBlock(null);
    expect(useBlockEditorStore.getState().selectedBlockId).toBeNull();
  });

  it("selection clears feedback", () => {
    useBlockEditorStore.getState().setFeedback({ code: "LOCKED_BLOCK", message: "x" });
    useBlockEditorStore.getState().selectBlock("b-1");
    expect(useBlockEditorStore.getState().lastError).toBeNull();
  });

  it("toggles expansion", () => {
    useBlockEditorStore.getState().toggleExpand("b-1");
    expect(useBlockEditorStore.getState().expandedIds).toEqual(["b-1"]);
    useBlockEditorStore.getState().toggleExpand("b-1");
    expect(useBlockEditorStore.getState().expandedIds).toEqual([]);
  });
});

describe("browser", () => {
  it("opens and closes with the target", () => {
    useBlockEditorStore.getState().openBrowser({ pageId: "p", sectionId: "s" });
    expect(useBlockEditorStore.getState().browserOpen).toBe(true);
    expect(useBlockEditorStore.getState().browserTarget).toEqual({ pageId: "p", sectionId: "s" });
    useBlockEditorStore.getState().closeBrowser();
    expect(useBlockEditorStore.getState().browserOpen).toBe(false);
    expect(useBlockEditorStore.getState().browserTarget).toBeNull();
  });
});

describe("recents", () => {
  it("adds recent types most-recent-first, capped", () => {
    const store = useBlockEditorStore.getState();
    for (let i = 0; i < 12; i += 1) {
      store.addRecent("heading");
    }
    store.addRecent("button");
    store.addRecent("image");
    const recents = useBlockEditorStore.getState().recentBlockTypes;
    expect(recents[0]).toBe("image");
    expect(recents.length).toBeLessThanOrEqual(8);
  });

  it("deduplicates recents", () => {
    useBlockEditorStore.getState().addRecent("heading");
    useBlockEditorStore.getState().addRecent("heading");
    expect(useBlockEditorStore.getState().recentBlockTypes).toEqual(["heading"]);
  });
});

describe("favorites", () => {
  it("toggles favorites and persists them", () => {
    const store = useBlockEditorStore.getState();
    store.toggleFavorite("heading");
    expect(useBlockEditorStore.getState().favoriteBlockTypes).toContain("heading");
    expect(loadBlockPrefs().favoriteBlockTypes).toContain("heading");
    store.toggleFavorite("heading");
    expect(useBlockEditorStore.getState().favoriteBlockTypes).not.toContain("heading");
  });
});

describe("session trees", () => {
  it("sets and clears a session tree for a section", () => {
    const tree = { rootIds: ["s"], nodes: {} };
    useBlockEditorStore.getState().setSessionTree("s", { fingerprint: "fp", tree });
    expect(useBlockEditorStore.getState().sessionTrees["s"]).toEqual({ fingerprint: "fp", tree });
    useBlockEditorStore.getState().setSessionTree("s", null);
    expect(useBlockEditorStore.getState().sessionTrees["s"]).toBeUndefined();
  });

  it("clearSessionTrees resets all session state", () => {
    useBlockEditorStore.getState().setSessionTree("s", {
      fingerprint: "fp",
      tree: { rootIds: ["s"], nodes: {} },
    });
    useBlockEditorStore.getState().clearSessionTrees();
    expect(useBlockEditorStore.getState().sessionTrees).toEqual({});
  });
});

describe("feedback", () => {
  it("stores a structured error and warnings", () => {
    useBlockEditorStore
      .getState()
      .setFeedback({ code: "NESTING_RULE_VIOLATION", message: "nope" }, ["warn"]);
    const state = useBlockEditorStore.getState();
    expect(state.lastError?.code).toBe("NESTING_RULE_VIOLATION");
    expect(state.lastWarnings).toEqual(["warn"]);
  });
});
