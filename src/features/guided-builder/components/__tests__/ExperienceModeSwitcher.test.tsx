// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// ExperienceModeSwitcher — tests (Phase N, spec §28)
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ExperienceModeSwitcher } from "../ExperienceModeSwitcher";
import { useGuidedBuilderStore } from "../../store/guided-builder-store";
import { clearGuidedPrefs } from "../../prefs/guided-builder-prefs";

beforeEach(() => {
  clearGuidedPrefs();
  useGuidedBuilderStore.getState().reset();
});

describe("ExperienceModeSwitcher", () => {
  it("shows the current mode", () => {
    useGuidedBuilderStore.getState().setExperienceMode("guided");
    render(<ExperienceModeSwitcher />);
    expect(screen.getByTestId("experience-mode-current").textContent).toBe("Guided");
  });

  it("switches to guided and persists the preference", () => {
    render(<ExperienceModeSwitcher />);
    fireEvent.click(screen.getByTestId("experience-mode-switcher"));
    fireEvent.click(screen.getByTestId("experience-mode-guided"));
    expect(useGuidedBuilderStore.getState().experienceMode).toBe("guided");
  });

  it("switches to advanced", () => {
    render(<ExperienceModeSwitcher />);
    fireEvent.click(screen.getByTestId("experience-mode-switcher"));
    fireEvent.click(screen.getByTestId("experience-mode-advanced"));
    expect(useGuidedBuilderStore.getState().experienceMode).toBe("advanced");
  });

  it("closes the menu on Escape", () => {
    render(<ExperienceModeSwitcher />);
    fireEvent.click(screen.getByTestId("experience-mode-switcher"));
    expect(screen.getByTestId("experience-mode-menu")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("experience-mode-menu")).toBeNull();
  });
});
