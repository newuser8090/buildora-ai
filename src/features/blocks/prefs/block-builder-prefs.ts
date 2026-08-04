// ---------------------------------------------------------------------------
// Block builder — persistent user UI preferences (Phase O)
//
// UI preferences ONLY: never part of ProjectSchema, never exported, never in
// project history. Currently this stores the user's favorited block types for
// the block browser. SSR-safe (module-level memory fallback).
// ---------------------------------------------------------------------------

import type { BlockType } from "../types";
import { ALL_BLOCK_TYPES } from "../registry/default-blocks";

export const BLOCK_PREFS_KEY = "buildora:blocks:prefs";

export interface BlockPrefs {
  favoriteBlockTypes: BlockType[];
}

export const DEFAULT_BLOCK_PREFS: BlockPrefs = {
  favoriteBlockTypes: [],
};

export interface BlockPrefStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

let memoryStorageInstance: BlockPrefStorage | null = null;

function createMemoryStorage(): BlockPrefStorage {
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

function defaultStorage(): BlockPrefStorage {
  if (typeof window !== "undefined" && typeof window.localStorage !== "undefined") {
    return window.localStorage;
  }
  return createMemoryStorage();
}

function isValidBlockType(value: unknown): value is BlockType {
  return typeof value === "string" && (ALL_BLOCK_TYPES as string[]).includes(value);
}

/** Load prefs. Corrupt JSON/unknown shapes fall back field by field. */
export function loadBlockPrefs(storage?: BlockPrefStorage): BlockPrefs {
  const store = storage ?? defaultStorage();
  let raw: string | null = null;
  try {
    raw = store.getItem(BLOCK_PREFS_KEY);
  } catch {
    return { ...DEFAULT_BLOCK_PREFS };
  }
  if (!raw) return { ...DEFAULT_BLOCK_PREFS };
  try {
    const parsed = JSON.parse(raw) as Partial<BlockPrefs>;
    const favoriteBlockTypes = Array.isArray(parsed.favoriteBlockTypes)
      ? parsed.favoriteBlockTypes.filter(isValidBlockType)
      : [];
    // Deduplicate deterministically.
    return {
      favoriteBlockTypes: [...new Set(favoriteBlockTypes)].slice(0, 24),
    };
  } catch {
    return { ...DEFAULT_BLOCK_PREFS };
  }
}

/** Persist prefs. Write failures are swallowed (UI preference only). */
export function saveBlockPrefs(prefs: BlockPrefs, storage?: BlockPrefStorage): void {
  const store = storage ?? defaultStorage();
  try {
    store.setItem(BLOCK_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // best-effort
  }
}

/** Test helper — clear the stored preference. */
export function clearBlockPrefs(storage?: BlockPrefStorage): void {
  const store = storage ?? defaultStorage();
  try {
    store.removeItem?.(BLOCK_PREFS_KEY);
  } catch {
    // best-effort
  }
}
