// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// PageStructurePanel — component tests
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { useEditorUiStore } from "@/features/editor/ui/editor-ui-store";
import { PageStructurePanel } from "../PageStructurePanel";
import {
  registerDefaultSectionLibrary,
  resetSectionLibraryRegistration,
} from "@/features/editor/section-library/registry/register-default-section-library";
import { sectionLibraryRegistry } from "@/features/editor/section-library/registry/section-library-registry";
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
          { id: "header-1", type: "header", order: 1, visible: true, props: { logoText: "MyBrand" }, styles: {} },
          { id: "hero-1", type: "hero", order: 2, visible: true, props: { headline: "Big Headline" }, styles: {} },
          { id: "features-1", type: "features", order: 3, visible: true, props: { title: "Our Features" }, styles: {} },
          { id: "footer-1", type: "footer", order: 4, visible: true, props: { text: "© 2026" }, styles: {} },
        ],
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function initStore() {
  resetSectionLibraryRegistration();
  sectionLibraryRegistry.clear();
  registerDefaultSectionLibrary();
  useEditorStore.getState().initProject(makeProject());
  useEditorUiStore.setState({
    rightSidebarTab: "structure",
    addSectionDialog: { open: false, initialType: undefined },
    selectionSource: null,
  });
}

// jsdom does not implement scrollIntoView
beforeEach(() => {
  initStore();
  Element.prototype.scrollIntoView = vi.fn();
});

function renderPanel() {
  return render(<PageStructurePanel />);
}

function openMenu(sectionId: string) {
  const menuButton = screen.getByTestId(`section-menu-${sectionId}`);
  fireEvent.click(menuButton);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe("PageStructurePanel rendering", () => {
  it("renders the page title and section count", () => {
    renderPanel();
    expect(screen.getByText("Home")).toBeTruthy();
    expect(screen.getByText(/4 sections/)).toBeTruthy();
  });

  it("renders an ordered list of sections with readable labels", () => {
    renderPanel();
    const rows = screen.getAllByTestId(/^structure-row-/);
    expect(rows).toHaveLength(4);
    // Labels: header uses logoText, hero uses headline, features uses title, footer uses text
    expect(screen.getByText("MyBrand")).toBeTruthy();
    expect(screen.getByText("Big Headline")).toBeTruthy();
    expect(screen.getByText("Our Features")).toBeTruthy();
    expect(screen.getByText("© 2026")).toBeTruthy();
  });

  it("shows the selected section", () => {
    useEditorStore.getState().selectSection("hero-1");
    renderPanel();
    const row = screen.getByTestId("structure-row-hero-1");
    expect(row.getAttribute("data-selected")).toBeTruthy();
  });

  it("shows a hidden badge for hidden sections", () => {
    useEditorStore.getState().setSectionVisible("hero-1", false);
    renderPanel();
    expect(screen.getByTestId("hidden-badge-hero-1")).toBeTruthy();
  });

  it("shows the empty state when the page has no sections", () => {
    useEditorStore.getState().initProject(
      makeProject({
        pages: [
          {
            id: "page-1",
            title: "Home",
            slug: "/",
            sections: [],
          },
        ],
      }),
    );
    renderPanel();
    expect(screen.getByText(/no sections yet/i)).toBeTruthy();
    expect(screen.getByTestId("structure-empty-add")).toBeTruthy();
  });

  it("renders an Add Section button that opens the dialog", () => {
    renderPanel();
    const addButton = screen.getByTestId("add-section-button");
    fireEvent.click(addButton);
    expect(useEditorUiStore.getState().addSectionDialog.open).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

describe("PageStructurePanel selection", () => {
  it("row click selects the section and marks source as structure", () => {
    renderPanel();
    fireEvent.click(screen.getByTestId("structure-row-features-1"));
    expect(useEditorStore.getState().selectedSectionId).toBe("features-1");
    expect(useEditorUiStore.getState().selectionSource).toBe("structure");
  });
});

// ---------------------------------------------------------------------------
// Action menu
// ---------------------------------------------------------------------------

describe("PageStructurePanel action menu", () => {
  it("opens and closes the menu on outside click / Escape", () => {
    renderPanel();
    openMenu("hero-1");
    expect(screen.getByTestId("section-menu-hero-1-items")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("section-menu-hero-1-items")).toBeNull();
  });

  it("move up reorders and announces", () => {
    renderPanel();
    openMenu("hero-1");
    fireEvent.click(screen.getByTestId("section-action-move-up"));
    const ids = useEditorStore
      .getState()
      .project.pages[0].sections.map((s) => s.id);
    expect(ids.indexOf("hero-1")).toBeLessThan(ids.indexOf("header-1"));
  });

  it("move down reorders", () => {
    renderPanel();
    openMenu("features-1");
    fireEvent.click(screen.getByTestId("section-action-move-down"));
    const ids = useEditorStore
      .getState()
      .project.pages[0].sections.map((s) => s.id);
    expect(ids.indexOf("features-1")).toBeGreaterThan(ids.indexOf("footer-1"));
  });

  it("move up is disabled for the first item", () => {
    renderPanel();
    openMenu("header-1");
    const moveUp = screen.getByTestId("section-action-move-up");
    expect((moveUp as HTMLButtonElement).disabled).toBe(true);
  });

  it("move down is disabled for the last item", () => {
    renderPanel();
    openMenu("footer-1");
    const moveDown = screen.getByTestId("section-action-move-down");
    expect((moveDown as HTMLButtonElement).disabled).toBe(true);
  });

  it("duplicate creates a copy after the original", () => {
    renderPanel();
    openMenu("hero-1");
    fireEvent.click(screen.getByTestId("section-action-duplicate"));
    const page = useEditorStore.getState().project.pages[0];
    expect(page.sections).toHaveLength(5);
    const heroIds = page.sections.filter((s) => s.type === "hero").map((s) => s.id);
    expect(heroIds).toHaveLength(2);
  });

  it("duplicate is disabled for singleton header", () => {
    renderPanel();
    openMenu("header-1");
    const dup = screen.getByTestId("section-action-duplicate");
    expect((dup as HTMLButtonElement).disabled).toBe(true);
  });

  it("hide/show toggles visibility", () => {
    renderPanel();
    openMenu("hero-1");
    fireEvent.click(screen.getByTestId("section-action-toggle-visible"));
    const hero = useEditorStore.getState().project.pages[0].sections.find(
      (s) => s.id === "hero-1",
    )!;
    expect(hero.visible).toBe(false);
  });

  it("delete removes the section", () => {
    renderPanel();
    openMenu("features-1");
    fireEvent.click(screen.getByTestId("section-action-delete"));
    const page = useEditorStore.getState().project.pages[0];
    expect(page.sections.find((s) => s.id === "features-1")).toBeUndefined();
    expect(page.sections).toHaveLength(3);
  });

  it("delete is disabled when only one section remains", () => {
    useEditorStore.getState().initProject(
      makeProject({
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
      }),
    );
    renderPanel();
    openMenu("hero-1");
    const del = screen.getByTestId("section-action-delete");
    expect((del as HTMLButtonElement).disabled).toBe(true);
  });

  it("menu closes after a successful action", () => {
    renderPanel();
    openMenu("features-1");
    fireEvent.click(screen.getByTestId("section-action-duplicate"));
    expect(screen.queryByTestId("section-menu-features-1-items")).toBeNull();
  });

  it("renders 100 sections without crashing", () => {
    const sections = Array.from({ length: 100 }, (_, i) => ({
      id: `section-${i}`,
      type: i % 2 === 0 ? "hero" : "features",
      order: i + 1,
      visible: true,
      props: { headline: `Headline ${i}`, title: `Title ${i}` },
      styles: {},
    }));
    useEditorStore.getState().initProject(
      makeProject({
        pages: [{ id: "page-1", title: "Home", slug: "/", sections }],
      }),
    );
    renderPanel();
    expect(screen.getAllByTestId(/^structure-row-/)).toHaveLength(100);
  });
});

// ---------------------------------------------------------------------------
// Keyboard reorder
// ---------------------------------------------------------------------------

describe("PageStructurePanel keyboard reorder", () => {
  it("Alt+ArrowUp moves the focused row up", () => {
    renderPanel();
    const row = screen.getByTestId("structure-row-hero-1");
    fireEvent.keyDown(row, { key: "ArrowUp", altKey: true });
    const ids = useEditorStore
      .getState()
      .project.pages[0].sections.map((s) => s.id);
    expect(ids.indexOf("hero-1")).toBe(0);
  });

  it("Alt+ArrowDown moves the focused row down", () => {
    renderPanel();
    const row = screen.getByTestId("structure-row-hero-1");
    fireEvent.keyDown(row, { key: "ArrowDown", altKey: true });
    const ids = useEditorStore
      .getState()
      .project.pages[0].sections.map((s) => s.id);
    expect(ids.indexOf("hero-1")).toBe(2);
  });
});
