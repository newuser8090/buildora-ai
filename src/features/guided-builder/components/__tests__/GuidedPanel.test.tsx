// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// GuidedPanel (score + journey + coach) — rendering tests (Phase N, §28)
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { GuidedPanel } from "../GuidedPanel";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { useGuidedBuilderStore } from "../../store/guided-builder-store";
import { clearGuidedPrefs } from "../../prefs/guided-builder-prefs";
import { registerDefaultSectionLibrary } from "@/features/editor/section-library/registry/register-default-section-library";

beforeAll(() => {
  registerDefaultSectionLibrary();
});

function seedProject() {
  useEditorStore.getState().initProject({
    id: "p1",
    name: "Test",
    theme: {
      palette: {
        background: "#fff", foreground: "#0a0a0a", primary: "#7c5cfc",
        primaryForeground: "#fff", secondary: "#f5f5f5", secondaryForeground: "#0a0a0a",
        muted: "#f5f5f5", mutedForeground: "#737373", accent: "#7c5cfc",
        accentForeground: "#fff", border: "#e5e5e5", card: "#fff", cardForeground: "#0a0a0a",
      },
      typography: { fontFamily: "Geist", headingFont: "Geist", baseSize: "16px", scale: 1.25 },
      spacing: { sectionPadding: "6rem 0", containerMaxWidth: "1120px", gap: "1.5rem" },
      radius: { sm: "0.375rem", md: "0.5rem", lg: "0.75rem", xl: "1rem", full: "9999px" },
      shadows: { sm: "0 1px 2px rgba(0,0,0,0.05)", md: "0 4px 6px rgba(0,0,0,0.07)", lg: "0 10px 15px rgba(0,0,0,0.1)", xl: "0 20px 25px rgba(0,0,0,0.15)" },
    },
    assets: [],
    pages: [
      {
        id: "page-1",
        title: "Home",
        slug: "/",
        sections: [
          { id: "s-hero", type: "hero", order: 1, visible: true, props: { headline: "A clear message", subheadline: "Support", primaryCta: { text: "Go", href: "#" } }, styles: {} },
        ],
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
}

beforeEach(() => {
  clearGuidedPrefs();
  useGuidedBuilderStore.getState().reset();
  seedProject();
});

describe("GuidedPanel", () => {
  it("renders readiness, journey and coach sections", () => {
    render(<GuidedPanel />);
    expect(screen.getByTestId("readiness-score")).toBeTruthy();
    expect(screen.getByTestId("journey-checklist")).toBeTruthy();
    // Hero-only page → recommendations exist → coach panel renders
    expect(screen.getByTestId("coach-panel")).toBeTruthy();
  });

  it("shows the readiness percentage derived from real state", () => {
    render(<GuidedPanel />);
    expect(screen.getByText(/^[0-9]{1,3}%$/)).toBeTruthy();
  });

  it("marks the main-message journey step complete when a headline exists", () => {
    render(<GuidedPanel />);
    const step = screen.getByTestId("journey-step-main-message");
    expect(step.textContent).toContain("Choose your main message");
    expect(step.getAttribute("aria-label")).toContain("done");
  });

  it("collapses the journey checklist", () => {
    render(<GuidedPanel />);
    fireEvent.click(screen.getByRole("button", { name: /progress/i }));
    // Collapsed state persists to prefs
    expect(useGuidedBuilderStore.getState().journeyCollapsed).toBe(true);
  });

  it("coach suggestions require an explicit action (no auto mutation)", () => {
    const before = JSON.stringify(useEditorStore.getState().project);
    render(<GuidedPanel />);
    // Render alone must not mutate anything.
    expect(JSON.stringify(useEditorStore.getState().project)).toBe(before);
  });
});
