// ---------------------------------------------------------------------------
// My Blocks Library (Phase P5) — drop zone model tests
//
//   - dropZoneToPlacement: payload → canonical ImportPlacement for every kind
//   - validateDropZone: valid/invalid targets, missing pages/sections,
//     empty trees, built-in (non custom-block) containers
//   - validation reuses canPlaceInside for inside placement (no duplicated
//     insertion rules in the UI)
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeAll } from "vitest";
import {
  registerDefaultBlocks,
  isDefaultBlocksRegistered,
} from "@/features/blocks/registry/block-registry";
import {
  dropZoneToPlacement,
  validateDropZone,
  type MyBlockDropZonePayload,
} from "../drag/drop-zone-utils";
import { makeProject, makeSectionRecord, makeTree } from "./helpers";

beforeAll(() => {
  if (!isDefaultBlocksRegistered()) registerDefaultBlocks();
});

function makeZone(
  overrides: Partial<MyBlockDropZonePayload> = {},
): MyBlockDropZonePayload {
  return {
    kind: "after-section",
    pageId: "page-1",
    sectionId: "s-hero",
    label: "Add here",
    ...overrides,
  };
}

describe("dropZoneToPlacement", () => {
  it("maps before-section", () => {
    const placement = dropZoneToPlacement(
      makeZone({ kind: "before-section", sectionId: "s-hero" }),
    );
    expect(placement).toEqual({
      kind: "before-section",
      pageId: "page-1",
      sectionId: "s-hero",
    });
  });

  it("maps after-section", () => {
    const placement = dropZoneToPlacement(
      makeZone({ kind: "after-section", sectionId: "s-hero" }),
    );
    expect(placement).toEqual({
      kind: "after-section",
      pageId: "page-1",
      sectionId: "s-hero",
    });
  });

  it("maps inside-custom-block with the parent block id", () => {
    const placement = dropZoneToPlacement(
      makeZone({
        kind: "inside-custom-block",
        sectionId: "s-import",
        parentBlockId: "root",
      }),
    );
    expect(placement).toEqual({
      kind: "inside-custom-block",
      pageId: "page-1",
      sectionId: "s-import",
      parentBlockId: "root",
    });
  });

  it("maps end-of-page without a section", () => {
    const placement = dropZoneToPlacement(
      makeZone({ kind: "end-of-page", sectionId: undefined }),
    );
    expect(placement).toEqual({ kind: "end-of-page", pageId: "page-1" });
  });
});

describe("validateDropZone", () => {
  it("accepts after-section against a live section", () => {
    const project = makeProject();
    const result = validateDropZone(
      makeZone({ kind: "after-section", sectionId: "s-hero" }),
      project,
      makeTree(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.placement.kind).toBe("after-section");
  });

  it("accepts before-section against a live section", () => {
    const project = makeProject();
    const result = validateDropZone(
      makeZone({ kind: "before-section", sectionId: "s-hero" }),
      project,
      makeTree(),
    );
    expect(result.ok).toBe(true);
  });

  it("accepts end-of-page", () => {
    const project = makeProject();
    const result = validateDropZone(
      makeZone({ kind: "end-of-page", sectionId: undefined }),
      project,
      makeTree(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.placement.kind).toBe("end-of-page");
  });

  it("rejects a missing page", () => {
    const project = makeProject();
    const result = validateDropZone(
      makeZone({ pageId: "page-nope" }),
      project,
      makeTree(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("no longer exists");
  });

  it("rejects a missing section", () => {
    const project = makeProject();
    const result = validateDropZone(
      makeZone({ sectionId: "s-nope" }),
      project,
      makeTree(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("no longer exists");
  });

  it("rejects a null or empty tree (record corrupt / empty)", () => {
    const project = makeProject();
    expect(
      validateDropZone(makeZone(), project, null).ok,
    ).toBe(false);
    expect(
      validateDropZone(makeZone(), project, { rootIds: [], nodes: {} }).ok,
    ).toBe(false);
  });

  it("rejects inside a built-in (non custom-block) section with an explanation", () => {
    const project = makeProject();
    const result = validateDropZone(
      makeZone({
        kind: "inside-custom-block",
        sectionId: "s-hero",
        parentBlockId: "anything",
      }),
      project,
      makeTree(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/built-in layout|cannot be added inside/i);
    }
  });

  it("accepts inside a custom-block section at a compatible container", () => {
    // Build a project with an imported custom-block section whose root is a
    // container (the dragged block's root is also a container → nestable).
    // customBlockTreeFromSection re-roots the tree to the SECTION id, so the
    // canonical parent for the root-level container is section.id.
    const tree = makeTree();
    const section = makeSectionRecord("Imported design", tree);
    const project = makeProject({
      pages: [
        {
          id: "page-1",
          title: "Home",
          slug: "/",
          sections: [section],
        },
      ],
    });
    const result = validateDropZone(
      makeZone({
        kind: "inside-custom-block",
        sectionId: section.id,
        parentBlockId: section.id,
      }),
      project,
      makeTree(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.placement.kind).toBe("inside-custom-block");
      expect(result.placement.parentBlockId).toBe(section.id);
    }
  });

  it("rejects inside a custom-block section when the parent block is missing", () => {
    const tree = makeTree();
    const section = makeSectionRecord("Imported design", tree);
    const project = makeProject({
      pages: [{ id: "page-1", title: "Home", slug: "/", sections: [section] }],
    });
    const result = validateDropZone(
      makeZone({
        kind: "inside-custom-block",
        sectionId: section.id,
        parentBlockId: "does-not-exist",
      }),
      project,
      makeTree(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("no longer exists");
  });
});
