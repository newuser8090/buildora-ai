// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// SiteSettingsDialog — beginner site settings dialog (Phase P7)
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { useSiteSettingsUiStore } from "../../store/site-settings-ui-store";
import { SiteSettingsDialog } from "../SiteSettingsDialog";
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
        id: "page-1", title: "Home", slug: "/",
        sections: [
          { id: "hero-1", type: "hero", order: 1, visible: true, props: {}, styles: {} },
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
  useSiteSettingsUiStore.getState().closeDialog();
});

function renderDialog() {
  return render(<SiteSettingsDialog />);
}

describe("SiteSettingsDialog", () => {
  it("renders nothing when closed", () => {
    const { container } = renderDialog();
    expect(container.firstChild).toBeNull();
  });

  it("renders with all four beginner tabs when opened", () => {
    useSiteSettingsUiStore.getState().openDialog();
    renderDialog();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Basics")).toBeTruthy();
    expect(screen.getByText("Search & sharing")).toBeTruthy();
    expect(screen.getByText("Site icon")).toBeTruthy();
    expect(screen.getByText("Advanced")).toBeTruthy();
  });

  it("seeds the draft from the project name when no settings exist", () => {
    useSiteSettingsUiStore.getState().openDialog();
    renderDialog();
    const name = screen.getByTestId("site-settings-name") as HTMLInputElement;
    expect(name.value).toBe("Test");
  });

  it("saves edits through the editor store with one history entry", () => {
    useSiteSettingsUiStore.getState().openDialog();
    renderDialog();
    fireEvent.change(screen.getByTestId("site-settings-name"), {
      target: { value: "My Brand" },
    });
    fireEvent.change(screen.getByTestId("site-settings-description"), {
      target: { value: "A short pitch." },
    });
    fireEvent.click(screen.getByTestId("site-settings-save"));

    const settings = useEditorStore.getState().project.siteSettings;
    expect(settings).toEqual({
      siteName: "My Brand",
      siteDescription: "A short pitch.",
    });
    expect(useEditorStore.getState().history.past).toHaveLength(1);
    expect(useSiteSettingsUiStore.getState().dialogOpen).toBe(false);
  });

  it("switches to the Search & sharing tab and shows a Google preview", () => {
    useSiteSettingsUiStore.getState().openDialog("search");
    renderDialog();
    fireEvent.change(screen.getByTestId("site-settings-seo-title"), {
      target: { value: "Google Title" },
    });
    fireEvent.change(screen.getByTestId("site-settings-seo-description"), {
      target: { value: "Google description" },
    });
    expect(screen.getByTestId("seo-google-preview")).toBeTruthy();
    expect(screen.getAllByText("Google Title").length).toBeGreaterThan(0);
  });

  it("shows the social preview with the configured share title", () => {
    useSiteSettingsUiStore.getState().openDialog("search");
    renderDialog();
    fireEvent.change(screen.getByTestId("site-settings-social-title"), {
      target: { value: "Share Title" },
    });
    expect(screen.getByTestId("seo-social-preview")).toBeTruthy();
    expect(screen.getByText("Share Title")).toBeTruthy();
  });

  it("shows advanced settings including canonical validation", () => {
    useSiteSettingsUiStore.getState().openDialog("advanced");
    renderDialog();
    const canonical = screen.getByTestId("site-settings-canonical") as HTMLInputElement;
    expect(canonical).toBeTruthy();
    fireEvent.change(canonical, { target: { value: "example.com" } });
    expect(screen.getByText(/needs to start with https/)).toBeTruthy();
  });

  it("cancelling discards draft edits", () => {
    useSiteSettingsUiStore.getState().openDialog();
    renderDialog();
    fireEvent.change(screen.getByTestId("site-settings-name"), {
      target: { value: "Discarded" },
    });
    fireEvent.click(screen.getByText("Cancel"));
    expect(useEditorStore.getState().project.siteSettings).toBeUndefined();
  });
});
