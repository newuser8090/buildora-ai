// ---------------------------------------------------------------------------
// Editor UI — persistent user interface preferences (Phase P22-K)
//
// These are UI preferences ONLY. They are:
//   - never part of Project / ProjectSchema
//   - never serialized into .buildora.json
//   - never stored in IndexedDB project data
//   - never sent through collaboration/CRDT
//   - never included in undo/redo history
//   - persisted locally as a user preference (localStorage)
//
// Stored as one JSON blob under a namespaced key so writes are atomic.
// Mirrors the guided-builder preference architecture exactly.
// ---------------------------------------------------------------------------

export const EDITOR_UI_PREFS_KEY = "buildora:ui:prefs";

export const DEFAULT_LEFT_PANEL_WIDTH = 320;
export const DEFAULT_RIGHT_PANEL_WIDTH = 300;
export const MIN_PANEL_WIDTH = 240;
export const MAX_PANEL_WIDTH = 480;
/** Fixed rail width when a sidebar is collapsed (P22-K minimal shell). */
export const COLLAPSED_PANEL_WIDTH = 48;

export interface EditorUIPrefs {
  leftPanelWidth: number;
  rightPanelWidth: number;
  leftPanelCollapsed: boolean;
  rightPanelCollapsed: boolean;
}

export const DEFAULT_EDITOR_UI_PREFS: EditorUIPrefs = {
  leftPanelWidth: DEFAULT_LEFT_PANEL_WIDTH,
  rightPanelWidth: DEFAULT_RIGHT_PANEL_WIDTH,
  leftPanelCollapsed: false,
  rightPanelCollapsed: false,
};

/** Clamp a numeric width into the panel bounds (240–480px). */
export function clampPanelWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_LEFT_PANEL_WIDTH;
  return Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, Math.round(width)));
}

/**
 * Normalize an untrusted width value: non-finite/absent values fall back to
 * `fallback`; finite values are clamped into the panel bounds.
 */
export function normalizePanelWidth(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return clampPanelWidth(value);
}

// ---------------------------------------------------------------------------
// Storage (mirrors guided-builder-prefs)
// ---------------------------------------------------------------------------

export interface EditorUIPrefStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

/** In-memory fallback used when localStorage is unavailable (module-level
 *  singleton so writes and reads share the same backing store). */
let memoryStorageInstance: EditorUIPrefStorage | null = null;

function createMemoryStorage(): EditorUIPrefStorage {
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

function defaultStorage(): EditorUIPrefStorage {
  if (typeof window !== "undefined" && typeof window.localStorage !== "undefined") {
    return window.localStorage;
  }
  return createMemoryStorage();
}

// ---------------------------------------------------------------------------
// Load / save
// ---------------------------------------------------------------------------

/**
 * Load panel prefs. Corrupt JSON, unknown shapes, and hostile keys fall back
 * to safe defaults field by field — a malformed blob can never crash the
 * editor and can never pollute prototypes (the result object is built with
 * explicit property writes only, never a raw spread of the parsed blob).
 */
export function loadEditorUIPrefs(
  storage?: EditorUIPrefStorage,
): EditorUIPrefs {
  const store = storage ?? defaultStorage();
  let raw: string | null = null;
  try {
    raw = store.getItem(EDITOR_UI_PREFS_KEY);
  } catch {
    return { ...DEFAULT_EDITOR_UI_PREFS };
  }
  if (!raw) return { ...DEFAULT_EDITOR_UI_PREFS };

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: EditorUIPrefs = { ...DEFAULT_EDITOR_UI_PREFS };
    if (typeof parsed.leftPanelWidth === "number") {
      out.leftPanelWidth = clampPanelWidth(parsed.leftPanelWidth);
    }
    if (typeof parsed.rightPanelWidth === "number") {
      out.rightPanelWidth = clampPanelWidth(parsed.rightPanelWidth);
    }
    if (typeof parsed.leftPanelCollapsed === "boolean") {
      out.leftPanelCollapsed = parsed.leftPanelCollapsed;
    }
    if (typeof parsed.rightPanelCollapsed === "boolean") {
      out.rightPanelCollapsed = parsed.rightPanelCollapsed;
    }
    return out;
  } catch {
    return { ...DEFAULT_EDITOR_UI_PREFS };
  }
}

/** Persist prefs. Write failures are swallowed (UI preference only). */
export function saveEditorUIPrefs(
  prefs: EditorUIPrefs,
  storage?: EditorUIPrefStorage,
): void {
  const store = storage ?? defaultStorage();
  try {
    store.setItem(EDITOR_UI_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // localStorage unavailable/quota — preference is best-effort only.
  }
}

/** True when a stored preference blob exists (i.e. a returning user). */
export function hasEditorUIPrefs(storage?: EditorUIPrefStorage): boolean {
  const store = storage ?? defaultStorage();
  try {
    return store.getItem(EDITOR_UI_PREFS_KEY) !== null;
  } catch {
    return false;
  }
}

/** Clear the stored preference blob. */
export function clearEditorUIPrefs(storage?: EditorUIPrefStorage): void {
  const store = storage ?? defaultStorage();
  try {
    store.removeItem?.(EDITOR_UI_PREFS_KEY);
  } catch {
    // best-effort
  }
}

/** Alias for clearEditorUIPrefs — restore the pristine default state. */
export function resetEditorUIPrefs(storage?: EditorUIPrefStorage): void {
  clearEditorUIPrefs(storage);
}
