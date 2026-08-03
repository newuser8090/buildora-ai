// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// PageTabs — component tests
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { PageTabs } from "../PageTabs";
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
      {
        id: "page-2",
        title: "About",
        slug: "/about",
        sections: [
          { id: "hero-2", type: "hero", order: 1, visible: true, props: {}, styles: {} },
        ],
      },
      {
        id: "page-3",
        title: "Contact",
        slug: "/contact",
        sections: [
          { id: "hero-3", type: "hero", order: 1, visible: true, props: {}, styles: {} },
        ],
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function initStore(project?: Project) {
  useEditorStore.getState().initProject(project ?? makeProject());
}

function renderTabs() {
  return render(<PageTabs />);
}

function openMenu(pageId: string) {
  fireEvent.click(screen.getByTestId(`page-menu-${pageId}`));
}

beforeEach(() => {
  initStore();
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe("PageTabs rendering", () => {
  it("renders one tab per page plus the add button", () => {
    renderTabs();
    expect(screen.getByTestId("page-tab-page-1")).toBeTruthy();
    expect(screen.getByTestId("page-tab-page-2")).toBeTruthy();
    expect(screen.getByTestId("page-tab-page-3")).toBeTruthy();
    expect(screen.getByTestId("page-tab-add")).toBeTruthy();
  });

  it("marks the active page as selected", () => {
    renderTabs();
    const active = screen
      .getByTestId("page-tab-page-1")
      .querySelector('[role="tab"]');
    const inactive = screen
      .getByTestId("page-tab-page-2")
      .querySelector('[role="tab"]');
    expect(active?.getAttribute("aria-selected")).toBe("true");
    expect(inactive?.getAttribute("aria-selected")).toBe("false");
  });

  it("follows the store selection", () => {
    useEditorStore.getState().selectPage("page-2");
    renderTabs();
    const tab = screen
      .getByTestId("page-tab-page-2")
      .querySelector('[role="tab"]');
    expect(tab?.getAttribute("aria-selected")).toBe("true");
  });
});

// ---------------------------------------------------------------------------
// Switching
// ---------------------------------------------------------------------------

describe("PageTabs switching", () => {
  it("clicking a tab selects the page and clears section selection", () => {
    useEditorStore.getState().selectSection("hero-1");
    renderTabs();
    fireEvent.click(
      screen.getByTestId("page-tab-page-2").querySelector('[role="tab"]')!,
    );
    const state = useEditorStore.getState();
    expect(state.selectedPageId).toBe("page-2");
    expect(state.selectedSectionId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Adding
// ---------------------------------------------------------------------------

describe("PageTabs adding", () => {
  it("adds a page and enters rename mode with a default name", () => {
    renderTabs();
    fireEvent.click(screen.getByTestId("page-tab-add"));

    const state = useEditorStore.getState();
    expect(state.project.pages).toHaveLength(4);
    const input = screen.getByTestId("page-rename-input") as HTMLInputElement;
    expect(input.value).toBe("Untitled Page");
  });

  it("renames the new page on Enter", () => {
    renderTabs();
    fireEvent.click(screen.getByTestId("page-tab-add"));
    const input = screen.getByTestId("page-rename-input");
    fireEvent.change(input, { target: { value: "Blog" } });
    fireEvent.keyDown(input, { key: "Enter" });

    const added = useEditorStore.getState().project.pages[3];
    expect(added.title).toBe("Blog");
    expect(added.slug).toBe("/blog");
    expect(screen.queryByTestId("page-rename-input")).toBeNull();
  });

  it("cancels the rename on Escape without adding a title change", () => {
    renderTabs();
    fireEvent.click(screen.getByTestId("page-tab-add"));
    const input = screen.getByTestId("page-rename-input");
    fireEvent.change(input, { target: { value: "Canceled" } });
    fireEvent.keyDown(input, { key: "Escape" });

    const added = useEditorStore.getState().project.pages[3];
    expect(added.title).toBe("Untitled Page");
  });
});

// ---------------------------------------------------------------------------
// Rename via menu
// ---------------------------------------------------------------------------

describe("PageTabs rename menu", () => {
  it("renames an existing page through the menu", () => {
    renderTabs();
    openMenu("page-2");
    fireEvent.click(screen.getByTestId("page-action-rename"));

    const input = screen.getByTestId("page-rename-input") as HTMLInputElement;
    expect(input.value).toBe("About");
    fireEvent.change(input, { target: { value: "Our Story" } });
    fireEvent.keyDown(input, { key: "Enter" });

    const page = useEditorStore
      .getState()
      .project.pages.find((p) => p.id === "page-2")!;
    expect(page.title).toBe("Our Story");
    expect(page.slug).toBe("/our-story");
  });

  it("shows an error and keeps editing for an invalid name", () => {
    renderTabs();
    openMenu("page-2");
    fireEvent.click(screen.getByTestId("page-action-rename"));

    const input = screen.getByTestId("page-rename-input");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByTestId("page-rename-error")).toBeTruthy();
    const page = useEditorStore
      .getState()
      .project.pages.find((p) => p.id === "page-2")!;
    expect(page.title).toBe("About");
    // Still editing so the user can correct the name
    expect(screen.getByTestId("page-rename-input")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Reordering
// ---------------------------------------------------------------------------

describe("PageTabs reordering", () => {
  it("moves a page left", () => {
    renderTabs();
    openMenu("page-2");
    fireEvent.click(screen.getByTestId("page-action-move-left"));
    const titles = useEditorStore.getState().project.pages.map((p) => p.title);
    expect(titles).toEqual(["About", "Home", "Contact"]);
  });

  it("moves a page right", () => {
    renderTabs();
    openMenu("page-2");
    fireEvent.click(screen.getByTestId("page-action-move-right"));
    const titles = useEditorStore.getState().project.pages.map((p) => p.title);
    expect(titles).toEqual(["Home", "Contact", "About"]);
  });

  it("disables move left on the first page", () => {
    renderTabs();
    openMenu("page-1");
    const moveLeft = screen.getByTestId("page-action-move-left");
    expect((moveLeft as HTMLButtonElement).disabled).toBe(true);
  });

  it("disables move right on the last page", () => {
    renderTabs();
    openMenu("page-3");
    const moveRight = screen.getByTestId("page-action-move-right");
    expect((moveRight as HTMLButtonElement).disabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Deleting
// ---------------------------------------------------------------------------

describe("PageTabs deleting", () => {
  it("deletes a page after confirmation", () => {
    renderTabs();
    openMenu("page-2");
    fireEvent.click(screen.getByTestId("page-action-delete"));

    const dialog = screen.getByRole("dialog", { name: "Delete page?" });
    expect(dialog).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Delete" }),
    );

    const state = useEditorStore.getState();
    expect(state.project.pages.map((p) => p.id)).toEqual(["page-1", "page-3"]);
    expect(state.selectedPageId).toBe("page-3");
    expect(screen.queryByRole("dialog", { name: "Delete page?" })).toBeNull();
  });

  it("cancels the delete dialog without changes", () => {
    renderTabs();
    openMenu("page-2");
    fireEvent.click(screen.getByTestId("page-action-delete"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(useEditorStore.getState().project.pages).toHaveLength(3);
  });

  it("disables delete when only one page exists", () => {
    initStore(
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
    renderTabs();
    openMenu("page-1");
    const del = screen.getByTestId("page-action-delete");
    expect((del as HTMLButtonElement).disabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Menu behavior
// ---------------------------------------------------------------------------

describe("PageTabs menu behavior", () => {
  it("closes the menu on Escape", () => {
    renderTabs();
    openMenu("page-2");
    expect(screen.getByTestId("page-menu-page-2-items")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("page-menu-page-2-items")).toBeNull();
  });

  it("closes the menu after an action", () => {
    renderTabs();
    openMenu("page-2");
    fireEvent.click(screen.getByTestId("page-action-move-left"));
    expect(screen.queryByTestId("page-menu-page-2-items")).toBeNull();
  });
});
