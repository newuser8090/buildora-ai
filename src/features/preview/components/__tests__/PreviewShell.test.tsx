// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// PreviewShell — visitor preview shell (Phase P7)
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { usePreviewStore } from "../../store/preview-store";
import { PreviewShell } from "../PreviewShell";
import type { Project } from "@/types/project";

function makeProject(overrides?: Partial<Project>): Project {
  return {
    id: "proj-1",
    name: "Test",
    theme: {
      palette: {
        background: "#ffffff", foreground: "#0a0a0a", primary: "#7c5cfc",
        primaryForeground: "#ffffff", secondary: "#f5f5f5", secondaryForeground: "#0a0a0a",
        muted: "#f5f5f5", mutedForeground: "#737373", accent: "#7c5cfc",
        accentForeground: "#ffffff", border: "#e5e5e5", card: "#ffffff", cardForeground: "#0a0a0a",
      },
      typography: { fontFamily: "Geist", headingFont: "Geist", baseSize: "16px", scale: 1.25 },
      spacing: { sectionPadding: "6rem 0", containerMaxWidth: "1120px", gap: "1.5rem" },
      radius: { sm: "0.375rem", md: "0.5rem", lg: "0.75rem", xl: "1rem", full: "9999px" },
      shadows: { sm: "0 1px 2px rgba(0,0,0,0.05)", md: "0 4px 6px rgba(0,0,0,0.07)", lg: "0 10px 15px rgba(0,0,0,0.1)", xl: "0 20px 25px rgba(0,0,0,0.15)" },
    },
    assets: [],
    pages: [
      {
        id: "p1", title: "Home", slug: "/",
        sections: [
          { id: "s1", type: "hero", order: 1, visible: true, props: { headline: "Hello" }, styles: {} },
        ],
      },
      {
        id: "p2", title: "About", slug: "/about",
        sections: [
          { id: "s2", type: "hero", order: 1, visible: true, props: { headline: "About us" }, styles: {} },
        ],
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  useEditorStore.getState().initProject(makeProject());
  usePreviewStore.getState().closePreview();
});

describe("PreviewShell", () => {
  it("renders nothing when closed", () => {
    const { container } = render(<PreviewShell />);
    expect(container.firstChild).toBeNull();
  });

  it("opens into a full-screen shell without editor chrome", () => {
    usePreviewStore.getState().openPreview("/");
    render(<PreviewShell />);
    expect(screen.getByTestId("preview-shell")).toBeTruthy();
    expect(screen.getByTestId("visitor-preview-content")).toBeTruthy();
    // No selection/edit affordances in visitor mode.
    expect(screen.queryByTestId("preview-exit")).toBeTruthy(); // toolbar still present
  });

  it("switches device presets (phone) and tracks the selection", () => {
    usePreviewStore.getState().openPreview("/");
    render(<PreviewShell />);
    fireEvent.click(screen.getByTitle("Phone"));
    expect(usePreviewStore.getState().device).toBe("phone");
    expect(screen.getByTitle("Phone").getAttribute("aria-pressed")).toBe("true");
  });

  it("switches pages from the page switcher", () => {
    usePreviewStore.getState().openPreview("/");
    render(<PreviewShell />);
    fireEvent.change(screen.getByTestId("preview-page-switcher"), {
      target: { value: "/about" },
    });
    expect(usePreviewStore.getState().route).toBe("/about");
    expect(screen.getByTestId("preview-route").textContent).toBe("/about");
  });

  it("exits via the exit button and via Escape", () => {
    usePreviewStore.getState().openPreview("/");
    render(<PreviewShell />);
    fireEvent.click(screen.getByTestId("preview-exit"));
    expect(usePreviewStore.getState().open).toBe(false);
  });

  it("exits with the Escape key", () => {
    usePreviewStore.getState().openPreview("/");
    render(<PreviewShell />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(usePreviewStore.getState().open).toBe(false);
  });

  it("does not render the preview when the project has no pages", () => {
    useEditorStore.getState().initProject(makeProject({ pages: [] }));
    usePreviewStore.getState().openPreview("/");
    const { container } = render(<PreviewShell />);
    expect(container.firstChild).toBeNull();
  });
});
