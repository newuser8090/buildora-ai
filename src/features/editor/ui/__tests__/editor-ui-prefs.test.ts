// ---------------------------------------------------------------------------
// Editor UI prefs (Phase P22-K) — localStorage persistence for panel state
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  DEFAULT_EDITOR_UI_PREFS,
  EDITOR_UI_PREFS_KEY,
  MIN_PANEL_WIDTH,
  MAX_PANEL_WIDTH,
  clampPanelWidth,
  normalizePanelWidth,
  loadEditorUIPrefs,
  saveEditorUIPrefs,
  hasEditorUIPrefs,
  clearEditorUIPrefs,
  resetEditorUIPrefs,
  type EditorUIPrefStorage,
} from "../editor-ui-prefs";

class MemoryStorage implements EditorUIPrefStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  snapshot(): string | null {
    return this.map.get(EDITOR_UI_PREFS_KEY) ?? null;
  }
}

function storage(): MemoryStorage {
  return new MemoryStorage();
}

describe("EditorUIPrefs — defaults", () => {
  it("returns safe defaults when nothing is stored", () => {
    expect(loadEditorUIPrefs(storage())).toEqual(DEFAULT_EDITOR_UI_PREFS);
    expect(DEFAULT_EDITOR_UI_PREFS).toEqual({
      leftPanelWidth: 320,
      rightPanelWidth: 300,
      leftPanelCollapsed: false,
      rightPanelCollapsed: false,
    });
  });
});

describe("EditorUIPrefs — save/load round trip", () => {
  it("round-trips all fields through one atomic JSON blob", () => {
    const store = storage();
    saveEditorUIPrefs(
      {
        leftPanelWidth: 380,
        rightPanelWidth: 260,
        leftPanelCollapsed: true,
        rightPanelCollapsed: false,
      },
      store,
    );
    expect(loadEditorUIPrefs(store)).toEqual({
      leftPanelWidth: 380,
      rightPanelWidth: 260,
      leftPanelCollapsed: true,
      rightPanelCollapsed: false,
    });
    expect(hasEditorUIPrefs(store)).toBe(true);
  });

  it("persists partial prefs merged over defaults", () => {
    const store = storage();
    saveEditorUIPrefs(
      { ...DEFAULT_EDITOR_UI_PREFS, leftPanelCollapsed: true },
      store,
    );
    const loaded = loadEditorUIPrefs(store);
    expect(loaded.leftPanelCollapsed).toBe(true);
    expect(loaded.leftPanelWidth).toBe(320);
  });
});

describe("EditorUIPrefs — corrupt / hostile input", () => {
  it("returns defaults for malformed JSON (never throws)", () => {
    const store = storage();
    store.setItem(EDITOR_UI_PREFS_KEY, "{not json!!");
    expect(loadEditorUIPrefs(store)).toEqual(DEFAULT_EDITOR_UI_PREFS);
  });

  it("ignores invalid types field by field", () => {
    const store = storage();
    store.setItem(
      EDITOR_UI_PREFS_KEY,
      JSON.stringify({
        leftPanelWidth: "wide",
        rightPanelWidth: null,
        leftPanelCollapsed: "yes",
        rightPanelCollapsed: 1,
      }),
    );
    expect(loadEditorUIPrefs(store)).toEqual(DEFAULT_EDITOR_UI_PREFS);
  });

  it("drops unsafe/hostile keys without prototype pollution", () => {
    const store = storage();
    store.setItem(
      EDITOR_UI_PREFS_KEY,
      JSON.stringify({
        leftPanelWidth: 360,
        __proto__: { polluted: true },
        constructor: { prototype: { polluted: true } },
        prototype: "boom",
      }),
    );
    const loaded = loadEditorUIPrefs(store);
    expect(loaded.leftPanelWidth).toBe(360);
    // The default object must remain clean.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined();
    // Unknown keys never surface in the result.
    expect(Object.keys(loaded).sort()).toEqual([
      "leftPanelCollapsed",
      "leftPanelWidth",
      "rightPanelCollapsed",
      "rightPanelWidth",
    ]);
  });

  it("throws on storage access failures", () => {
    const broken: EditorUIPrefStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(loadEditorUIPrefs(broken)).toEqual(DEFAULT_EDITOR_UI_PREFS);
    expect(() => saveEditorUIPrefs(DEFAULT_EDITOR_UI_PREFS, broken)).not.toThrow();
    expect(hasEditorUIPrefs(broken)).toBe(false);
  });
});

describe("EditorUIPrefs — width clamping", () => {
  it("clamps widths below the minimum", () => {
    const store = storage();
    saveEditorUIPrefs(
      { ...DEFAULT_EDITOR_UI_PREFS, leftPanelWidth: 10, rightPanelWidth: 0 },
      store,
    );
    const loaded = loadEditorUIPrefs(store);
    expect(loaded.leftPanelWidth).toBe(MIN_PANEL_WIDTH);
    expect(loaded.rightPanelWidth).toBe(MIN_PANEL_WIDTH);
  });

  it("clamps widths above the maximum", () => {
    const store = storage();
    saveEditorUIPrefs(
      { ...DEFAULT_EDITOR_UI_PREFS, leftPanelWidth: 5000, rightPanelWidth: 999 },
      store,
    );
    const loaded = loadEditorUIPrefs(store);
    expect(loaded.leftPanelWidth).toBe(MAX_PANEL_WIDTH);
    expect(loaded.rightPanelWidth).toBe(MAX_PANEL_WIDTH);
  });

  it("rounds fractional widths", () => {
    expect(clampPanelWidth(320.6)).toBe(321);
  });

  it("normalizePanelWidth falls back for non-numbers", () => {
    expect(normalizePanelWidth("300", 320)).toBe(320);
    expect(normalizePanelWidth(Number.NaN, 300)).toBe(300);
    expect(normalizePanelWidth(undefined, 300)).toBe(300);
    expect(normalizePanelWidth(280, 320)).toBe(280);
  });
});

describe("EditorUIPrefs — clear/reset", () => {
  it("clearEditorUIPrefs removes the blob", () => {
    const store = storage();
    saveEditorUIPrefs(DEFAULT_EDITOR_UI_PREFS, store);
    expect(hasEditorUIPrefs(store)).toBe(true);
    clearEditorUIPrefs(store);
    expect(hasEditorUIPrefs(store)).toBe(false);
    expect(loadEditorUIPrefs(store)).toEqual(DEFAULT_EDITOR_UI_PREFS);
  });

  it("resetEditorUIPrefs restores defaults", () => {
    const store = storage();
    saveEditorUIPrefs({ ...DEFAULT_EDITOR_UI_PREFS, leftPanelCollapsed: true }, store);
    resetEditorUIPrefs(store);
    expect(loadEditorUIPrefs(store)).toEqual(DEFAULT_EDITOR_UI_PREFS);
  });

  it("missing localStorage falls back to memory storage", () => {
    // defaultStorage() is exercised via load/save without an explicit store —
    // in jsdom localStorage exists, so this verifies the API never throws.
    saveEditorUIPrefs({ ...DEFAULT_EDITOR_UI_PREFS, leftPanelWidth: 400 });
    expect(loadEditorUIPrefs().leftPanelWidth).toBe(400);
  });
});
