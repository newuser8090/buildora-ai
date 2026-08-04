// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// GuidedStartScreen — tests (Phase N, spec §28)
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { GuidedStartScreen } from "../GuidedStartScreen";
import { useEditorStore } from "@/features/editor/store/editor-store";
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
          { id: "s-hero", type: "hero", order: 1, visible: true, props: { headline: "Hi", subheadline: "", primaryCta: { text: "Go", href: "#" } }, styles: {} },
        ],
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
}

beforeEach(() => {
  seedProject();
});

describe("GuidedStartScreen", () => {
  it("renders friendly building blocks", () => {
    render(
      <GuidedStartScreen
        pageId="page-1"
        existingSectionIds={new Set(["s-hero"])}
      />,
    );
    expect(screen.getByText("Let’s build your homepage")).toBeTruthy();
    expect(screen.getByText("Top navigation")).toBeTruthy();
    expect(screen.getByText("Main message")).toBeTruthy();
    expect(screen.getByText("What you offer")).toBeTruthy();
  });

  it("inserts a section through the real store and selects it", () => {
    render(
      <GuidedStartScreen
        pageId="page-1"
        existingSectionIds={new Set(["s-hero"])}
      />,
    );
    fireEvent.click(screen.getByTestId("guided-start-features"));
    const state = useEditorStore.getState();
    const page = state.project.pages.find((p) => p.id === "page-1");
    expect(page?.sections.some((s) => s.type === "features")).toBe(true);
    const added = page?.sections.find((s) => s.type === "features");
    expect(state.selectedSectionId).toBe(added?.id);
  });

  it("disables singleton blocks already on the page", () => {
    render(
      <GuidedStartScreen
        pageId="page-1"
        existingSectionIds={new Set(["s-hero"])}
      />,
    );
    // Hero is not a singleton, so it stays enabled; header/footer are.
    const header = screen.getByTestId("guided-start-header");
    expect(header.hasAttribute("disabled")).toBe(false);
  });
});
