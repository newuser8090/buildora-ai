// ---------------------------------------------------------------------------
// Guided builder — persistent user UI preferences
//
// These are UI preferences ONLY. They are:
//   - never part of ProjectSchema
//   - never exported in .buildora.json
//   - never included in project history
//   - persisted locally as a user preference (localStorage)
//
// Stored as one JSON blob under a namespaced key so writes are atomic.
// ---------------------------------------------------------------------------

import type {
  EditorExperienceMode,
  OnboardingSelections,
} from "../types";
import { isExperienceMode } from "../types";

export const GUIDED_PREFS_KEY = "buildora:guided:prefs";

export interface GuidedPrefs {
  experienceMode: EditorExperienceMode;
  onboardingCompleted: boolean;
  onboardingSelections: OnboardingSelections | null;
  coachEnabled: boolean;
  dismissedTipIds: string[];
  journeyCollapsed: boolean;
  tryGuidedBannerDismissed: boolean;
}

export const DEFAULT_GUIDED_PREFS: GuidedPrefs = {
  // Safe default: existing users keep the current experience unless first-run
  // state explicitly opts into Guided mode (Phase N spec §20).
  experienceMode: "standard",
  onboardingCompleted: false,
  onboardingSelections: null,
  coachEnabled: true,
  dismissedTipIds: [],
  journeyCollapsed: false,
  tryGuidedBannerDismissed: false,
};

export interface GuidedPrefStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

/** In-memory fallback used when localStorage is unavailable (module-level
 *  singleton so writes and reads share the same backing store). */
let memoryStorageInstance: GuidedPrefStorage | null = null;

function createMemoryStorage(): GuidedPrefStorage {
  if (memoryStorageInstance) return memoryStorageInstance;
  const map = new Map<string, string>();
  memoryStorageInstance = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
  return memoryStorageInstance;
}

function defaultStorage(): GuidedPrefStorage {
  if (typeof window !== "undefined" && typeof window.localStorage !== "undefined") {
    return window.localStorage;
  }
  return createMemoryStorage();
}

// ---------------------------------------------------------------------------
// Load / save
// ---------------------------------------------------------------------------

/**
 * Load prefs. Corrupt JSON or unknown shapes fall back to defaults field by
 * field — a malformed blob can never crash the guided experience.
 */
export function loadGuidedPrefs(
  storage?: GuidedPrefStorage,
): GuidedPrefs {
  const store = storage ?? defaultStorage();
  let raw: string | null = null;
  try {
    raw = store.getItem(GUIDED_PREFS_KEY);
  } catch {
    return { ...DEFAULT_GUIDED_PREFS };
  }
  if (!raw) return { ...DEFAULT_GUIDED_PREFS };

  try {
    const parsed = JSON.parse(raw) as Partial<GuidedPrefs>;
    return {
      ...DEFAULT_GUIDED_PREFS,
      ...parsed,
      experienceMode: isExperienceMode(parsed.experienceMode)
        ? parsed.experienceMode
        : DEFAULT_GUIDED_PREFS.experienceMode,
      onboardingSelections:
        parsed.onboardingSelections &&
        typeof parsed.onboardingSelections === "object"
          ? parsed.onboardingSelections
          : null,
      dismissedTipIds: Array.isArray(parsed.dismissedTipIds)
        ? parsed.dismissedTipIds
        : [],
      coachEnabled: typeof parsed.coachEnabled === "boolean"
        ? parsed.coachEnabled
        : DEFAULT_GUIDED_PREFS.coachEnabled,
      journeyCollapsed: typeof parsed.journeyCollapsed === "boolean"
        ? parsed.journeyCollapsed
        : DEFAULT_GUIDED_PREFS.journeyCollapsed,
      tryGuidedBannerDismissed:
        typeof parsed.tryGuidedBannerDismissed === "boolean"
          ? parsed.tryGuidedBannerDismissed
          : DEFAULT_GUIDED_PREFS.tryGuidedBannerDismissed,
      onboardingCompleted:
        typeof parsed.onboardingCompleted === "boolean"
          ? parsed.onboardingCompleted
          : DEFAULT_GUIDED_PREFS.onboardingCompleted,
    };
  } catch {
    return { ...DEFAULT_GUIDED_PREFS };
  }
}

/** Persist prefs. Write failures are swallowed (UI preference only). */
export function saveGuidedPrefs(
  prefs: GuidedPrefs,
  storage?: GuidedPrefStorage,
): void {
  const store = storage ?? defaultStorage();
  try {
    store.setItem(GUIDED_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // localStorage unavailable/quota — preference is best-effort only.
  }
}

/** True when a stored preference blob exists (i.e. a returning user). */
export function hasGuidedPrefs(storage?: GuidedPrefStorage): boolean {
  const store = storage ?? defaultStorage();
  try {
    return store.getItem(GUIDED_PREFS_KEY) !== null;
  } catch {
    return false;
  }
}

/** Test helper — clear the stored preference. */
export function clearGuidedPrefs(storage?: GuidedPrefStorage): void {
  const store = storage ?? defaultStorage();
  try {
    store.removeItem?.(GUIDED_PREFS_KEY);
  } catch {
    // best-effort
  }
}
