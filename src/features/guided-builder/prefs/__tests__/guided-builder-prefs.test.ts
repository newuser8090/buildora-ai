// ---------------------------------------------------------------------------
// Guided builder prefs — storage tests (Phase N, spec §19/§20)
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import {
  DEFAULT_GUIDED_PREFS,
  GUIDED_PREFS_KEY,
  loadGuidedPrefs,
  saveGuidedPrefs,
  hasGuidedPrefs,
  clearGuidedPrefs,
  type GuidedPrefStorage,
} from "../guided-builder-prefs";

class MemoryStorage implements GuidedPrefStorage {
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
}

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
});

describe("guided builder prefs", () => {
  it("defaults to standard mode for existing users", () => {
    expect(loadGuidedPrefs(storage)).toEqual(DEFAULT_GUIDED_PREFS);
    expect(loadGuidedPrefs(storage).experienceMode).toBe("standard");
  });

  it("round-trips a saved preference", () => {
    saveGuidedPrefs(
      { ...DEFAULT_GUIDED_PREFS, experienceMode: "guided", onboardingCompleted: true },
      storage,
    );
    const loaded = loadGuidedPrefs(storage);
    expect(loaded.experienceMode).toBe("guided");
    expect(loaded.onboardingCompleted).toBe(true);
  });

  it("detects returning users via the storage key", () => {
    expect(hasGuidedPrefs(storage)).toBe(false);
    saveGuidedPrefs({ ...DEFAULT_GUIDED_PREFS }, storage);
    expect(hasGuidedPrefs(storage)).toBe(true);
  });

  it("clears stored prefs", () => {
    saveGuidedPrefs({ ...DEFAULT_GUIDED_PREFS, experienceMode: "guided" }, storage);
    clearGuidedPrefs(storage);
    expect(hasGuidedPrefs(storage)).toBe(false);
  });

  it("survives corrupt JSON with safe defaults", () => {
    storage.setItem(GUIDED_PREFS_KEY, "{ not json !!");
    expect(loadGuidedPrefs(storage)).toEqual(DEFAULT_GUIDED_PREFS);
  });

  it("falls back per-field for invalid values", () => {
    storage.setItem(
      GUIDED_PREFS_KEY,
      JSON.stringify({ experienceMode: "banana", dismissedTipIds: "nope" }),
    );
    const loaded = loadGuidedPrefs(storage);
    expect(loaded.experienceMode).toBe("standard");
    expect(loaded.dismissedTipIds).toEqual([]);
  });

  it("is safe when storage throws", () => {
    const broken: GuidedPrefStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    };
    expect(loadGuidedPrefs(broken)).toEqual(DEFAULT_GUIDED_PREFS);
    expect(() => saveGuidedPrefs({ ...DEFAULT_GUIDED_PREFS }, broken)).not.toThrow();
  });

  it("preserves onboarding selections", () => {
    saveGuidedPrefs(
      {
        ...DEFAULT_GUIDED_PREFS,
        onboardingSelections: { category: "business", begin: "guided", comfort: "new" },
      },
      storage,
    );
    expect(loadGuidedPrefs(storage).onboardingSelections?.category).toBe("business");
  });
});
