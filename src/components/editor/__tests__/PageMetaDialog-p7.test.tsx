// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// PageMetaDialog — Phase P7 beginner fields + canonical validation
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { PageMetaDialog } from "../PageMetaDialog";
import type { Project } from "@/types/project";

function makeProject(overrides?: Partial<Project>): Project {
  return {
    id: "test-proj",
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
});

function renderDialog(pageId = "page-1") {
  const page = useEditorStore.getState().project.pages.find((p) => p.id === pageId)!;
  return render(<PageMetaDialog page={page} onClose={() => {}} />);
}

describe("PageMetaDialog — Phase P7 fields", () => {
  it("prefills the new beginner fields from existing meta", () => {
    useEditorStore.getState().updatePageMeta("page-1", {
      title: "Home",
      seoTitle: "Google Title",
      seoDescription: "Google desc",
      socialTitle: "Share Title",
      socialDescription: "Share desc",
    });
    renderDialog();
    expect((screen.getByTestId("page-meta-title") as HTMLInputElement).value).toBe("Google Title");
    expect((screen.getByTestId("page-meta-description") as HTMLTextAreaElement).value).toBe("Google desc");
    expect((screen.getByTestId("page-meta-social-title") as HTMLInputElement).value).toBe("Share Title");
    expect((screen.getByTestId("page-meta-social-description") as HTMLTextAreaElement).value).toBe("Share desc");
  });

  it("saves Google title/description and social fields", () => {
    renderDialog();
    fireEvent.change(screen.getByTestId("page-meta-title"), { target: { value: "Google Title" } });
    fireEvent.change(screen.getByTestId("page-meta-description"), { target: { value: "Google desc" } });
    fireEvent.change(screen.getByTestId("page-meta-social-title"), { target: { value: "Share Title" } });
    fireEvent.click(screen.getByTestId("page-meta-save"));
    const meta = useEditorStore.getState().project.pages[0].meta;
    expect(meta).toMatchObject({
      seoTitle: "Google Title",
      seoDescription: "Google desc",
      socialTitle: "Share Title",
    });
  });

  it("hides a page from search engines with the beginner toggle", () => {
    renderDialog();
    fireEvent.click(screen.getByTestId("page-meta-index-no"));
    expect(screen.getByText(/hidden from search engines/i)).toBeTruthy();
    fireEvent.click(screen.getByTestId("page-meta-save"));
    expect(useEditorStore.getState().project.pages[0].meta?.index).toBe(false);
  });

  it("shows the advanced canonical field and rejects unsafe URLs", () => {
    renderDialog();
    fireEvent.click(screen.getByText(/advanced settings/i));
    const canonical = screen.getByTestId("page-meta-canonical") as HTMLInputElement;
    fireEvent.change(canonical, { target: { value: "example.com/not-a-url" } });
    expect(screen.getByText(/needs to start with https:\/\/ or http:\/\//i)).toBeTruthy();
  });

  it("accepts a valid canonical URL without an error", () => {
    renderDialog();
    fireEvent.click(screen.getByText(/advanced settings/i));
    const canonical = screen.getByTestId("page-meta-canonical") as HTMLInputElement;
    fireEvent.change(canonical, { target: { value: "https://example.com/" } });
    expect(screen.queryByText(/needs to start with https/i)).toBeNull();
  });
});
