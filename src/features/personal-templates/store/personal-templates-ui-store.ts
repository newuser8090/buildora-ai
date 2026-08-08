// ---------------------------------------------------------------------------
// Personal Templates (Phase P9) — UI store
//
// Owns dialog open state for the Save-as-Template dialog and the personal
// templates library panel. No data logic — persistence goes through
// PersonalTemplateService.
// ---------------------------------------------------------------------------

import { create } from "zustand";
import type { Project } from "@/types/project";

interface PersonalTemplatesUiState {
  /** Personal Templates library panel. */
  libraryOpen: boolean;
  /** Save-as-Template dialog with the project snapshot to save. */
  saveDialog: { open: boolean; project: Project | null };

  openLibrary: () => void;
  closeLibrary: () => void;
  openSaveDialog: (project: Project) => void;
  closeSaveDialog: () => void;
}

export const usePersonalTemplatesUiStore = create<PersonalTemplatesUiState>(
  (set) => ({
    libraryOpen: false,
    saveDialog: { open: false, project: null },

    openLibrary: () => set({ libraryOpen: true }),
    closeLibrary: () => set({ libraryOpen: false }),
    openSaveDialog: (project) =>
      set({ saveDialog: { open: true, project } }),
    closeSaveDialog: () =>
      set({ saveDialog: { open: false, project: null } }),
  }),
);
