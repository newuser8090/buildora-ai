// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// My Blocks Library (Phase P5) — library preferences tests
//
//   - defaults when nothing is stored / storage unavailable
//   - roundtrip save/load
//   - corrupt JSON falls back to defaults
//   - unknown view/sort/section values fall back to defaults
//   - unknown preference keys are rejected (null)
//   - never throws (storage full / blocked)
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  DEFAULT_LIBRARY_PREFERENCES,
  LIBRARY_PREFERENCES_KEY,
  loadLibraryPreferences,
  saveLibraryPreferences,
  getLibraryPreferenceKey,
  type LibraryPreferences,
} from "../services/library-preferences";

const KEY = LIBRARY_PREFERENCES_KEY;

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe("loadLibraryPreferences", () => {
  it("returns defaults when nothing is stored", () => {
    expect(loadLibraryPreferences()).toEqual(DEFAULT_LIBRARY_PREFERENCES);
  });

  it("returns a fresh copy (mutating the result never corrupts the default)", () => {
    const first = loadLibraryPreferences();
    first.view = "list";
    expect(DEFAULT_LIBRARY_PREFERENCES.view).toBe("grid");
  });

  it("roundtrips saved preferences", () => {
    const prefs: LibraryPreferences = {
      view: "list",
      sort: "most-used",
      section: "favorites",
      collectionId: "col-1",
    };
    saveLibraryPreferences(prefs);
    expect(loadLibraryPreferences()).toEqual(prefs);
  });

  it("falls back to defaults for corrupt JSON", () => {
    window.localStorage.setItem(KEY, "{ not json !!");
    expect(loadLibraryPreferences()).toEqual(DEFAULT_LIBRARY_PREFERENCES);
  });

  it("falls back per-key for unknown values", () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ view: "carousel", sort: "magic", section: "archive", collectionId: "c" }),
    );
    const prefs = loadLibraryPreferences();
    expect(prefs.view).toBe("grid");
    expect(prefs.sort).toBe("recent");
    expect(prefs.section).toBe("all");
    // A valid collection id survives (harmless UI state).
    expect(prefs.collectionId).toBe("c");
  });

  it("normalizes an empty collectionId to null", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ collectionId: "" }));
    expect(loadLibraryPreferences().collectionId).toBeNull();
  });

  it("never throws on non-object stored values", () => {
    window.localStorage.setItem(KEY, JSON.stringify("grid"));
    expect(loadLibraryPreferences()).toEqual(DEFAULT_LIBRARY_PREFERENCES);
  });
});

describe("saveLibraryPreferences", () => {
  it("persists only known shapes", () => {
    saveLibraryPreferences({ view: "list", sort: "oldest", section: "recent", collectionId: null });
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? "{}");
    expect(raw.view).toBe("list");
    expect(raw.sort).toBe("oldest");
    expect(raw.section).toBe("recent");
    expect(raw.collectionId).toBeNull();
  });
});

describe("getLibraryPreferenceKey", () => {
  it("returns the stored value for known keys", () => {
    saveLibraryPreferences({
      view: "list",
      sort: "name-asc",
      section: "collections",
      collectionId: null,
    });
    expect(getLibraryPreferenceKey("view")).toBe("list");
    expect(getLibraryPreferenceKey("sort")).toBe("name-asc");
    expect(getLibraryPreferenceKey("section")).toBe("collections");
  });

  it("rejects unknown keys with null", () => {
    expect(getLibraryPreferenceKey("theme")).toBeNull();
    expect(getLibraryPreferenceKey("__proto__")).toBeNull();
  });
});
