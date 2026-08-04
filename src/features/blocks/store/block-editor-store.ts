// ---------------------------------------------------------------------------
// Block editor — transient store (Phase O)
//
// Holds ONLY builder UI state and session-level working trees:
//   - selection + expansion within the build tree
//   - block browser open state + insertion target
//   - recent / favorite block types (favorites persisted as a UI preference)
//   - session "preview" trees for structural block ops that cannot yet fold
//     into the section model (Phase P persistence candidate)
//
// This store NEVER touches ProjectSchema, history, dirty state, or autosave.
// Persisted block edits go through the editor store's commitBlockTree action.
// ---------------------------------------------------------------------------

import { create } from "zustand";
import type { BlockError, BlockTree, BlockType } from "../types";
import { loadBlockPrefs, saveBlockPrefs } from "../prefs/block-builder-prefs";

export const MAX_RECENT_BLOCKS = 8;

export interface BlockBrowserTarget {
  pageId: string;
  sectionId: string;
  /** Optional target parent block id inside the section tree. */
  parentId?: string;
}

/** A session working tree layered over the derived forest. */
export interface SessionBlockTree {
  /** Fingerprint of the section props the tree was built from. */
  fingerprint: string;
  tree: BlockTree;
}

export interface BlockEditorState {
  // ---- Builder UI state ----
  hydrated: boolean;
  selectedBlockId: string | null;
  expandedIds: string[];
  browserOpen: boolean;
  browserTarget: BlockBrowserTarget | null;
  recentBlockTypes: BlockType[];
  favoriteBlockTypes: BlockType[];

  // ---- Feedback ----
  lastError: BlockError | null;
  lastWarnings: string[];

  // ---- Session working trees (structural preview, not persisted) ----
  sessionTrees: Record<string, SessionBlockTree>;

  // ---- Actions ----
  init: () => void;
  selectBlock: (id: string | null) => void;
  toggleExpand: (id: string) => void;
  setExpanded: (ids: string[]) => void;
  openBrowser: (target: BlockBrowserTarget) => void;
  closeBrowser: () => void;
  addRecent: (type: BlockType) => void;
  toggleFavorite: (type: BlockType) => void;
  setFeedback: (error: BlockError | null, warnings?: string[]) => void;
  setSessionTree: (sectionId: string, session: SessionBlockTree | null) => void;
  clearSessionTrees: () => void;
  reset: () => void;
}

export const useBlockEditorStore = create<BlockEditorState>()((set) => ({
  hydrated: false,
  selectedBlockId: null,
  expandedIds: [],
  browserOpen: false,
  browserTarget: null,
  recentBlockTypes: [],
  favoriteBlockTypes: loadBlockPrefs().favoriteBlockTypes,
  lastError: null,
  lastWarnings: [],
  sessionTrees: {},

  init: () => {
    set({ hydrated: true, favoriteBlockTypes: loadBlockPrefs().favoriteBlockTypes });
  },

  selectBlock: (id) => set({ selectedBlockId: id, lastError: null, lastWarnings: [] }),

  toggleExpand: (id) =>
    set((state) => ({
      expandedIds: state.expandedIds.includes(id)
        ? state.expandedIds.filter((e) => e !== id)
        : [...state.expandedIds, id],
    })),

  setExpanded: (ids) => set({ expandedIds: ids }),

  openBrowser: (target) =>
    set({ browserOpen: true, browserTarget: target, lastError: null }),

  closeBrowser: () => set({ browserOpen: false, browserTarget: null }),

  addRecent: (type) =>
    set((state) => ({
      recentBlockTypes: [
        type,
        ...state.recentBlockTypes.filter((t) => t !== type),
      ].slice(0, MAX_RECENT_BLOCKS),
    })),

  toggleFavorite: (type) => {
    const current = loadBlockPrefs().favoriteBlockTypes;
    const next = current.includes(type)
      ? current.filter((t) => t !== type)
      : [...current, type];
    saveBlockPrefs({ favoriteBlockTypes: next });
    set({ favoriteBlockTypes: next });
  },

  setFeedback: (error, warnings = []) => set({ lastError: error, lastWarnings: warnings }),

  setSessionTree: (sectionId, session) =>
    set((state) => {
      const sessionTrees = { ...state.sessionTrees };
      if (session) sessionTrees[sectionId] = session;
      else delete sessionTrees[sectionId];
      return { sessionTrees };
    }),

  clearSessionTrees: () => set({ sessionTrees: {} }),

  reset: () => {
    set({
      hydrated: true,
      selectedBlockId: null,
      expandedIds: [],
      browserOpen: false,
      browserTarget: null,
      recentBlockTypes: [],
      favoriteBlockTypes: loadBlockPrefs().favoriteBlockTypes,
      lastError: null,
      lastWarnings: [],
      sessionTrees: {},
    });
  },
}));
