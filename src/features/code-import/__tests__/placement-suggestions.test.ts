// ---------------------------------------------------------------------------
// Phase P3 — placement suggestions
//   - deterministic primary suggestion per detected content
//   - suggested option is always first
//   - selected-section before/after options
//   - inside-existing-import options
//   - new-page always offered
//   - invalid placements explained (isPlacementValid)
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import type { Project } from "@/types/project";
import { ConversionReportBuilder } from "@/features/code-import/conversion/conversion-report";
import {
  suggestPlacements,
  isPlacementValid,
  type PlacementSuggestionsInput,
} from "@/features/code-import/services/placement-suggestions";
import type { ImportPlacement } from "@/features/code-import/services/insert-imported-block-tree";

function makeProject(): Project {
  return {
    id: "proj-p",
    name: "P",
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
          {
            id: "s-hero",
            type: "hero",
            order: 1,
            visible: true,
            props: { headline: "H", subheadline: "S", primaryCta: { text: "Go", href: "#" } },
            styles: {},
          },
          {
            id: "s-faq",
            type: "faq",
            order: 2,
            visible: true,
            props: { title: "Common questions", items: [{ question: "Q", answer: "A" }] },
            styles: {},
          },
          {
            id: "s-imported",
            type: "custom-block",
            order: 3,
            visible: true,
            props: { name: "My design", tree: { rootIds: ["s-imported"], nodes: {} } },
            styles: {},
          },
        ],
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function reportWith(blockTypeCounts: Record<string, number>) {
  return new ConversionReportBuilder().finalize("html", 5, 1, blockTypeCounts);
}

function inputFor(report: ReturnType<typeof reportWith>, overrides: Partial<PlacementSuggestionsInput> = {}): PlacementSuggestionsInput {
  return {
    project: makeProject(),
    pageId: "page-1",
    report,
    selectedSectionId: null,
    insertionTarget: null,
    ...overrides,
  };
}

describe("suggestPlacements", () => {
  it("suggests the top of the page when navigation is detected", () => {
    const options = suggestPlacements(inputFor(reportWith({ navbar: 1 })));
    expect(options[0].primary).toBe(true);
    expect(options[0].suggestion).toContain("navigation");
    expect(options[0].kind).toBe("new-section");
    expect(options[0].label).toBe("At the top of this page");
  });

  it("suggests before the FAQ when pricing is detected", () => {
    const options = suggestPlacements(inputFor(reportWith({ "pricing-card": 2 })));
    expect(options[0].primary).toBe(true);
    expect(options[0].suggestion).toContain("pricing");
    expect(options[0].kind).toBe("before-section");
    expect(options[0].sectionId).toBe("s-faq");
  });

  it("suggests the end of the page for footer content", () => {
    const options = suggestPlacements(inputFor(reportWith({ footer: 1 })));
    expect(options[0].primary).toBe(true);
    expect(options[0].kind).toBe("new-section");
    expect(options[0].suggestion).toContain("end");
  });

  it("defaults to the end of the page", () => {
    const options = suggestPlacements(inputFor(reportWith({ heading: 1 })));
    expect(options[0].primary).toBe(true);
    expect(options[0].label).toBe("At the end of this page");
    expect(options[0].suggestion).toBeUndefined();
  });

  it("offers before/after the selected section", () => {
    const options = suggestPlacements(
      inputFor(reportWith({ heading: 1 }), { selectedSectionId: "s-hero" }),
    );
    const kinds = options.map((o) => `${o.kind}:${o.sectionId ?? ""}`);
    expect(kinds).toContain("before-section:s-hero");
    expect(kinds).toContain("after-section:s-hero");
  });

  it("offers insertion inside existing imported designs", () => {
    const options = suggestPlacements(inputFor(reportWith({ heading: 1 })));
    const inside = options.find((o) => o.kind === "inside-custom-block");
    expect(inside).toBeDefined();
    expect(inside?.sectionId).toBe("s-imported");
  });

  it("always offers a new page", () => {
    const options = suggestPlacements(inputFor(reportWith({ heading: 1 })));
    expect(options.some((o) => o.kind === "new-page")).toBe(true);
  });

  it("the primary suggestion is always the first option", () => {
    const options = suggestPlacements(inputFor(reportWith({ "pricing-card": 1 })));
    expect(options[0].primary).toBe(true);
  });

  it("is deterministic for the same input", () => {
    const a = suggestPlacements(inputFor(reportWith({ navbar: 1 })));
    const b = suggestPlacements(inputFor(reportWith({ navbar: 1 })));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("honours the block-browser insertion target for inside placement", () => {
    const options = suggestPlacements(
      inputFor(reportWith({ heading: 1 }), {
        insertionTarget: { sectionId: "s-imported", parentBlockId: "some-block" },
      }),
    );
    const inside = options.find((o) => o.kind === "inside-custom-block");
    expect(inside?.parentBlockId).toBe("some-block");
  });
});

describe("isPlacementValid", () => {
  const project = makeProject();

  it("accepts a valid end-of-page placement", () => {
    expect(isPlacementValid(project, { kind: "end-of-page", pageId: "page-1" }).valid).toBe(true);
  });

  it("rejects a missing page", () => {
    expect(isPlacementValid(project, { kind: "end-of-page", pageId: "nope" }).valid).toBe(false);
  });

  it("rejects a missing target section", () => {
    const placement: ImportPlacement = { kind: "before-section", pageId: "page-1", sectionId: "ghost" };
    expect(isPlacementValid(project, placement).valid).toBe(false);
  });

  it("rejects inside a non-custom-block section with an explanation", () => {
    const placement: ImportPlacement = { kind: "inside-custom-block", pageId: "page-1", sectionId: "s-hero" };
    const result = isPlacementValid(project, placement);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("built-in layout");
  });

  it("accepts inside an existing custom-block section", () => {
    const placement: ImportPlacement = { kind: "inside-custom-block", pageId: "page-1", sectionId: "s-imported" };
    expect(isPlacementValid(project, placement).valid).toBe(true);
  });
});
