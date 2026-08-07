// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// PageMetaDialog — component tests
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { PageMetaDialog } from "../PageMetaDialog";
import type { Project } from "@/types/project";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
        id: "page-1",
        title: "Home",
        slug: "/",
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
  const page = useEditorStore
    .getState()
    .project.pages.find((p) => p.id === pageId)!;
  return render(<PageMetaDialog page={page} onClose={() => {}} />);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe("PageMetaDialog rendering", () => {
  it("renders nothing when no page is provided", () => {
    const { container } = render(
      <PageMetaDialog page={null} onClose={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows the page name and prefilled values", () => {
    useEditorStore
      .getState()
      .updatePageMeta("page-1", { title: "SEO Home", description: "A description" });
    renderDialog();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText(/Home/)).toBeTruthy();
    const title = screen.getByTestId("page-meta-title") as HTMLInputElement;
    const description = screen.getByTestId(
      "page-meta-description",
    ) as HTMLTextAreaElement;
    expect(title.value).toBe("SEO Home");
    expect(description.value).toBe("A description");
  });
});

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------

describe("PageMetaDialog saving", () => {
  it("saves metadata to the store", () => {
    let closed = false;
    const page = useEditorStore.getState().project.pages[0];
    render(
      <PageMetaDialog page={page} onClose={() => { closed = true; }} />,
    );
    fireEvent.change(screen.getByTestId("page-meta-title"), {
      target: { value: "New SEO Title" },
    });
    fireEvent.change(screen.getByTestId("page-meta-description"), {
      target: { value: "New description" },
    });
    fireEvent.click(screen.getByTestId("page-meta-save"));

    const stored = useEditorStore.getState().project.pages[0].meta;
    // Phase P7: the Google title/description map to both the legacy title and
    // the dedicated search fields.
    expect(stored).toEqual({
      title: "New SEO Title",
      description: "New description",
      seoTitle: "New SEO Title",
      seoDescription: "New description",
    });
    expect(closed).toBe(true);
  });

  it("drops empty fields on save", () => {
    const page = useEditorStore.getState().project.pages[0];
    render(<PageMetaDialog page={page} onClose={() => {}} />);
    fireEvent.change(screen.getByTestId("page-meta-title"), {
      target: { value: "Only Title" },
    });
    fireEvent.click(screen.getByTestId("page-meta-save"));
    expect(useEditorStore.getState().project.pages[0].meta).toEqual({
      title: "Only Title",
      seoTitle: "Only Title",
    });
  });

  it("closes without saving on Cancel", () => {
    let closed = false;
    const page = useEditorStore.getState().project.pages[0];
    render(
      <PageMetaDialog page={page} onClose={() => { closed = true; }} />,
    );
    fireEvent.change(screen.getByTestId("page-meta-title"), {
      target: { value: "Should not persist" },
    });
    fireEvent.click(screen.getByTestId("page-meta-cancel"));
    expect(useEditorStore.getState().project.pages[0].meta).toBeUndefined();
    expect(closed).toBe(true);
  });
});
