import { create } from "zustand";
import type { Page, Project, Viewport } from "@/types/project";
import type { BaseSection } from "@/types/section";
import type { Asset } from "@/features/assets/types";
import type { SiteSettings } from "@/features/site-settings/types";
import { sanitizeSiteSettings } from "@/features/site-settings/schema";
import type { PersistenceError } from "@/features/persistence/types";
import { clearAssetReferences } from "@/features/assets/services/reference-cleanup";
import { getCanonicalExtension } from "@/features/assets/services/file-validator";
import {
  insertSectionAt,
  moveSectionToIndex,
  normalizeSectionOrders,
  reorderSections,
  selectionAfterDelete,
  type SectionInsertPosition,
  type StructureError,
} from "./section-structure";
import {
  addPageToList,
  buildPage,
  createPageId,
  deletePageFromList,
  movePageToIndex,
  renamePageInList,
  resolveUniqueSlug,
  sanitizePageMeta,
  type PageMetaInput,
  type PageStructureError,
} from "./page-structure";
import { isSingletonSectionType, type SectionType } from "../section-library/types";
import { createSectionId } from "../section-library/services/section-factory";
import type {
  AiEditApplyResult,
  AiEditOperation,
  AiEditPlan,
} from "@/features/ai-editing/plan-types";
import { simulatePlan } from "@/features/ai-editing/services/plan-simulator";
import { updateEditableField } from "@/features/inline-editing/services/field-update";
import type { EditableFieldDescriptor } from "@/features/inline-editing/types";
import type { InlineFieldUpdateResult } from "@/features/inline-editing/types";
import { blockTreeToSection } from "@/features/blocks/adapters/section-block-adapter";
import type { BlockTree } from "@/features/blocks/types";
import { isEditorWritable } from "@/features/workspaces/store/workspace-access-store";
import {
  beginRemoteProjection,
  endRemoteProjection,
  getCollabCommitHook,
} from "@/features/collaboration/editor-commit-hook";

// ---------------------------------------------------------------------------
// Mutation result types
// ---------------------------------------------------------------------------

export type EditorMutationErrorCode =
  | "READONLY"
  | "PAGE_NOT_FOUND"
  | "SECTION_NOT_FOUND"
  | "TARGET_NOT_FOUND"
  | "SECTION_ID_CONFLICT"
  | "SINGLETON_SECTION_EXISTS"
  | "INVALID_INSERT_POSITION"
  | "CANNOT_MOVE_OUT_OF_BOUNDS"
  | "CANNOT_DELETE_LAST_SECTION"
  | "CANNOT_DELETE_LAST_PAGE"
  | "INVALID_PAGE_TITLE"
  | "NO_OP"
  | "INVALID_TREE";

export interface EditorMutationError {
  code: EditorMutationErrorCode;
  message: string;
}

export type EditorMutationResult =
  | { ok: true; changed: boolean }
  | { ok: false; error: EditorMutationError };

/** Read-only guard result for mutation actions (Phase P14 — viewers and
 *  lease-blocked editors must never mutate a shared project through the
 *  store boundary). */
export function readonlyDenied(): EditorMutationResult {
  return {
    ok: false,
    error: {
      code: "READONLY",
      message: "This project is read-only right now.",
    },
  };
}

// ---------------------------------------------------------------------------
// History stack
// ---------------------------------------------------------------------------

interface History {
  past: Project[];
  present: Project;
  future: Project[];
}

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

export interface EditorState {
  // Project
  project: Project;

  // Selection
  selectedSectionId: string | null;
  selectedPageId: string | null;

  // Viewport
  viewport: Viewport;
  zoom: number;

  // Generation
  isGenerating: boolean;
  generationProgress: number;

  // History
  history: History;

  // ---- Persistence state ----

  isHydrated: boolean;
  isDirty: boolean;
  activeProjectId: string;
  revision: number;
  saveStatus: "hydrating" | "idle" | "unsaved" | "saving" | "saved" | "error";
  lastSavedAt: string | null;
  persistenceError: PersistenceError | null;
  hydrationError: PersistenceError | null;

  // ---- Internal (not persisted) ----

  /** Active editing session. When set, mutations update project in place
   *  without pushing to the history stack. Call commitEditSession() to
   *  finalize with a single history entry, or cancelEditSession() to revert. */
  _editingSession: { snapshot: Project } | null;

  // ---- Actions ----

  setProject: (project: Project) => void;
  initProject: (project: Project) => void;

  // Selection
  selectSection: (id: string | null) => void;
  clearSelection: () => void;
  selectPage: (id: string | null) => void;

  // Page lifecycle
  addPage: (options?: { title?: string }) => EditorMutationResult;
  renamePage: (pageId: string, title: string) => EditorMutationResult;
  deletePage: (pageId: string) => EditorMutationResult;
  movePage: (pageId: string, targetIndex: number) => EditorMutationResult;
  updatePageMeta: (pageId: string, meta: PageMetaInput) => EditorMutationResult;

  // Phase P7 — site-wide settings (name, SEO, social, favicon)
  updateSiteSettings: (patch: Partial<SiteSettings>) => EditorMutationResult;

  // Viewport & zoom
  setViewport: (viewport: Viewport) => void;
  setZoom: (zoom: number) => void;

  // Generation
  setGenerating: (isGenerating: boolean) => void;
  setGenerationProgress: (progress: number) => void;

  // Mutations
  updateSection: (sectionId: string, updates: Partial<BaseSection>) => void;
  updateSectionProps: (sectionId: string, props: Record<string, unknown>) => void;
  updateSectionStyles: (sectionId: string, styles: Record<string, unknown>) => void;
  insertSection: (
    pageId: string,
    section: BaseSection,
    position: SectionInsertPosition,
  ) => EditorMutationResult;
  reorderSection: (
    pageId: string,
    activeSectionId: string,
    overSectionId: string,
  ) => EditorMutationResult;
  moveSection: (
    pageId: string,
    sectionId: string,
    targetIndex: number,
  ) => EditorMutationResult;
  moveSectionUp: (pageId: string, sectionId: string) => EditorMutationResult;
  moveSectionDown: (pageId: string, sectionId: string) => EditorMutationResult;
  duplicateSection: (sectionId: string) => EditorMutationResult;
  deleteSection: (sectionId: string) => EditorMutationResult;
  setSectionVisible: (sectionId: string, visible: boolean) => EditorMutationResult;
  toggleSectionVisibility: (sectionId: string) => EditorMutationResult;

  // Asset management
  getAsset: (assetId: string) => Asset | undefined;
  addAsset: (asset: Asset) => void;
  removeAsset: (assetId: string, options?: { clearReferences?: boolean }) => void;
  replaceAsset: (assetId: string, replacement: Asset) => void;
  renameAsset: (assetId: string, name: string) => { success: boolean; error?: string };

  // Persistence actions
  hydrateProject: (project: Project, revision: number) => void;
  /**
   * Phase P16 — apply the projected collaborative document to the store.
   * Remote/local CRDT projections land here: no history entry, no dirty flag,
   * selection re-validated against the incoming document. Never called through
   * withHistory (so it can't re-enter the commit hook).
   */
  applyRemoteProject: (project: Project) => void;
  setSaveStatus: (status: EditorState["saveStatus"]) => void;
  setDirty: (dirty: boolean) => void;
  setRevision: (revision: number) => void;
  setActiveProjectId: (id: string) => void;
  setPersistenceError: (error: PersistenceError | null) => void;
  setHydrationError: (error: PersistenceError | null) => void;
  setLastSavedAt: (timestamp: string | null) => void;
  markSaved: (savedAt?: string) => void;

  // History
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  /**
   * Phase P16 — reset the projected document state without touching
   * persistence. Used when a collaborative session starts/stops so the
   * editor reflects the canonical document exactly (no stale CRDT projection).
   */
  clearCollaborativeProjection: () => void;

  // Editing session (avoids per-keystroke history entries)
  beginEditSession: () => void;
  commitEditSession: () => void;
  cancelEditSession: () => void;

  // AI edit plan application (Phase L) — one atomic history entry
  applyAiEditPlan: (
    plan: AiEditPlan,
    selectedOperationIds?: string[],
    options?: { allowDestructive?: boolean },
  ) => AiEditApplyResult;

  // Inline field update (Phase M) — one validated, atomic history entry
  updateEditableFieldValue: (
    descriptor: EditableFieldDescriptor,
    nextValue: string,
  ) => InlineFieldUpdateResult;

  // Block tree commit (Phase O) — fold a block tree back into a section
  // through the adapter (validated) as ONE atomic history entry.
  commitBlockTree: (
    pageId: string,
    sectionId: string,
    tree: BlockTree,
  ) => EditorMutationResult;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cloneProject(project: Project): Project {
  return JSON.parse(JSON.stringify(project));
}

function createHistory(project: Project): History {
  return {
    past: [],
    present: cloneProject(project),
    future: [],
  };
}

function withHistory(
  state: EditorState,
  mutate: (project: Project) => void,
): Partial<EditorState> {
  const updated = cloneProject(state.history.present);
  mutate(updated);

  // Phase P16 — collaborative mode: route the mutation through the active
  // collaboration session as ONE CRDT transaction (local origin → undo-scoped).
  // The projection loop then writes the store back via applyRemoteProject, so
  // no local history entry is created here (undo is CRDT-scoped, never another
  // user's work). The session is only registered while the workspace session
  // is editable; personal projects keep the existing history behavior exactly.
  const hook = getCollabCommitHook();
  if (hook) {
    hook.applyLocalProject(updated);
    return {};
  }

  const snapshot = cloneProject(state.history.present);
  return {
    project: updated,
    history: {
      past: [...state.history.past, snapshot],
      present: updated,
      future: [],
    },
  };
}

/**
 * Phase P16 — apply a local mutation that bypasses withHistory (the active
 * inline `_editingSession` path). In collaborative mode the session is the
 * sole commit boundary (one CRDT transaction per change); otherwise the store
 * keeps the plain project write used by the editing session.
 */
function commitLocalProject(
  updated: Project,
): Partial<EditorState> {
  const hook = getCollabCommitHook();
  if (hook) {
    hook.applyLocalProject(updated);
    return {};
  }
  return { project: updated };
}

/** Map a structure-layer error into an EditorMutationResult. */
function mapStructureError(error: StructureError): EditorMutationResult {
  return { ok: false, error: { code: error.code, message: error.message } };
}

/** Map a page-structure-layer error into an EditorMutationResult. */
function mapPageStructureError(error: PageStructureError): EditorMutationResult {
  return { ok: false, error: { code: error.code, message: error.message } };
}

/** Pick a unique default page title ("Untitled Page", "Untitled Page 2", …). */
function uniqueDefaultTitle(pages: Page[], base: string): string {
  const titles = new Set(pages.map((p) => p.title.toLowerCase()));
  if (!titles.has(base.toLowerCase())) return base;
  let n = 2;
  while (titles.has(`${base} ${n}`.toLowerCase())) n += 1;
  return `${base} ${n}`;
}

// ---------------------------------------------------------------------------
// Default empty project
// ---------------------------------------------------------------------------

const EMPTY_PROJECT: Project = {
  id: "",
  name: "",
  theme: {
    palette: {
      background: "#ffffff",
      foreground: "#0a0a0a",
      primary: "#7c5cfc",
      primaryForeground: "#ffffff",
      secondary: "#f5f5f5",
      secondaryForeground: "#0a0a0a",
      muted: "#f5f5f5",
      mutedForeground: "#737373",
      accent: "#7c5cfc",
      accentForeground: "#ffffff",
      border: "#e5e5e5",
      card: "#ffffff",
      cardForeground: "#0a0a0a",
    },
    typography: {
      fontFamily: "Geist, system-ui, sans-serif",
      headingFont: "Geist, system-ui, sans-serif",
      baseSize: "16px",
      scale: 1.25,
    },
    spacing: {
      sectionPadding: "6rem 0",
      containerMaxWidth: "1120px",
      gap: "1.5rem",
    },
    radius: {
      sm: "0.375rem",
      md: "0.5rem",
      lg: "0.75rem",
      xl: "1rem",
      full: "9999px",
    },
    shadows: {
      sm: "0 1px 2px rgba(0,0,0,0.05)",
      md: "0 4px 6px rgba(0,0,0,0.07)",
      lg: "0 10px 15px rgba(0,0,0,0.1)",
      xl: "0 20px 25px rgba(0,0,0,0.15)",
    },
  },
  assets: [],
  pages: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useEditorStore = create<EditorState>()((set, get) => ({
  // ---- State ----
  project: EMPTY_PROJECT,
  selectedSectionId: null,
  selectedPageId: null,
  viewport: "desktop",
  zoom: 100,
  isGenerating: false,
  generationProgress: 0,
  history: createHistory(EMPTY_PROJECT),
  isHydrated: false,
  isDirty: false,
  activeProjectId: "",
  revision: 0,
  saveStatus: "idle" as const,
  lastSavedAt: null,
  persistenceError: null,
  hydrationError: null,
  _editingSession: null,

  // ---- Actions ----

  initProject: (project) => {
    const cloned = cloneProject(project);
    // Normalize legacy projects without the assets field
    if (!cloned.assets) cloned.assets = [];
    // Create a clean history with the new project as the first entry
    // This ensures generation is represented as one history change
    const initialHistory: History = {
      past: [],
      present: cloned,
      future: [],
    };
    set({
      project: cloned,
      history: initialHistory,
      selectedSectionId: null,
      selectedPageId: project.pages[0]?.id ?? null,
      viewport: "desktop",
      zoom: 100,
      isGenerating: false,
      generationProgress: 0,
      _editingSession: null,
    });
  },

  setProject: (project) => {
    if (!isEditorWritable()) return;
    set(withHistory(get(), (p) => {
      Object.assign(p, cloneProject(project));
    }));
  },

  selectSection: (id) => set({ selectedSectionId: id }),
  clearSelection: () => set({ selectedSectionId: null }),
  // Switching pages clears the section selection — a section from another
  // page must never stay selected. No-op when the page is already active.
  selectPage: (id) =>
    set((state) => {
      if (state.selectedPageId === id) return {};
      return { selectedPageId: id, selectedSectionId: null };
    }),

  // ---- Page lifecycle ----

  addPage: (options) => {
    if (!isEditorWritable()) return readonlyDenied();
    const state = get();
    const requested = options?.title?.trim();
    const title = requested
      ? requested
      : uniqueDefaultTitle(state.project.pages, "Untitled Page");

    const page = buildPage({
      pageId: createPageId(),
      sectionId: createSectionId("hero"),
      title,
      slug: resolveUniqueSlug(state.project.pages, title),
    });

    set(
      withHistory(state, (project) => {
        project.pages = addPageToList(project.pages, page);
        project.updatedAt = new Date().toISOString();
      }),
    );

    // Select the new page and clear any section selection.
    set({ selectedPageId: page.id, selectedSectionId: null });
    return { ok: true, changed: true };
  },

  renamePage: (pageId, title) => {
    if (!isEditorWritable()) return readonlyDenied();
    const state = get();
    const result = renamePageInList({
      pages: state.project.pages,
      pageId,
      title,
    });
    if (!result.ok) return mapPageStructureError(result.error);
    if (!result.value.changed) return { ok: true, changed: false };

    set(
      withHistory(state, (project) => {
        project.pages = result.value.pages;
        project.updatedAt = new Date().toISOString();
      }),
    );
    return { ok: true, changed: true };
  },

  deletePage: (pageId) => {
    if (!isEditorWritable()) return readonlyDenied();
    const state = get();
    const result = deletePageFromList(state.project.pages, pageId);
    if (!result.ok) return mapPageStructureError(result.error);

    set(
      withHistory(state, (project) => {
        project.pages = result.value.pages;
        project.updatedAt = new Date().toISOString();
      }),
    );

    // Selection moves to the nearest next/previous page; sections are cleared.
    set({ selectedPageId: result.value.nextSelection, selectedSectionId: null });
    return { ok: true, changed: true };
  },

  movePage: (pageId, targetIndex) => {
    if (!isEditorWritable()) return readonlyDenied();
    const state = get();
    const result = movePageToIndex(state.project.pages, pageId, targetIndex);
    if (!result.ok) return mapPageStructureError(result.error);
    if (!result.value.changed) return { ok: true, changed: false };

    set(
      withHistory(state, (project) => {
        project.pages = result.value.pages;
        project.updatedAt = new Date().toISOString();
      }),
    );
    return { ok: true, changed: true };
  },

  updatePageMeta: (pageId, meta) => {
    if (!isEditorWritable()) return readonlyDenied();
    const state = get();
    const page = state.project.pages.find((p) => p.id === pageId);
    if (!page) {
      return {
        ok: false,
        error: { code: "PAGE_NOT_FOUND", message: `Page "${pageId}" does not exist.` },
      };
    }

    const sanitized = sanitizePageMeta(meta);
    const current = page.meta ?? {};
    if (JSON.stringify(current) === JSON.stringify(sanitized)) {
      return { ok: true, changed: false };
    }

    set(
      withHistory(state, (project) => {
        const target = project.pages.find((p) => p.id === pageId);
        if (!target) return;
        target.meta = sanitized;
        project.updatedAt = new Date().toISOString();
      }),
    );
    return { ok: true, changed: true };
  },

  updateSiteSettings: (patch) => {
    if (!isEditorWritable()) return readonlyDenied();
    const state = get();
    const current = state.project.siteSettings;

    // Merge the patch over the current settings, then sanitize (trim,
    // drop empties). If the sanitized result differs from what is stored,
    // the change is committed as one history entry (clearing a field IS a
    // change); identical results are a no-op so re-saving without edits
    // never pollutes undo history.
    const next = sanitizeSiteSettings({
      ...(current ?? {}),
      ...patch,
    } as Record<string, unknown>);

    if (JSON.stringify(current ?? {}) === JSON.stringify(next)) {
      return { ok: true, changed: false };
    }

    set(
      withHistory(state, (project) => {
        const merged = next as unknown as SiteSettings;
        if (Object.keys(next).length === 0) {
          delete project.siteSettings;
        } else {
          project.siteSettings = merged;
        }
        project.updatedAt = new Date().toISOString();
      }),
    );
    return { ok: true, changed: true };
  },

  setViewport: (viewport) => set({ viewport }),
  setZoom: (zoom) => set({ zoom }),

  setGenerating: (isGenerating) => set({ isGenerating }),
  setGenerationProgress: (progress) => set({ generationProgress: progress }),

  // ---- Asset management ----

  getAsset: (assetId) => {
    return get().project.assets.find((a) => a.id === assetId);
  },

  addAsset: (asset) => {
    if (!isEditorWritable()) return;
    set(
      withHistory(get(), (project) => {
        project.assets.push(asset);
        project.updatedAt = new Date().toISOString();
      }),
    );
  },

  removeAsset: (assetId, options) => {
    if (!isEditorWritable()) return;
    const shouldClear = options?.clearReferences ?? true;
    set(
      withHistory(get(), (project) => {
        if (shouldClear) {
          // Clear all references to this asset across all sections
          const cleaned = clearAssetReferences(project, assetId);
          project.pages = cleaned.pages;
        }
        // Remove the asset
        project.assets = project.assets.filter((a) => a.id !== assetId);
        project.updatedAt = new Date().toISOString();
      }),
    );
  },

  replaceAsset: (assetId, replacement) => {
    if (!isEditorWritable()) return;
    set(
      withHistory(get(), (project) => {
        const idx = project.assets.findIndex((a) => a.id === assetId);
        if (idx === -1) return;
        // Preserve the original ID and createdAt
        project.assets[idx] = {
          ...replacement,
          id: assetId,
          createdAt: project.assets[idx].createdAt,
        };
        project.updatedAt = new Date().toISOString();
      }),
    );
  },

  renameAsset: (assetId, name) => {
    if (!isEditorWritable()) {
      return { success: false, error: "This project is read-only right now." };
    }
    if (!name || typeof name !== "string") {
      return { success: false, error: "Name must be a non-empty string." };
    }

    const trimmed = name.trim();
    if (trimmed.length === 0) {
      return { success: false, error: "Asset name cannot be empty." };
    }

    const asset = get().project.assets.find((a) => a.id === assetId);
    if (!asset) {
      return { success: false, error: "Asset not found." };
    }

    // Check extension compatibility if the new name has a different extension
    const newExtMatch = trimmed.match(/\.([a-zA-Z0-9]+)$/);
    const newExt = newExtMatch ? `.${newExtMatch[1].toLowerCase()}` : undefined;

    if (newExt) {
      // Check that the new extension is valid for the asset's MIME type.
      // .jpeg and .jpg are both valid JPEG extensions — this check uses
      // the canonical extension (getCanonicalExtension returns ".jpg" for
      // "image/jpeg"), so renaming a .jpeg file to .jpg is allowed.
      const expectedExt = getCanonicalExtension(asset.mimeType);
      if (expectedExt && newExt !== expectedExt) {
        return {
          success: false,
          error: `Cannot rename to "${trimmed}": extension "${newExt}" conflicts with ${asset.mimeType}. Expected extension: ${expectedExt}.`,
        };
      }
    }

    set(
      withHistory(get(), (project) => {
        const a = project.assets.find((a) => a.id === assetId);
        if (!a) return;
        a.name = trimmed;
        project.updatedAt = new Date().toISOString();
      }),
    );

    return { success: true };
  },

  // ---- Persistence actions ----

  hydrateProject: (project, revision) => {
    const cloned = cloneProject(project);
    if (!cloned.assets) cloned.assets = [];
    const initialHistory: History = {
      past: [],
      present: cloned,
      future: [],
    };
    set({
      project: cloned,
      history: initialHistory,
      revision,
      activeProjectId: project.id,
      isHydrated: true,
      isDirty: false,
      saveStatus: "saved",
      selectedPageId: project.pages[0]?.id ?? null,
      selectedSectionId: null,
      hydrationError: null,
      persistenceError: null,
    });
  },

  setSaveStatus: (status) => set({ saveStatus: status }),

  setDirty: (dirty) => {
    set({ isDirty: dirty, saveStatus: dirty ? "unsaved" : "saved" });
  },

  setRevision: (revision) => set({ revision }),

  setActiveProjectId: (id) => set({ activeProjectId: id }),

  setPersistenceError: (error) => set({ persistenceError: error }),

  setHydrationError: (error) => set({ hydrationError: error }),

  setLastSavedAt: (timestamp) => set({ lastSavedAt: timestamp }),

  markSaved: (savedAt?: string) => {
    set({
      isDirty: false,
      saveStatus: "saved",
      lastSavedAt: savedAt ?? new Date().toISOString(),
      persistenceError: null,
    });
  },

  applyRemoteProject: (project) => {
    const cloned = cloneProject(project);
    if (!cloned.assets) cloned.assets = [];
    const state = get();
    // Re-validate selection against the incoming document — a remote
    // deletion must never leave a dangling selected page/section.
    let selectedPageId = state.selectedPageId;
    if (selectedPageId && !cloned.pages.some((p) => p.id === selectedPageId)) {
      selectedPageId = cloned.pages[0]?.id ?? null;
    }
    let selectedSectionId = state.selectedSectionId;
    if (selectedSectionId) {
      const sectionExists = cloned.pages
        .flatMap((p) => p.sections)
        .some((s) => s.id === selectedSectionId);
      if (!sectionExists) selectedSectionId = null;
    }
    // Remote projection: the persistence controller must NOT treat this as a
    // local edit (no revision bump / dirty / autosave) — the CRDT is synced.
    beginRemoteProjection();
    try {
      set({
        project: cloned,
        history: {
          // Keep the present projection as the history base so a subsequent
          // local mutation diffs against the freshest collaborative state.
          // Past/future stacks are deliberately NOT pushed by remote changes —
          // collaborative undo is scoped through Yjs, never this stack.
          ...state.history,
          present: cloned,
        },
        selectedPageId,
        selectedSectionId,
      });
    } finally {
      endRemoteProjection();
    }
  },

  clearCollaborativeProjection: () => {
    const state = get();
    set({
      history: {
        past: [],
        present: cloneProject(state.project),
        future: [],
      },
    });
  },

  // ---- Editing session ----

  beginEditSession: () => {
    if (!isEditorWritable()) return;
    const { project } = get();
    set({ _editingSession: { snapshot: cloneProject(project) } });
  },

  commitEditSession: () => {
    if (!isEditorWritable()) return;
    const { _editingSession, project, history } = get();
    if (!_editingSession) return;
    // Phase P16 — in collaborative mode each keystroke already committed a
    // CRDT transaction through the session; the session end is a UI-level
    // boundary only, so no local history entry is created here.
    if (getCollabCommitHook()) {
      set({ _editingSession: null });
      return;
    }
    // Push the snapshot to past, set current project as present, clear future
    set({
      _editingSession: null,
      history: {
        past: [...history.past, _editingSession.snapshot],
        present: project,
        future: [],
      },
    });
  },

  cancelEditSession: () => {
    if (!isEditorWritable()) return;
    const { _editingSession } = get();
    if (!_editingSession) return;
    // Phase P16 — restoring the pre-edit snapshot in collaborative mode would
    // silently overwrite concurrent remote changes; the CRDT is authoritative.
    // The session simply ends (keystrokes already committed incrementally).
    if (getCollabCommitHook()) {
      set({ _editingSession: null });
      return;
    }
    // Restore the snapshot
    set({
      _editingSession: null,
      project: _editingSession.snapshot,
    });
  },

  // ---- AI edit plan application (Phase L) ----
  //
  // Applies all or a selection of a validated plan's operations as ONE
  // atomic history entry. The full selected set is simulated on a clone
  // first — no live mutation happens until the simulation succeeds.
  // Revision, dirty flag, and autosave are handled by the controller's
  // normal store subscription (one project-reference change → one revision).

  applyAiEditPlan: (plan, selectedOperationIds, options) => {
    if (!isEditorWritable()) {
      return {
        ok: false,
        error: { code: "PLAN_READONLY", message: "This project is read-only right now." },
      };
    }
    const state = get();

    // 1. Project identity
    if (state.project.id !== plan.projectId) {
      return {
        ok: false,
        error: {
          code: "PLAN_PROJECT_MISMATCH",
          message: "This plan was created for a different project.",
        },
      };
    }

    // 2. Stale revision guard — never silently apply a stale plan
    if (state.revision !== plan.baseRevision) {
      return {
        ok: false,
        error: {
          code: "PLAN_STALE",
          message:
            "This project changed since the plan was created. Regenerate the plan to continue.",
        },
      };
    }

    // 3. Resolve the selected operations, preserving original plan order
    let selected: AiEditOperation[];
    if (selectedOperationIds) {
      const idSet = new Set(selectedOperationIds);
      const unknown = selectedOperationIds.filter(
        (id) => !plan.operations.some((o) => o.id === id),
      );
      if (unknown.length > 0) {
        return {
          ok: false,
          error: {
            code: "PLAN_OPERATION_INVALID",
            message: `Unknown operation ids: ${unknown.join(", ")}`,
          },
        };
      }
      // Dependency closure — a selected op's dependencies must be selected
      const byId = new Map(plan.operations.map((o) => [o.id, o]));
      for (const id of idSet) {
        for (const dep of byId.get(id)?.dependsOn ?? []) {
          if (!idSet.has(dep)) {
            return {
              ok: false,
              error: {
                code: "PLAN_DEPENDENCY_INVALID",
                message: `Operation "${id}" depends on "${dep}", which is not selected.`,
              },
            };
          }
        }
      }
      selected = plan.operations.filter((o) => idSet.has(o.id));
    } else {
      selected = plan.operations;
    }

    // 4. No-op selection — no history entry
    if (selected.length === 0) {
      return {
        ok: true,
        changed: false,
        applied: 0,
        skipped: plan.operations.length,
        operationResults: [],
      };
    }

    // 5. Destructive confirmation guard (high-risk ops)
    const hasDestructive = selected.some((o) => o.risk === "high");
    if (hasDestructive && options?.allowDestructive !== true) {
      return {
        ok: false,
        error: {
          code: "PLAN_DESTRUCTIVE_CONFIRMATION_REQUIRED",
          message:
            "This plan contains destructive changes. Confirm them before applying.",
        },
      };
    }

    // 6. Simulate the entire selected set on a clone — never the live store
    const simulation = simulatePlan(state.project, selected, {
      captureSnapshots: false,
    });
    if (!simulation.ok) {
      return {
        ok: false,
        error: simulation.error,
      };
    }

    // 7. Commit the resulting project as ONE history entry
    set(
      withHistory(state, (project) => {
        const result = JSON.parse(JSON.stringify(simulation.project)) as Project;
        Object.assign(project, result);
        project.updatedAt = new Date().toISOString();
      }),
    );

    // 8. Keep selection valid — page still exists? section still exists?
    const after = useEditorStore.getState();
    const pageExists = after.project.pages.some(
      (p) => p.id === state.selectedPageId,
    );
    const selectedPageId = pageExists
      ? state.selectedPageId
      : (after.project.pages[0]?.id ?? null);
    let selectedSectionId = state.selectedSectionId;
    if (selectedSectionId) {
      const sectionExists = after.project.pages
        .flatMap((p) => p.sections)
        .some((s) => s.id === selectedSectionId);
      if (!sectionExists) selectedSectionId = null;
    }
    set({ selectedPageId, selectedSectionId });

    return {
      ok: true,
      changed: true,
      applied: selected.length,
      skipped: plan.operations.length - selected.length,
      operationResults: simulation.operationResults,
    };
  },

  // ---- Inline field update (Phase M) ----
  //
  // Applies ONE validated field value as a single atomic history entry.
  // The pure update service validates page/section/type/path/value and the
  // resulting section schema before any live mutation happens. A no-op
  // (unchanged value) skips history entirely.
  //
  // Revision, dirty flag, and autosave are handled by the controller's normal
  // store subscription (one project-reference change → one revision).

  updateEditableFieldValue: (descriptor, nextValue) => {
    if (!isEditorWritable()) {
      return {
        ok: false,
        error: {
          code: "INLINE_READONLY",
          message: "This project is read-only right now.",
        },
      };
    }
    const state = get();

    const result = updateEditableField(state.project, descriptor, nextValue);
    if (!result.ok) return { ok: false, error: result.error };
    if (!result.changed) return { ok: true, changed: false };

    // Commit the resulting project as ONE history entry. Selection is
    // preserved (selection is separate store state, untouched here).
    set(
      withHistory(state, (project) => {
        const next = JSON.parse(JSON.stringify(result.project)) as Project;
        Object.assign(project, next);
        project.updatedAt = new Date().toISOString();
      }),
    );

    return { ok: true, changed: true };
  },

  // ---- Block tree commit (Phase O) ----
  //
  // Folds a block tree back into the target section through the adapter,
  // which validates the safe field bindings AND the resulting section schema
  // before anything is committed. A no-op (nothing changed) skips history.
  // One project reference change → one revision + one autosave sequence
  // (handled by the controller's normal store subscription).

  commitBlockTree: (pageId, sectionId, tree) => {
    if (!isEditorWritable()) return readonlyDenied();
    const state = get();
    const page = state.project.pages.find((p) => p.id === pageId);
    if (!page) {
      return {
        ok: false,
        error: { code: "PAGE_NOT_FOUND", message: `Page "${pageId}" does not exist.` },
      };
    }
    const section = page.sections.find((s) => s.id === sectionId);
    if (!section) {
      return {
        ok: false,
        error: { code: "SECTION_NOT_FOUND", message: `Section "${sectionId}" does not exist.` },
      };
    }

    const folded = blockTreeToSection(tree, section);
    if (!folded.ok) {
      return {
        ok: false,
        error: { code: "INVALID_TREE", message: folded.error.message },
      };
    }
    if (folded.value.appliedFields === 0) return { ok: true, changed: false };

    // Commit the folded props as ONE history entry. Selection is preserved
    // (selection is separate store state, untouched here).
    set(
      withHistory(state, (project) => {
        for (const p of project.pages) {
          const idx = p.sections.findIndex((s) => s.id === sectionId);
          if (idx !== -1) {
            p.sections[idx] = {
              ...p.sections[idx],
              props: folded.value.section.props,
            };
            project.updatedAt = new Date().toISOString();
            return;
          }
        }
      }),
    );

    return { ok: true, changed: true };
  },

  updateSection: (sectionId, updates) => {
    if (!isEditorWritable()) return;
    const state = get();
    // If in an edit session, mutate project directly without pushing to history
    if (state._editingSession) {
      const updated = cloneProject(state.project);
      for (const page of updated.pages) {
        const idx = page.sections.findIndex((s) => s.id === sectionId);
        if (idx !== -1) {
          page.sections[idx] = { ...page.sections[idx], ...updates };
          updated.updatedAt = new Date().toISOString();
          break;
        }
      }
      set(commitLocalProject(updated));
      return;
    }
    set(
      withHistory(state, (project) => {
        for (const page of project.pages) {
          const idx = page.sections.findIndex((s) => s.id === sectionId);
          if (idx !== -1) {
            page.sections[idx] = { ...page.sections[idx], ...updates };
            project.updatedAt = new Date().toISOString();
            return;
          }
        }
      }),
    );
  },

  updateSectionProps: (sectionId, props) => {
    if (!isEditorWritable()) return;
    const state = get();
    // If in an edit session, mutate project directly without pushing to history
    if (state._editingSession) {
      const updated = cloneProject(state.project);
      for (const page of updated.pages) {
        const idx = page.sections.findIndex((s) => s.id === sectionId);
        if (idx !== -1) {
          page.sections[idx] = {
            ...page.sections[idx],
            props: { ...page.sections[idx].props, ...props },
          };
          updated.updatedAt = new Date().toISOString();
          break;
        }
      }
      set(commitLocalProject(updated));
      return;
    }
    set(
      withHistory(state, (project) => {
        for (const page of project.pages) {
          const idx = page.sections.findIndex((s) => s.id === sectionId);
          if (idx !== -1) {
            page.sections[idx] = {
              ...page.sections[idx],
              props: { ...page.sections[idx].props, ...props },
            };
            project.updatedAt = new Date().toISOString();
            return;
          }
        }
      }),
    );
  },

  updateSectionStyles: (sectionId, styles) => {
    if (!isEditorWritable()) return;
    const state = get();
    if (state._editingSession) {
      const updated = cloneProject(state.project);
      for (const page of updated.pages) {
        const idx = page.sections.findIndex((s) => s.id === sectionId);
        if (idx !== -1) {
          page.sections[idx] = {
            ...page.sections[idx],
            styles: { ...page.sections[idx].styles, ...styles },
          };
          updated.updatedAt = new Date().toISOString();
          break;
        }
      }
      set(commitLocalProject(updated));
      return;
    }
    set(
      withHistory(state, (project) => {
        for (const page of project.pages) {
          const idx = page.sections.findIndex((s) => s.id === sectionId);
          if (idx !== -1) {
            page.sections[idx] = {
              ...page.sections[idx],
              styles: { ...page.sections[idx].styles, ...styles },
            };
            project.updatedAt = new Date().toISOString();
            return;
          }
        }
      }),
    );
  },

  insertSection: (pageId, section, position) => {
    if (!isEditorWritable()) return readonlyDenied();
    const state = get();
    const page = state.project.pages.find((p) => p.id === pageId);
    if (!page) {
      return {
        ok: false,
        error: { code: "PAGE_NOT_FOUND", message: `Page "${pageId}" does not exist.` },
      };
    }

    // ID uniqueness check
    if (page.sections.some((s) => s.id === section.id)) {
      return {
        ok: false,
        error: { code: "SECTION_ID_CONFLICT", message: `Section ID "${section.id}" already exists.` },
      };
    }

    // Singleton policy — Header and Footer may only appear once per page
    if (isSingletonSectionType(section.type)) {
      const exists = page.sections.some((s) => s.type === section.type);
      if (exists) {
        return {
          ok: false,
          error: { code: "SINGLETON_SECTION_EXISTS", message: `A ${section.type} section already exists on this page.` },
        };
      }
    }

    const result = insertSectionAt({
      sections: page.sections,
      section,
      position,
    });
    if (!result.ok) return mapStructureError(result.error);

    const ordered = normalizeSectionOrders(result.value.sections);

    set(
      withHistory(state, (project) => {
        const p = project.pages.find((pg) => pg.id === pageId);
        if (!p) return;
        p.sections = ordered;
        project.updatedAt = new Date().toISOString();
      }),
    );

    // Select the inserted section
    set({ selectedSectionId: section.id });
    return { ok: true, changed: true };
  },

  reorderSection: (pageId, activeSectionId, overSectionId) => {
    if (!isEditorWritable()) return readonlyDenied();
    const state = get();
    const page = state.project.pages.find((p) => p.id === pageId);
    if (!page) {
      return {
        ok: false,
        error: { code: "PAGE_NOT_FOUND", message: `Page "${pageId}" does not exist.` },
      };
    }

    const result = reorderSections({
      sections: page.sections,
      activeSectionId,
      overSectionId,
    });
    if (!result.ok) return mapStructureError(result.error);

    // No-op (same position) — do not create a history entry
    if (!result.value.changed) return { ok: true, changed: false };

    const ordered = normalizeSectionOrders(result.value.sections);

    set(
      withHistory(state, (project) => {
        const p = project.pages.find((pg) => pg.id === pageId);
        if (!p) return;
        p.sections = ordered;
        project.updatedAt = new Date().toISOString();
      }),
    );

    // Selection remains on the moved section
    set({ selectedSectionId: activeSectionId });
    return { ok: true, changed: true };
  },

  moveSection: (pageId, sectionId, targetIndex) => {
    if (!isEditorWritable()) return readonlyDenied();
    const state = get();
    const page = state.project.pages.find((p) => p.id === pageId);
    if (!page) {
      return {
        ok: false,
        error: { code: "PAGE_NOT_FOUND", message: `Page "${pageId}" does not exist.` },
      };
    }

    const result = moveSectionToIndex({
      sections: page.sections,
      sectionId,
      targetIndex,
    });
    if (!result.ok) return mapStructureError(result.error);
    if (!result.value.changed) return { ok: true, changed: false };

    const ordered = normalizeSectionOrders(result.value.sections);

    set(
      withHistory(state, (project) => {
        const p = project.pages.find((pg) => pg.id === pageId);
        if (!p) return;
        p.sections = ordered;
        project.updatedAt = new Date().toISOString();
      }),
    );

    set({ selectedSectionId: sectionId });
    return { ok: true, changed: true };
  },

  moveSectionUp: (pageId, sectionId) => {
    const state = get();
    const page = state.project.pages.find((p) => p.id === pageId);
    if (!page) {
      return {
        ok: false,
        error: { code: "PAGE_NOT_FOUND", message: `Page "${pageId}" does not exist.` },
      };
    }
    const index = page.sections.findIndex((s) => s.id === sectionId);
    if (index === -1) {
      return {
        ok: false,
        error: { code: "SECTION_NOT_FOUND", message: `Section "${sectionId}" does not exist.` },
      };
    }
    // First item cannot move up
    if (index === 0) return { ok: true, changed: false };
    return get().moveSection(pageId, sectionId, index - 1);
  },

  moveSectionDown: (pageId, sectionId) => {
    const state = get();
    const page = state.project.pages.find((p) => p.id === pageId);
    if (!page) {
      return {
        ok: false,
        error: { code: "PAGE_NOT_FOUND", message: `Page "${pageId}" does not exist.` },
      };
    }
    const index = page.sections.findIndex((s) => s.id === sectionId);
    if (index === -1) {
      return {
        ok: false,
        error: { code: "SECTION_NOT_FOUND", message: `Section "${sectionId}" does not exist.` },
      };
    }
    // Last item cannot move down
    if (index === page.sections.length - 1) return { ok: true, changed: false };
    return get().moveSection(pageId, sectionId, index + 1);
  },

  duplicateSection: (sectionId) => {
    if (!isEditorWritable()) return readonlyDenied();
    const state = get();
    const page = state.project.pages.find((p) =>
      p.sections.some((s) => s.id === sectionId),
    );
    if (!page) {
      return {
        ok: false,
        error: { code: "SECTION_NOT_FOUND", message: `Section "${sectionId}" does not exist.` },
      };
    }

    const source = page.sections.find((s) => s.id === sectionId);
    if (!source) {
      return {
        ok: false,
        error: { code: "SECTION_NOT_FOUND", message: `Section "${sectionId}" does not exist.` },
      };
    }

    // Singleton duplication blocked
    if (isSingletonSectionType(source.type)) {
      return {
        ok: false,
        error: { code: "SINGLETON_SECTION_EXISTS", message: `${source.type} sections cannot be duplicated.` },
      };
    }

    // Deep clone with a fresh ID, inserted immediately after the original.
    // Unknown/unsupported types are cast defensively — the ID factory only
    // uses the type for a readable prefix.
    const clone: BaseSection = ({
      ...JSON.parse(JSON.stringify(source)),
      id: createSectionId(source.type as SectionType),
    } as BaseSection);

    const sourceIndex = page.sections.findIndex((s) => s.id === sectionId);
    const nextSections = [...page.sections];
    nextSections.splice(sourceIndex + 1, 0, clone);
    const ordered = normalizeSectionOrders(nextSections);

    set(
      withHistory(state, (project) => {
        const p = project.pages.find((pg) => pg.id === page.id);
        if (!p) return;
        p.sections = ordered;
        project.updatedAt = new Date().toISOString();
      }),
    );

    // Select the new duplicate
    set({ selectedSectionId: clone.id });
    return { ok: true, changed: true };
  },

  deleteSection: (sectionId) => {
    if (!isEditorWritable()) return readonlyDenied();
    const state = get();
    const page = state.project.pages.find((p) =>
      p.sections.some((s) => s.id === sectionId),
    );
    if (!page) {
      return {
        ok: false,
        error: { code: "SECTION_NOT_FOUND", message: `Section "${sectionId}" does not exist.` },
      };
    }
    if (page.sections.length <= 1) {
      // Prevent deletion of the final section (Project schema requires ≥1)
      return {
        ok: false,
        error: { code: "CANNOT_DELETE_LAST_SECTION", message: "A page must keep at least one section." },
      };
    }

    const nextSelection = selectionAfterDelete(page.sections, sectionId);

    set(
      withHistory(state, (project) => {
        const p = project.pages.find((pg) => pg.id === page.id);
        if (!p) return;
        p.sections = p.sections.filter((s) => s.id !== sectionId);
        p.sections = normalizeSectionOrders(p.sections);
        project.updatedAt = new Date().toISOString();
      }),
    );

    // Select nearest next, else previous, else null
    set({ selectedSectionId: nextSelection });
    return { ok: true, changed: true };
  },

  setSectionVisible: (sectionId, visible) => {
    if (!isEditorWritable()) return readonlyDenied();
    const state = get();
    const page = state.project.pages.find((p) =>
      p.sections.some((s) => s.id === sectionId),
    );
    if (!page) {
      return {
        ok: false,
        error: { code: "SECTION_NOT_FOUND", message: `Section "${sectionId}" does not exist.` },
      };
    }
    const section = page.sections.find((s) => s.id === sectionId);
    if (!section) {
      return {
        ok: false,
        error: { code: "SECTION_NOT_FOUND", message: `Section "${sectionId}" does not exist.` },
      };
    }
    if (section.visible === visible) return { ok: true, changed: false };

    set(
      withHistory(state, (project) => {
        for (const p of project.pages) {
          const idx = p.sections.findIndex((s) => s.id === sectionId);
          if (idx !== -1) {
            p.sections[idx] = { ...p.sections[idx], visible };
            project.updatedAt = new Date().toISOString();
            return;
          }
        }
      }),
    );

    // Selection preserved
    return { ok: true, changed: true };
  },

  toggleSectionVisibility: (sectionId) => {
    if (!isEditorWritable()) return readonlyDenied();
    const state = get();
    const section = state.project.pages
      .flatMap((p) => p.sections)
      .find((s) => s.id === sectionId);
    if (!section) {
      return {
        ok: false,
        error: { code: "SECTION_NOT_FOUND", message: `Section "${sectionId}" does not exist.` },
      };
    }
    return get().setSectionVisible(sectionId, !section.visible);
  },

  // ---- History ----

  undo: () => {
    if (!isEditorWritable()) return;
    // Phase P16 — collaborative sessions own undo (Yjs UndoManager scoped to
    // this client's local origin). Remote updates never enter this stack, so a
    // local undo can never revert another collaborator's work.
    const hook = getCollabCommitHook();
    if (hook) {
      hook.undo();
      return;
    }
    const { history } = get();
    if (history.past.length === 0) return;
    const previous = history.past[history.past.length - 1];
    const newPast = history.past.slice(0, -1);
    set({
      project: previous,
      history: {
        past: newPast,
        present: previous,
        future: [history.present, ...history.future],
      },
    });
  },

  redo: () => {
    if (!isEditorWritable()) return;
    const hook = getCollabCommitHook();
    if (hook) {
      hook.redo();
      return;
    }
    const { history } = get();
    if (history.future.length === 0) return;
    const next = history.future[0];
    const newFuture = history.future.slice(1);
    set({
      project: next,
      history: {
        past: [...history.past, history.present],
        present: next,
        future: newFuture,
      },
    });
  },

  canUndo: () => {
    const hook = getCollabCommitHook();
    if (hook) return hook.canUndo();
    return get().history.past.length > 0;
  },
  canRedo: () => {
    const hook = getCollabCommitHook();
    if (hook) return hook.canRedo();
    return get().history.future.length > 0;
  },
}));
