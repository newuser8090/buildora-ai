// ---------------------------------------------------------------------------
// Editor store — section structure actions
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { useEditorStore } from "./editor-store";
import { SectionFactory } from "../section-library/services/section-factory";
import {
  registerDefaultSectionLibrary,
  resetSectionLibraryRegistration,
} from "../section-library/registry/register-default-section-library";
import { sectionLibraryRegistry } from "../section-library/registry/section-library-registry";
import type { SectionType } from "../section-library/types";
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
          { id: "header-1", type: "header", order: 1, visible: true, props: { logoText: "Brand" }, styles: {} },
          { id: "hero-1", type: "hero", order: 2, visible: true, props: { headline: "Hero" }, styles: {} },
          { id: "features-1", type: "features", order: 3, visible: true, props: { title: "Features" }, styles: {} },
          { id: "footer-1", type: "footer", order: 4, visible: true, props: { text: "© 2026" }, styles: {} },
        ],
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeSection(type: string, id: string) {
  return new SectionFactory().create({ type: type as SectionType, sectionId: id });
}

function orderedIds(): string[] {
  const page = useEditorStore.getState().project.pages[0];
  return [...page.sections]
    .sort((a, b) => a.order - b.order)
    .map((s) => s.id);
}

function orders(): number[] {
  const page = useEditorStore.getState().project.pages[0];
  return page.sections.map((s) => s.order).sort((a, b) => a - b);
}

function init() {
  useEditorStore.getState().initProject(makeProject());
}

beforeEach(() => {
  // The default section library is registered by EditorProvider in the app;
  // tests must register it explicitly for the factory to resolve definitions.
  resetSectionLibraryRegistration();
  sectionLibraryRegistry.clear();
  registerDefaultSectionLibrary();
  init();
});

// ---------------------------------------------------------------------------
// Insertion
// ---------------------------------------------------------------------------

describe("insertSection", () => {
  it("inserts at the end by default", () => {
    const created = makeSection("cta", "cta-new");
    if (!created.ok) throw new Error("factory failed");
    const result = useEditorStore
      .getState()
      .insertSection("page-1", created.section, { type: "end" });
    expect(result.ok).toBe(true);
    expect(orderedIds()).toEqual(["header-1", "hero-1", "features-1", "footer-1", "cta-new"]);
  });

  it("inserts at the start", () => {
    const created = makeSection("cta", "cta-new");
    if (!created.ok) throw new Error("factory failed");
    useEditorStore.getState().insertSection("page-1", created.section, { type: "start" });
    expect(orderedIds()[0]).toBe("cta-new");
  });

  it("inserts before a target section", () => {
    const created = makeSection("cta", "cta-new");
    if (!created.ok) throw new Error("factory failed");
    useEditorStore.getState().insertSection("page-1", created.section, {
      type: "before",
      sectionId: "hero-1",
    });
    expect(orderedIds()).toEqual(["header-1", "cta-new", "hero-1", "features-1", "footer-1"]);
  });

  it("inserts after a target section", () => {
    const created = makeSection("cta", "cta-new");
    if (!created.ok) throw new Error("factory failed");
    useEditorStore.getState().insertSection("page-1", created.section, {
      type: "after",
      sectionId: "hero-1",
    });
    expect(orderedIds()).toEqual(["header-1", "hero-1", "cta-new", "features-1", "footer-1"]);
  });

  it("fails with PAGE_NOT_FOUND for an invalid page", () => {
    const created = makeSection("cta", "cta-new");
    if (!created.ok) throw new Error("factory failed");
    const result = useEditorStore.getState().insertSection("nope", created.section, { type: "end" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PAGE_NOT_FOUND");
  });

  it("fails with TARGET_NOT_FOUND for an invalid target", () => {
    const created = makeSection("cta", "cta-new");
    if (!created.ok) throw new Error("factory failed");
    const result = useEditorStore.getState().insertSection("page-1", created.section, {
      type: "before",
      sectionId: "missing",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("TARGET_NOT_FOUND");
  });

  it("fails with SECTION_ID_CONFLICT for a duplicate ID", () => {
    const created = makeSection("cta", "hero-1");
    if (!created.ok) throw new Error("factory failed");
    const result = useEditorStore.getState().insertSection("page-1", created.section, { type: "end" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("SECTION_ID_CONFLICT");
  });

  it("fails with SINGLETON_SECTION_EXISTS for a second header", () => {
    const created = makeSection("header", "header-2");
    if (!created.ok) throw new Error("factory failed");
    const result = useEditorStore.getState().insertSection("page-1", created.section, { type: "end" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("SINGLETON_SECTION_EXISTS");
  });

  it("fails with SINGLETON_SECTION_EXISTS for a second footer", () => {
    const created = makeSection("footer", "footer-2");
    if (!created.ok) throw new Error("factory failed");
    const result = useEditorStore.getState().insertSection("page-1", created.section, { type: "end" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("SINGLETON_SECTION_EXISTS");
  });

  it("normalizes order fields to contiguous 1-based values", () => {
    const created = makeSection("cta", "cta-new");
    if (!created.ok) throw new Error("factory failed");
    useEditorStore.getState().insertSection("page-1", created.section, {
      type: "before",
      sectionId: "hero-1",
    });
    expect(orders()).toEqual([1, 2, 3, 4, 5]);
  });

  it("selects the inserted section", () => {
    const created = makeSection("cta", "cta-new");
    if (!created.ok) throw new Error("factory failed");
    useEditorStore.getState().insertSection("page-1", created.section, { type: "end" });
    expect(useEditorStore.getState().selectedSectionId).toBe("cta-new");
  });

  it("creates exactly one history entry; undo removes it, redo restores it", () => {
    const created = makeSection("cta", "cta-new");
    if (!created.ok) throw new Error("factory failed");
    useEditorStore.getState().insertSection("page-1", created.section, { type: "end" });
    expect(useEditorStore.getState().history.past).toHaveLength(1);

    useEditorStore.getState().undo();
    expect(orderedIds()).not.toContain("cta-new");
    expect(orders()).toEqual([1, 2, 3, 4]);

    useEditorStore.getState().redo();
    expect(orderedIds()).toContain("cta-new");
    expect(orders()).toEqual([1, 2, 3, 4, 5]);
  });

  it("failed insertion does not modify the project or history", () => {
    const snapshot = JSON.stringify(useEditorStore.getState().project);
    const created = makeSection("header", "header-2");
    if (!created.ok) throw new Error("factory failed");
    useEditorStore.getState().insertSection("page-1", created.section, { type: "end" });
    expect(JSON.stringify(useEditorStore.getState().project)).toBe(snapshot);
    expect(useEditorStore.getState().history.past).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Reorder
// ---------------------------------------------------------------------------

describe("reorderSection", () => {
  it("moves first to last", () => {
    const result = useEditorStore.getState().reorderSection("page-1", "header-1", "footer-1");
    expect(result.ok).toBe(true);
    expect(orderedIds()).toEqual(["hero-1", "features-1", "footer-1", "header-1"]);
  });

  it("moves last to first", () => {
    useEditorStore.getState().reorderSection("page-1", "footer-1", "header-1");
    expect(orderedIds()).toEqual(["footer-1", "header-1", "hero-1", "features-1"]);
  });

  it("moves a middle section", () => {
    useEditorStore.getState().reorderSection("page-1", "hero-1", "footer-1");
    expect(orderedIds()).toEqual(["header-1", "features-1", "footer-1", "hero-1"]);
  });

  it("is a no-op when the target equals the active section (no history entry)", () => {
    const before = useEditorStore.getState().history.past.length;
    const result = useEditorStore.getState().reorderSection("page-1", "hero-1", "hero-1");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.changed).toBe(false);
    expect(orderedIds()).toEqual(["header-1", "hero-1", "features-1", "footer-1"]);
    expect(useEditorStore.getState().history.past.length).toBe(before);
  });

  it("fails with SECTION_NOT_FOUND for an invalid active ID", () => {
    const result = useEditorStore.getState().reorderSection("page-1", "missing", "hero-1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("SECTION_NOT_FOUND");
  });

  it("reorders hidden sections alongside visible ones and preserves visibility", () => {
    useEditorStore.getState().setSectionVisible("hero-1", false);
    useEditorStore.getState().reorderSection("page-1", "features-1", "header-1");
    expect(orderedIds()).toEqual(["features-1", "header-1", "hero-1", "footer-1"]);
    const hero = useEditorStore.getState().project.pages[0].sections.find(
      (s) => s.id === "hero-1",
    )!;
    expect(hero.visible).toBe(false);
    const features = useEditorStore.getState().project.pages[0].sections.find(
      (s) => s.id === "features-1",
    )!;
    expect(features.visible).toBe(true);
    expect(orders()).toEqual([1, 2, 3, 4]);
  });

  it("fails with TARGET_NOT_FOUND for an invalid target ID", () => {
    const result = useEditorStore.getState().reorderSection("page-1", "hero-1", "missing");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("TARGET_NOT_FOUND");
  });

  it("preserves selection on the moved section", () => {
    useEditorStore.getState().selectSection("hero-1");
    useEditorStore.getState().reorderSection("page-1", "hero-1", "footer-1");
    expect(useEditorStore.getState().selectedSectionId).toBe("hero-1");
  });

  it("normalizes order fields after reorder", () => {
    useEditorStore.getState().reorderSection("page-1", "header-1", "footer-1");
    expect(orders()).toEqual([1, 2, 3, 4]);
  });

  it("creates exactly one history entry; undo/redo restore order", () => {
    useEditorStore.getState().reorderSection("page-1", "header-1", "footer-1");
    expect(useEditorStore.getState().history.past).toHaveLength(1);

    useEditorStore.getState().undo();
    expect(orderedIds()).toEqual(["header-1", "hero-1", "features-1", "footer-1"]);
    expect(orders()).toEqual([1, 2, 3, 4]);

    useEditorStore.getState().redo();
    expect(orderedIds()).toEqual(["hero-1", "features-1", "footer-1", "header-1"]);
    expect(orders()).toEqual([1, 2, 3, 4]);
  });

  it("preserves section objects, IDs, props, styles and visibility", () => {
    useEditorStore.getState().reorderSection("page-1", "header-1", "footer-1");
    const page = useEditorStore.getState().project.pages[0];
    const hero = page.sections.find((s) => s.id === "hero-1")!;
    expect(hero.props).toMatchObject({ headline: "Hero" });
    expect(hero.visible).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Move
// ---------------------------------------------------------------------------

describe("moveSection / moveSectionUp / moveSectionDown", () => {
  it("moves a section to an absolute index", () => {
    const result = useEditorStore.getState().moveSection("page-1", "footer-1", 0);
    expect(result.ok).toBe(true);
    expect(orderedIds()).toEqual(["footer-1", "header-1", "hero-1", "features-1"]);
  });

  it("moveSection is a no-op at the same index", () => {
    const result = useEditorStore.getState().moveSection("page-1", "hero-1", 1);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.changed).toBe(false);
  });

  it("moveSection rejects out-of-bounds indices", () => {
    const result = useEditorStore.getState().moveSection("page-1", "hero-1", 99);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("CANNOT_MOVE_OUT_OF_BOUNDS");
  });

  it("moveSectionUp moves the second section to first", () => {
    const result = useEditorStore.getState().moveSectionUp("page-1", "hero-1");
    expect(result.ok).toBe(true);
    expect(orderedIds()).toEqual(["hero-1", "header-1", "features-1", "footer-1"]);
  });

  it("first item cannot move up", () => {
    const result = useEditorStore.getState().moveSectionUp("page-1", "header-1");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.changed).toBe(false);
    expect(orderedIds()[0]).toBe("header-1");
  });

  it("moveSectionDown moves the third section to fourth", () => {
    const result = useEditorStore.getState().moveSectionDown("page-1", "features-1");
    expect(result.ok).toBe(true);
    expect(orderedIds()).toEqual(["header-1", "hero-1", "footer-1", "features-1"]);
  });

  it("last item cannot move down", () => {
    const result = useEditorStore.getState().moveSectionDown("page-1", "footer-1");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.changed).toBe(false);
    expect(orderedIds()[3]).toBe("footer-1");
  });

  it("one move creates one history entry; selection preserved", () => {
    useEditorStore.getState().selectSection("features-1");
    useEditorStore.getState().moveSectionUp("page-1", "features-1");
    expect(useEditorStore.getState().history.past).toHaveLength(1);
    expect(useEditorStore.getState().selectedSectionId).toBe("features-1");
    expect(orders()).toEqual([1, 2, 3, 4]);

    useEditorStore.getState().undo();
    expect(orderedIds()).toEqual(["header-1", "hero-1", "features-1", "footer-1"]);
  });
});

// ---------------------------------------------------------------------------
// Duplicate
// ---------------------------------------------------------------------------

describe("duplicateSection", () => {
  it("deep clones with a fresh ID inserted immediately after the original", () => {
    const result = useEditorStore.getState().duplicateSection("hero-1");
    expect(result.ok).toBe(true);
    const ids = orderedIds();
    expect(ids).toHaveLength(5);
    // Original stays at index 1; the clone is inserted immediately after it
    expect(ids[1]).toBe("hero-1");
    expect(ids[2]).not.toBe("hero-1");
    expect(ids[2].startsWith("hero-")).toBe(true);
  });

  it("deep-clones props and styles independently", () => {
    useEditorStore.getState().duplicateSection("hero-1");
    const page = useEditorStore.getState().project.pages[0];
    const original = page.sections.find((s) => s.id === "hero-1")!;
    const clone = page.sections.find((s) => s.id !== "hero-1" && s.type === "hero")!;
    expect(clone.props).toEqual(original.props);
    expect(clone.props).not.toBe(original.props);
    expect(clone.visible).toBe(true);
  });

  it("preserves AssetRef references on the clone", () => {
    useEditorStore.getState().initProject(
      makeProject({
        pages: [
          {
            id: "page-1",
            title: "Home",
            slug: "/",
            sections: [
              {
                id: "hero-1",
                type: "hero",
                order: 1,
                visible: true,
                props: {
                  headline: "Hero",
                  heroImage: { assetId: "asset-logo", kind: "image" },
                  backgroundImage: { assetId: "asset-bg", kind: "image" },
                },
                styles: {},
              },
            ],
          },
        ],
      }),
    );
    useEditorStore.getState().duplicateSection("hero-1");
    const page = useEditorStore.getState().project.pages[0];
    const original = page.sections.find((s) => s.id === "hero-1")!;
    const clone = page.sections.find((s) => s.id !== "hero-1")!;
    const originalProps = original.props as {
      heroImage: { assetId: string };
      backgroundImage: { assetId: string; kind: string };
    };
    const cloneProps = clone.props as {
      heroImage: { assetId: string };
      backgroundImage: { assetId: string; kind: string };
    };
    expect(cloneProps.heroImage.assetId).toBe(originalProps.heroImage.assetId);
    expect(cloneProps.backgroundImage).toEqual({
      assetId: "asset-bg",
      kind: "image",
    });
    expect(cloneProps.heroImage).not.toBe(originalProps.heroImage);
  });

  it("selects the new duplicate", () => {
    useEditorStore.getState().duplicateSection("hero-1");
    const selected = useEditorStore.getState().selectedSectionId;
    expect(selected).not.toBe("hero-1");
    expect(selected?.startsWith("hero-")).toBe(true);
  });

  it("blocks singleton duplication (header)", () => {
    const result = useEditorStore.getState().duplicateSection("header-1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("SINGLETON_SECTION_EXISTS");
    expect(orderedIds()).toHaveLength(4);
  });

  it("blocks singleton duplication (footer)", () => {
    const result = useEditorStore.getState().duplicateSection("footer-1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("SINGLETON_SECTION_EXISTS");
  });

  it("normalizes orders after duplicate; one history entry; undo/redo", () => {
    useEditorStore.getState().duplicateSection("hero-1");
    expect(orders()).toEqual([1, 2, 3, 4, 5]);
    expect(useEditorStore.getState().history.past).toHaveLength(1);

    useEditorStore.getState().undo();
    expect(orderedIds()).toHaveLength(4);
    expect(orders()).toEqual([1, 2, 3, 4]);

    useEditorStore.getState().redo();
    expect(orderedIds()).toHaveLength(5);
    expect(orders()).toEqual([1, 2, 3, 4, 5]);
  });
});

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

describe("deleteSection", () => {
  it("deletes the section and reorders", () => {
    const result = useEditorStore.getState().deleteSection("features-1");
    expect(result.ok).toBe(true);
    expect(orderedIds()).toEqual(["header-1", "hero-1", "footer-1"]);
    expect(orders()).toEqual([1, 2, 3]);
  });

  it("selects the nearest next section", () => {
    useEditorStore.getState().selectSection("hero-1");
    useEditorStore.getState().deleteSection("hero-1");
    expect(useEditorStore.getState().selectedSectionId).toBe("features-1");
  });

  it("selects the previous section when the last is deleted", () => {
    useEditorStore.getState().selectSection("footer-1");
    useEditorStore.getState().deleteSection("footer-1");
    expect(useEditorStore.getState().selectedSectionId).toBe("features-1");
  });

  it("refuses to delete the final section", () => {
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
    const result = useEditorStore.getState().deleteSection("hero-1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("CANNOT_DELETE_LAST_SECTION");
    expect(orderedIds()).toEqual(["hero-1"]);
  });

  it("creates one history entry; undo restores original position", () => {
    useEditorStore.getState().deleteSection("features-1");
    expect(useEditorStore.getState().history.past).toHaveLength(1);

    useEditorStore.getState().undo();
    expect(orderedIds()).toEqual(["header-1", "hero-1", "features-1", "footer-1"]);
    expect(orders()).toEqual([1, 2, 3, 4]);

    useEditorStore.getState().redo();
    expect(orderedIds()).toEqual(["header-1", "hero-1", "footer-1"]);
  });

  it("deleting a hidden section works", () => {
    useEditorStore.getState().setSectionVisible("hero-1", false);
    const result = useEditorStore.getState().deleteSection("hero-1");
    expect(result.ok).toBe(true);
    expect(orderedIds()).not.toContain("hero-1");
  });
});

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

describe("setSectionVisible / toggleSectionVisibility", () => {
  it("updates the section-level visible flag, not props", () => {
    const result = useEditorStore.getState().setSectionVisible("hero-1", false);
    expect(result.ok).toBe(true);
    const hero = useEditorStore.getState().project.pages[0].sections.find((s) => s.id === "hero-1")!;
    expect(hero.visible).toBe(false);
    expect(hero.props).toMatchObject({ headline: "Hero" });
  });

  it("preserves position and selection", () => {
    useEditorStore.getState().selectSection("hero-1");
    useEditorStore.getState().setSectionVisible("hero-1", false);
    expect(orderedIds()).toEqual(["header-1", "hero-1", "features-1", "footer-1"]);
    expect(useEditorStore.getState().selectedSectionId).toBe("hero-1");
  });

  it("hidden sections remain in the array", () => {
    useEditorStore.getState().setSectionVisible("hero-1", false);
    expect(useEditorStore.getState().project.pages[0].sections).toHaveLength(4);
  });

  it("is a no-op when visibility is unchanged", () => {
    const before = useEditorStore.getState().history.past.length;
    const result = useEditorStore.getState().setSectionVisible("hero-1", true);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.changed).toBe(false);
    expect(useEditorStore.getState().history.past.length).toBe(before);
  });

  it("creates one history entry; undo/redo restore visibility", () => {
    useEditorStore.getState().setSectionVisible("hero-1", false);
    expect(useEditorStore.getState().history.past).toHaveLength(1);

    useEditorStore.getState().undo();
    const hero = useEditorStore.getState().project.pages[0].sections.find((s) => s.id === "hero-1")!;
    expect(hero.visible).toBe(true);

    useEditorStore.getState().redo();
    const heroAfter = useEditorStore.getState().project.pages[0].sections.find((s) => s.id === "hero-1")!;
    expect(heroAfter.visible).toBe(false);
  });

  it("toggleSectionVisibility flips the flag", () => {
    useEditorStore.getState().toggleSectionVisibility("hero-1");
    const hero = useEditorStore.getState().project.pages[0].sections.find((s) => s.id === "hero-1")!;
    expect(hero.visible).toBe(false);
    useEditorStore.getState().toggleSectionVisibility("hero-1");
    const hero2 = useEditorStore.getState().project.pages[0].sections.find((s) => s.id === "hero-1")!;
    expect(hero2.visible).toBe(true);
  });

  it("rejects visibility changes for missing sections", () => {
    const result = useEditorStore.getState().setSectionVisible("missing", false);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("SECTION_NOT_FOUND");
  });
});
