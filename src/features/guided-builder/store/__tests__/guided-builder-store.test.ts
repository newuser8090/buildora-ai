// ---------------------------------------------------------------------------
// Guided builder store — tests (Phase N, spec §19)
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { useGuidedBuilderStore } from "../guided-builder-store";
import {
  clearGuidedPrefs,
  saveGuidedPrefs,
  DEFAULT_GUIDED_PREFS,
} from "../../prefs/guided-builder-prefs";

beforeEach(() => {
  clearGuidedPrefs();
  useGuidedBuilderStore.getState().reset();
});

describe("guided builder store", () => {
  it("defaults to standard mode for existing users", () => {
    const state = useGuidedBuilderStore.getState();
    expect(state.experienceMode).toBe("standard");
    expect(state.dismissedSuggestionIds).toEqual([]);
  });

  it("init() hydrates from persisted prefs", () => {
    saveGuidedPrefs({
      ...DEFAULT_GUIDED_PREFS,
      experienceMode: "guided",
      dismissedTipIds: ["tip-faq"],
    });
    useGuidedBuilderStore.getState().init();
    const state = useGuidedBuilderStore.getState();
    expect(state.hydrated).toBe(true);
    expect(state.experienceMode).toBe("guided");
    expect(state.dismissedTipIds).toEqual(["tip-faq"]);
  });

  it("setExperienceMode persists and never touches editor history/dirty", () => {
    useGuidedBuilderStore.getState().setExperienceMode("guided");
    expect(useGuidedBuilderStore.getState().experienceMode).toBe("guided");
    // The guided store has no project/history/dirty — verified by shape.
    const keys = Object.keys(useGuidedBuilderStore.getState());
    expect(keys.some((k) => k === "isDirty")).toBe(false);
    expect(keys.some((k) => k === "history")).toBe(false);
  });

  it("maps comfort level to an experience mode on onboarding completion", () => {
    useGuidedBuilderStore.getState().setOnboardingCompleted({
      category: "business",
      begin: "guided",
      comfort: "new",
    });
    expect(useGuidedBuilderStore.getState().experienceMode).toBe("guided");
    expect(useGuidedBuilderStore.getState().onboardingCompleted).toBe(true);

    useGuidedBuilderStore.getState().setOnboardingCompleted({
      category: "portfolio",
      begin: "blank",
      comfort: "experienced",
    });
    expect(useGuidedBuilderStore.getState().experienceMode).toBe("standard");

    useGuidedBuilderStore.getState().setOnboardingCompleted({
      category: "portfolio",
      begin: "blank",
      comfort: "expert",
    });
    expect(useGuidedBuilderStore.getState().experienceMode).toBe("advanced");
  });

  it("markOnboardingSkipped completes onboarding without a mode change", () => {
    useGuidedBuilderStore.getState().markOnboardingSkipped();
    expect(useGuidedBuilderStore.getState().onboardingCompleted).toBe(true);
    expect(useGuidedBuilderStore.getState().experienceMode).toBe("standard");
  });

  it("tracks dismissed suggestions per session only", () => {
    useGuidedBuilderStore.getState().dismissSuggestion("rec-add-hero");
    expect(useGuidedBuilderStore.getState().dismissedSuggestionIds).toEqual([
      "rec-add-hero",
    ]);
    useGuidedBuilderStore.getState().dismissSuggestion("rec-add-hero");
    expect(useGuidedBuilderStore.getState().dismissedSuggestionIds).toEqual([
      "rec-add-hero",
    ]);
    useGuidedBuilderStore.getState().reset();
    expect(useGuidedBuilderStore.getState().dismissedSuggestionIds).toEqual([]);
  });

  it("records session preview/export flags", () => {
    useGuidedBuilderStore.getState().setHasPreviewedMobile(true);
    useGuidedBuilderStore.getState().setHasExported(true);
    expect(useGuidedBuilderStore.getState().hasPreviewedMobile).toBe(true);
    expect(useGuidedBuilderStore.getState().hasExported).toBe(true);
  });

  it("exposes the block browser session state", () => {
    useGuidedBuilderStore
      .getState()
      .openBlockBrowser({ initialType: "hero" });
    expect(useGuidedBuilderStore.getState().blockBrowserOpen).toBe(true);
    useGuidedBuilderStore.getState().closeBlockBrowser();
    expect(useGuidedBuilderStore.getState().blockBrowserOpen).toBe(false);
    expect(useGuidedBuilderStore.getState().blockBrowserInitialType).toBeUndefined();
  });
});
