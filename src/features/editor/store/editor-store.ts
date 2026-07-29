import { create } from "zustand";
import type { Project, Viewport } from "@/types/project";
import type { BaseSection } from "@/types/section";

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
  reorderSection: (pageId: string, sectionId: string, newOrder: number) => void;
  duplicateSection: (sectionId: string) => void;
  deleteSection: (sectionId: string) => void;

  // History
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  // Editing session (avoids per-keystroke history entries)
  beginEditSession: () => void;
  commitEditSession: () => void;
  cancelEditSession: () => void;
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
  const snapshot = cloneProject(state.history.present);
  const updated = cloneProject(state.history.present);
  mutate(updated);
  return {
    project: updated,
    history: {
      past: [...state.history.past, snapshot],
      present: updated,
      future: [],
    },
  };
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
  _editingSession: null,

  // ---- Actions ----

  initProject: (project) => {
    const cloned = cloneProject(project);
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
    set(withHistory(get(), (p) => {
      Object.assign(p, cloneProject(project));
    }));
  },

  selectSection: (id) => set({ selectedSectionId: id }),
  clearSelection: () => set({ selectedSectionId: null }),
  selectPage: (id) => set({ selectedPageId: id }),

  setViewport: (viewport) => set({ viewport }),
  setZoom: (zoom) => set({ zoom }),

  setGenerating: (isGenerating) => set({ isGenerating }),
  setGenerationProgress: (progress) => set({ generationProgress: progress }),

  // ---- Editing session ----

  beginEditSession: () => {
    const { project } = get();
    set({ _editingSession: { snapshot: cloneProject(project) } });
  },

  commitEditSession: () => {
    const { _editingSession, project, history } = get();
    if (!_editingSession) return;
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
    const { _editingSession } = get();
    if (!_editingSession) return;
    // Restore the snapshot
    set({
      _editingSession: null,
      project: _editingSession.snapshot,
    });
  },

  updateSection: (sectionId, updates) => {
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
      set({ project: updated });
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
      set({ project: updated });
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
      set({ project: updated });
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

  reorderSection: (pageId, sectionId, newOrder) => {
    set(
      withHistory(get(), (project) => {
        const page = project.pages.find((p) => p.id === pageId);
        if (!page) return;
        const idx = page.sections.findIndex((s) => s.id === sectionId);
        if (idx === -1) return;
        page.sections[idx].order = newOrder;
        page.sections.sort((a, b) => a.order - b.order);
        project.updatedAt = new Date().toISOString();
      }),
    );
  },

  duplicateSection: (sectionId) => {
    const state = get();
    const page = state.project.pages.find((p) =>
      p.sections.some((s) => s.id === sectionId),
    );
    if (!page) return;

    const source = page.sections.find((s) => s.id === sectionId);
    if (!source) return;

    const clone: BaseSection = ({
      ...JSON.parse(JSON.stringify(source)),
      id: `${source.type}-${Date.now()}`,
      order: source.order + 0.5,
    } as BaseSection);

    set(
      withHistory(state, (project) => {
        const p = project.pages.find((pg) => pg.id === page.id);
        if (!p) return;
        p.sections.push(clone);
        p.sections.sort((a, b) => a.order - b.order);
        // Re-index orders to integers
        p.sections.forEach((s, i) => {
          s.order = i + 1;
        });
        project.updatedAt = new Date().toISOString();
      }),
    );

    // Select the new clone
    set({ selectedSectionId: clone.id });
  },

  deleteSection: (sectionId) => {
    const state = get();
    const page = state.project.pages.find((p) =>
      p.sections.some((s) => s.id === sectionId),
    );
    if (!page) return;
    if (page.sections.length <= 1) return; // prevent deletion of last section

    set(
      withHistory(state, (project) => {
        const p = project.pages.find((pg) => pg.id === page.id);
        if (!p) return;
        p.sections = p.sections.filter((s) => s.id !== sectionId);
        p.sections.forEach((s, i) => {
          s.order = i + 1;
        });
        project.updatedAt = new Date().toISOString();
      }),
    );

    set({ selectedSectionId: null });
  },

  // ---- History ----

  undo: () => {
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

  canUndo: () => get().history.past.length > 0,
  canRedo: () => get().history.future.length > 0,
}));
