// ---------------------------------------------------------------------------
// Guided Builder — transient store (Phase N, spec §19)
//
// Session-only state lives here and is never persisted. Persistent user UI
// preferences (experience mode, onboarding, coaching, dismissed tips) live in
// the localStorage-backed prefs module and are mirrored into this store on
// init and on change.
//
// Requirements honored:
//   - changing mode creates no project history and does not mark the project
//     dirty (this store never touches the editor store's history/dirty state)
//   - dismissed suggestions are session-only (reset on reload)
//   - guidance never mutates the project
// ---------------------------------------------------------------------------

import { create } from "zustand";
import type {
  EditorExperienceMode,
  OnboardingSelections,
} from "../types";
import {
  hasGuidedPrefs,
  loadGuidedPrefs,
  saveGuidedPrefs,
  type GuidedPrefs,
} from "../prefs/guided-builder-prefs";
import type { SectionInsertPosition } from "@/features/editor/store/section-structure";

export interface GuidedBuilderState {
  /** True once persisted prefs have been re-read in the browser (post-mount).
   *  Mode-dependent UI gates on this to avoid SSR hydration mismatches. */
  hydrated: boolean;
  /** True when a stored preference blob exists (a returning user). The
   *  "Try Guided Mode" banner is only shown to returning users (spec §20). */
  hasStoredPrefs: boolean;

  // ---- Mirrored persistent prefs ----
  experienceMode: EditorExperienceMode;
  onboardingCompleted: boolean;
  onboardingSelections: OnboardingSelections | null;
  coachEnabled: boolean;
  dismissedTipIds: string[];
  journeyCollapsed: boolean;
  tryGuidedBannerDismissed: boolean;

  // ---- Session-only state ----
  onboardingOpen: boolean;
  dismissedSuggestionIds: string[];
  blockBrowserOpen: boolean;
  blockBrowserInitialType?: string;
  /** Insertion position preselected for the next block-browser open. */
  pendingInsertionPosition: SectionInsertPosition | null;
  commandPaletteOpen: boolean;
  hasPreviewedMobile: boolean;
  hasExported: boolean;
  /** Phase P7 — session flag: opened the visitor preview. */
  hasPreviewedSite: boolean;
  /** Phase P7 — session flag: opened the Launch Center / published. */
  hasPublished: boolean;
  /** Bumped each time the AI composer should be focused. */
  aiComposerRequestToken: number;
  /** Session token for the coach card currently expanded (0 = none). */
  activeCoachId: string | null;

  // ---- Actions ----
  init: () => void;
  setExperienceMode: (mode: EditorExperienceMode) => void;
  setOnboardingCompleted: (selections: OnboardingSelections) => void;
  markOnboardingSkipped: () => void;
  setOnboardingOpen: (open: boolean) => void;
  setCoachEnabled: (enabled: boolean) => void;
  dismissSuggestion: (id: string) => void;
  dismissTip: (id: string) => void;
  setJourneyCollapsed: (collapsed: boolean) => void;
  dismissTryGuidedBanner: () => void;
  openBlockBrowser: (options?: {
    initialType?: string;
    position?: SectionInsertPosition;
  }) => void;
  closeBlockBrowser: () => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setHasPreviewedMobile: (value: boolean) => void;
  setHasExported: (value: boolean) => void;
  setHasPreviewedSite: (value: boolean) => void;
  setHasPublished: (value: boolean) => void;
  requestAiComposerFocus: () => void;
  setActiveCoachId: (id: string | null) => void;
  /** Test/reset helper — restores defaults and reloads persisted prefs. */
  reset: () => void;
}

function prefsToState(prefs: GuidedPrefs) {
  return {
    experienceMode: prefs.experienceMode,
    onboardingCompleted: prefs.onboardingCompleted,
    onboardingSelections: prefs.onboardingSelections,
    coachEnabled: prefs.coachEnabled,
    dismissedTipIds: prefs.dismissedTipIds,
    journeyCollapsed: prefs.journeyCollapsed,
    tryGuidedBannerDismissed: prefs.tryGuidedBannerDismissed,
  };
}

export const useGuidedBuilderStore = create<GuidedBuilderState>()((set) => ({
  ...prefsToState(loadGuidedPrefs()),
  hydrated: false,
  hasStoredPrefs: false,

  onboardingOpen: false,
  dismissedSuggestionIds: [],
  blockBrowserOpen: false,
  blockBrowserInitialType: undefined,
  pendingInsertionPosition: null,
  commandPaletteOpen: false,
  hasPreviewedMobile: false,
  hasExported: false,
  hasPreviewedSite: false,
  hasPublished: false,
  aiComposerRequestToken: 0,
  activeCoachId: null,

  init: () => {
    set({
      ...prefsToState(loadGuidedPrefs()),
      hydrated: true,
      hasStoredPrefs: hasGuidedPrefs(),
    });
  },

  setExperienceMode: (mode) => {
    const prefs = { ...loadGuidedPrefs(), experienceMode: mode };
    saveGuidedPrefs(prefs);
    set({ experienceMode: mode });
  },

  setOnboardingCompleted: (selections) => {
    const mode: EditorExperienceMode =
      selections.comfort === "new"
        ? "guided"
        : selections.comfort === "expert"
          ? "advanced"
          : "standard";
    const prefs: GuidedPrefs = {
      ...loadGuidedPrefs(),
      experienceMode: mode,
      onboardingCompleted: true,
      onboardingSelections: selections,
    };
    saveGuidedPrefs(prefs);
    set({
      experienceMode: mode,
      onboardingCompleted: true,
      onboardingSelections: selections,
      onboardingOpen: false,
    });
  },

  markOnboardingSkipped: () => {
    const prefs: GuidedPrefs = {
      ...loadGuidedPrefs(),
      onboardingCompleted: true,
    };
    saveGuidedPrefs(prefs);
    set({ onboardingCompleted: true, onboardingOpen: false });
  },

  setOnboardingOpen: (open) => set({ onboardingOpen: open }),

  setCoachEnabled: (enabled) => {
    const prefs = { ...loadGuidedPrefs(), coachEnabled: enabled };
    saveGuidedPrefs(prefs);
    set({ coachEnabled: enabled });
  },

  dismissSuggestion: (id) =>
    set((state) => ({
      dismissedSuggestionIds: state.dismissedSuggestionIds.includes(id)
        ? state.dismissedSuggestionIds
        : [...state.dismissedSuggestionIds, id],
    })),

  dismissTip: (id) => {
    const prefs = {
      ...loadGuidedPrefs(),
      dismissedTipIds: loadGuidedPrefs().dismissedTipIds.includes(id)
        ? loadGuidedPrefs().dismissedTipIds
        : [...loadGuidedPrefs().dismissedTipIds, id],
    };
    saveGuidedPrefs(prefs);
    set({ dismissedTipIds: prefs.dismissedTipIds });
  },

  setJourneyCollapsed: (collapsed) => {
    const prefs = { ...loadGuidedPrefs(), journeyCollapsed: collapsed };
    saveGuidedPrefs(prefs);
    set({ journeyCollapsed: collapsed });
  },

  dismissTryGuidedBanner: () => {
    const prefs = { ...loadGuidedPrefs(), tryGuidedBannerDismissed: true };
    saveGuidedPrefs(prefs);
    set({ tryGuidedBannerDismissed: true });
  },

  openBlockBrowser: (options) =>
    set({
      blockBrowserOpen: true,
      blockBrowserInitialType: options?.initialType,
      pendingInsertionPosition: options?.position ?? null,
    }),

  closeBlockBrowser: () =>
    set({
      blockBrowserOpen: false,
      blockBrowserInitialType: undefined,
      pendingInsertionPosition: null,
    }),

  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),

  setHasPreviewedMobile: (value) => set({ hasPreviewedMobile: value }),

  setHasExported: (value) => set({ hasExported: value }),

  setHasPreviewedSite: (value) => set({ hasPreviewedSite: value }),

  setHasPublished: (value) => set({ hasPublished: value }),

  requestAiComposerFocus: () =>
    set((state) => ({ aiComposerRequestToken: state.aiComposerRequestToken + 1 })),

  setActiveCoachId: (id) => set({ activeCoachId: id }),

  reset: () => {
    const prefs = loadGuidedPrefs();
    set({
      ...prefsToState(prefs),
      hydrated: true,
      hasStoredPrefs: hasGuidedPrefs(),
      onboardingOpen: false,
      dismissedSuggestionIds: [],
      blockBrowserOpen: false,
      blockBrowserInitialType: undefined,
      pendingInsertionPosition: null,
      commandPaletteOpen: false,
      hasPreviewedMobile: false,
      hasExported: false,
      hasPreviewedSite: false,
      hasPublished: false,
      aiComposerRequestToken: 0,
      activeCoachId: null,
    });
  },
}));
