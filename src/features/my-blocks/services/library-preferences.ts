// ---------------------------------------------------------------------------
// My Blocks Library (Phase P5) — local UI preferences
//
// Harmless UI preferences persisted to localStorage only: view, sort,
// active section, last collection, density. NEVER stored in ProjectSchema,
// never in history, never in IndexedDB. Corrupt/unknown values fall back to
// defaults deterministically.
// ---------------------------------------------------------------------------

import type { MyBlockSortOption } from "../types";

export type MyBlockLibrarySection = "all" | "favorites" | "recent" | "collections";
export type MyBlockView = "grid" | "list";

export interface LibraryPreferences {
  view: MyBlockView;
  sort: MyBlockSortOption;
  section: MyBlockLibrarySection;
  /** Last viewed collection (only meaningful when section === "collections"). */
  collectionId: string | null;
}

export const LIBRARY_PREFERENCES_KEY = "buildora:my-blocks-preferences";

export const DEFAULT_LIBRARY_PREFERENCES: LibraryPreferences = {
  view: "grid",
  sort: "recent",
  section: "all",
  collectionId: null,
};

const VIEWS: MyBlockView[] = ["grid", "list"];
const SORTS: MyBlockSortOption[] = [
  "recent",
  "recently-used",
  "oldest",
  "name-asc",
  "name-desc",
  "most-used",
];
const SECTIONS: MyBlockLibrarySection[] = ["all", "favorites", "recent", "collections"];

/** Read preferences from localStorage with full validation. Never throws. */
export function loadLibraryPreferences(): LibraryPreferences {
  if (typeof window === "undefined") return { ...DEFAULT_LIBRARY_PREFERENCES };
  try {
    const raw = window.localStorage.getItem(LIBRARY_PREFERENCES_KEY);
    if (!raw) return { ...DEFAULT_LIBRARY_PREFERENCES };
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      view: VIEWS.includes(parsed.view as MyBlockView)
        ? (parsed.view as MyBlockView)
        : DEFAULT_LIBRARY_PREFERENCES.view,
      sort: SORTS.includes(parsed.sort as MyBlockSortOption)
        ? (parsed.sort as MyBlockSortOption)
        : DEFAULT_LIBRARY_PREFERENCES.sort,
      section: SECTIONS.includes(parsed.section as MyBlockLibrarySection)
        ? (parsed.section as MyBlockLibrarySection)
        : DEFAULT_LIBRARY_PREFERENCES.section,
      collectionId:
        typeof parsed.collectionId === "string" && parsed.collectionId.length > 0
          ? parsed.collectionId
          : null,
    };
  } catch {
    return { ...DEFAULT_LIBRARY_PREFERENCES };
  }
}

/** Persist preferences. Never throws (storage may be full/unavailable). */
export function saveLibraryPreferences(prefs: LibraryPreferences): void {
  try {
    window.localStorage.setItem(LIBRARY_PREFERENCES_KEY, JSON.stringify(prefs));
  } catch {
    // Preferences are harmless — failure to persist is not an error.
  }
}

/**
 * Safe accessor used by the command palette: read a single preference key
 * with unknown-key rejection (only known keys are ever returned).
 */
export function getLibraryPreferenceKey(key: string): unknown {
  const prefs = loadLibraryPreferences();
  switch (key) {
    case "view":
      return prefs.view;
    case "sort":
      return prefs.sort;
    case "section":
      return prefs.section;
    case "collectionId":
      return prefs.collectionId;
    default:
      return null;
  }
}
