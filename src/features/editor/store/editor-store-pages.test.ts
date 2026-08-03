// ---------------------------------------------------------------------------
// Editor store — page lifecycle actions
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { useEditorStore } from "./editor-store";
import { ProjectSchema } from "@/features/generation/schemas/generation-plan-schema";
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
        background: "#ffffff",
        foreground: "#0a0a0a",
        primary: "#7c5cfc",
        primaryForeground: "#ffffff",
        secondary: "#f5f5f5",
        secondaryForeground: "#0a0a0a",
        muted: "#f5f5f5",
        mutedForeground: "#737373",
        accent: "#7c5cfc",
        accentForeground: "#ffffff",
        border: "#e5e5e5",
        card: "#ffffff",
        cardForeground: "#0a0a0a",
      },
      typography: {
        fontFamily: "Geist, system-ui, sans-serif",
        headingFont: "Geist, system-ui, sans-serif",
        baseSize: "16px",
        scale: 1.25,
      },
      spacing: {
        sectionPadding: "6rem 0",
        containerMaxWidth: "1120px",
        gap: "1.5rem",
      },
      radius: {
        sm: "0.375rem",
        md: "0.5rem",
        lg: "0.75rem",
        xl: "1rem",
        full: "9999px",
      },
      shadows: {
        sm: "0 1px 2px rgba(0,0,0,0.05)",
        md: "0 4px 6px rgba(0,0,0,0.07)",
        lg: "0 10px 15px rgba(0,0,0,0.1)",
        xl: "0 20px 25px rgba(0,0,0,0.15)",
      },
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

function pageIds(): string[] {
  return useEditorStore.getState().project.pages.map((p) => p.id);
}

function init() {
  useEditorStore.getState().initProject(makeProject());
}

beforeEach(() => {
  init();
});

// ---------------------------------------------------------------------------
// addPage
// ---------------------------------------------------------------------------

describe("addPage", () => {
  it("appends a page with a valid starter section and selects it", () => {
    const result = useEditorStore.getState().addPage({ title: "About" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { project, selectedPageId, selectedSectionId } =
      useEditorStore.getState();
    expect(project.pages).toHaveLength(2);
    const added = project.pages[1];
    expect(added.title).toBe("About");
    expect(added.slug).toBe("/about");
    expect(added.sections).toHaveLength(1);
    expect(added.sections[0].type).toBe("hero");
    expect(selectedPageId).toBe(added.id);
    expect(selectedSectionId).toBeNull();
  });

  it("defaults the title and keeps default names unique", () => {
    useEditorStore.getState().addPage();
    useEditorStore.getState().addPage();
    const titles = useEditorStore.getState().project.pages.map((p) => p.title);
    expect(titles).toEqual(["Home", "Untitled Page", "Untitled Page 2"]);
  });

  it("derives unique slugs", () => {
    useEditorStore.getState().addPage({ title: "Home" });
    useEditorStore.getState().addPage({ title: "Home" });
    const slugs = useEditorStore.getState().project.pages.map((p) => p.slug);
    expect(slugs).toEqual(["/", "/home", "/home-2"]);
  });

  it("keeps the project schema-valid", () => {
    useEditorStore.getState().addPage({ title: "About" });
    useEditorStore.getState().addPage({ title: "Contact" });
    const validation = ProjectSchema.safeParse(
      useEditorStore.getState().project,
    );
    expect(validation.success).toBe(true);
  });

  it("clears the section selection when adding", () => {
    useEditorStore.getState().selectSection("hero-1");
    useEditorStore.getState().addPage({ title: "About" });
    expect(useEditorStore.getState().selectedSectionId).toBeNull();
    expect(useEditorStore.getState().selectedPageId).toBe(
      useEditorStore.getState().project.pages[1].id,
    );
  });

  it("creates one history entry; undo removes the page, redo restores it", () => {
    useEditorStore.getState().addPage({ title: "About" });
    expect(useEditorStore.getState().history.past).toHaveLength(1);

    useEditorStore.getState().undo();
    expect(pageIds()).toEqual(["page-1"]);

    useEditorStore.getState().redo();
    expect(pageIds()).toEqual(["page-1", expect.stringMatching(/^page-/)]);
    expect(useEditorStore.getState().project.pages[1].title).toBe("About");
  });
});

// ---------------------------------------------------------------------------
// renamePage
// ---------------------------------------------------------------------------

describe("renamePage", () => {
  it("renames the title and re-derives the slug", () => {
    useEditorStore.getState().addPage({ title: "About" });
    const aboutId = useEditorStore.getState().project.pages[1].id;
    const result = useEditorStore.getState().renamePage(aboutId, "Our Story");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const page = useEditorStore.getState().project.pages[1];
    expect(page.title).toBe("Our Story");
    expect(page.slug).toBe("/our-story");
  });

  it("keeps other pages untouched", () => {
    useEditorStore.getState().addPage({ title: "About" });
    const aboutId = useEditorStore.getState().project.pages[1].id;
    useEditorStore.getState().renamePage(aboutId, "Story");
    const home = useEditorStore.getState().project.pages[0];
    expect(home.title).toBe("Home");
    expect(home.slug).toBe("/");
  });

  it("avoids slug collisions with other pages", () => {
    useEditorStore.getState().addPage({ title: "About" });
    useEditorStore.getState().addPage({ title: "Contact" });
    const contactId = useEditorStore.getState().project.pages[2].id;
    useEditorStore.getState().renamePage(contactId, "About");
    const contact = useEditorStore.getState().project.pages[2];
    expect(contact.title).toBe("About");
    expect(contact.slug).toBe("/about-2");
  });

  it("fails with INVALID_PAGE_TITLE for an empty title", () => {
    useEditorStore.getState().addPage({ title: "About" });
    const aboutId = useEditorStore.getState().project.pages[1].id;
    const result = useEditorStore.getState().renamePage(aboutId, "   ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_PAGE_TITLE");
    expect(useEditorStore.getState().project.pages[1].title).toBe("About");
  });

  it("fails with PAGE_NOT_FOUND for an unknown page", () => {
    const result = useEditorStore.getState().renamePage("missing", "New");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PAGE_NOT_FOUND");
  });

  it("is a no-op when nothing changes (no history entry)", () => {
    const before = useEditorStore.getState().history.past.length;
    const result = useEditorStore.getState().renamePage("page-1", "Home");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.changed).toBe(false);
    expect(useEditorStore.getState().history.past.length).toBe(before);
  });

  it("creates one history entry; undo restores the old title", () => {
    useEditorStore.getState().addPage({ title: "About" });
    const aboutId = useEditorStore.getState().project.pages[1].id;
    useEditorStore.getState().renamePage(aboutId, "Story");
    expect(useEditorStore.getState().history.past).toHaveLength(2);

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().project.pages[1].title).toBe("About");

    useEditorStore.getState().redo();
    expect(useEditorStore.getState().project.pages[1].title).toBe("Story");
  });
});

// ---------------------------------------------------------------------------
// deletePage
// ---------------------------------------------------------------------------

describe("deletePage", () => {
  it("deletes the page and selects the nearest next", () => {
    useEditorStore.getState().addPage({ title: "About" });
    useEditorStore.getState().addPage({ title: "Contact" });
    // Select the middle page first.
    const aboutId = useEditorStore.getState().project.pages[1].id;
    useEditorStore.getState().selectPage(aboutId);
    const result = useEditorStore.getState().deletePage(aboutId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const state = useEditorStore.getState();
    expect(state.project.pages.map((p) => p.title)).toEqual(["Home", "Contact"]);
    expect(state.selectedPageId).toBe(state.project.pages[1].id);
    expect(state.selectedSectionId).toBeNull();
  });

  it("refuses to delete the final page", () => {
    const result = useEditorStore.getState().deletePage("page-1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("CANNOT_DELETE_LAST_PAGE");
    expect(pageIds()).toEqual(["page-1"]);
  });

  it("fails with PAGE_NOT_FOUND for an unknown page", () => {
    const result = useEditorStore.getState().deletePage("missing");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PAGE_NOT_FOUND");
  });

  it("clears the section selection on delete", () => {
    useEditorStore.getState().selectSection("hero-1");
    useEditorStore.getState().addPage({ title: "About" });
    const aboutId = useEditorStore.getState().project.pages[1].id;
    useEditorStore.getState().deletePage(aboutId);
    expect(useEditorStore.getState().selectedSectionId).toBeNull();
    expect(useEditorStore.getState().selectedPageId).toBe("page-1");
  });

  it("creates one history entry; undo restores the page", () => {
    useEditorStore.getState().addPage({ title: "About" });
    const aboutId = useEditorStore.getState().project.pages[1].id;
    useEditorStore.getState().deletePage(aboutId);
    expect(useEditorStore.getState().history.past).toHaveLength(2);

    useEditorStore.getState().undo();
    expect(pageIds()).toEqual(["page-1", aboutId]);
    expect(useEditorStore.getState().project.pages[1].title).toBe("About");

    useEditorStore.getState().redo();
    expect(pageIds()).toEqual(["page-1"]);
  });
});

// ---------------------------------------------------------------------------
// movePage
// ---------------------------------------------------------------------------

describe("movePage", () => {
  it("moves a page to an absolute index", () => {
    useEditorStore.getState().addPage({ title: "About" });
    useEditorStore.getState().addPage({ title: "Contact" });
    const contactId = useEditorStore.getState().project.pages[2].id;
    const result = useEditorStore.getState().movePage(contactId, 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const titles = useEditorStore.getState().project.pages.map((p) => p.title);
    expect(titles).toEqual(["Contact", "Home", "About"]);
  });

  it("rejects out-of-bounds indices", () => {
    const result = useEditorStore.getState().movePage("page-1", 99);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("CANNOT_MOVE_OUT_OF_BOUNDS");
  });

  it("is a no-op at the same index", () => {
    const before = useEditorStore.getState().history.past.length;
    const result = useEditorStore.getState().movePage("page-1", 0);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.changed).toBe(false);
    expect(useEditorStore.getState().history.past.length).toBe(before);
  });

  it("creates one history entry; undo restores the order", () => {
    useEditorStore.getState().addPage({ title: "About" });
    const aboutId = useEditorStore.getState().project.pages[1].id;
    useEditorStore.getState().movePage(aboutId, 0);
    expect(useEditorStore.getState().history.past).toHaveLength(2);

    useEditorStore.getState().undo();
    expect(pageIds()).toEqual(["page-1", aboutId]);

    useEditorStore.getState().redo();
    expect(pageIds()).toEqual([aboutId, "page-1"]);
  });
});

// ---------------------------------------------------------------------------
// selectPage
// ---------------------------------------------------------------------------

describe("selectPage", () => {
  function initTwoPages() {
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
          {
            id: "page-2",
            title: "About",
            slug: "/about",
            sections: [
              { id: "hero-2", type: "hero", order: 1, visible: true, props: {}, styles: {} },
            ],
          },
        ],
      }),
    );
  }

  it("switches pages and clears the section selection", () => {
    initTwoPages();
    useEditorStore.getState().selectSection("hero-1");
    useEditorStore.getState().selectPage("page-2");
    const state = useEditorStore.getState();
    expect(state.selectedPageId).toBe("page-2");
    expect(state.selectedSectionId).toBeNull();
  });

  it("is a no-op when the page is already active", () => {
    initTwoPages();
    useEditorStore.getState().selectSection("hero-1");
    useEditorStore.getState().selectPage("page-1");
    const state = useEditorStore.getState();
    expect(state.selectedPageId).toBe("page-1");
    // Selection preserved — no page switch happened.
    expect(state.selectedSectionId).toBe("hero-1");
  });
});
