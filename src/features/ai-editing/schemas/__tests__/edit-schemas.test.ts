import { describe, it, expect } from "vitest";
import {
  EditTargetSchema,
  EditResultSchema,
  EditedSectionSchema,
} from "../edit-schemas";

describe("EditTargetSchema", () => {
  it("accepts a valid section target", () => {
    const result = EditTargetSchema.safeParse({
      kind: "section",
      sectionId: "hero-1",
      type: "hero",
      label: "Hero section",
      props: { headline: "Hello" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts optional context with brand name", () => {
    const result = EditTargetSchema.safeParse({
      kind: "section",
      sectionId: "hero-1",
      type: "hero",
      props: {},
      context: { brandName: "Acme" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a non-section kind", () => {
    const result = EditTargetSchema.safeParse({
      kind: "page",
      pageId: "p1",
      type: "hero",
      props: {},
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing sectionId", () => {
    const result = EditTargetSchema.safeParse({
      kind: "section",
      type: "hero",
      props: {},
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unsupported section type", () => {
    const result = EditTargetSchema.safeParse({
      kind: "section",
      sectionId: "s1",
      type: "blog",
      props: {},
    });
    expect(result.success).toBe(false);
  });

  it("defaults missing props to an empty record", () => {
    const result = EditTargetSchema.safeParse({
      kind: "section",
      sectionId: "s1",
      type: "cta",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.props).toEqual({});
    }
  });
});

describe("EditedSectionSchema / EditResultSchema", () => {
  it("accepts a valid edited section", () => {
    const result = EditedSectionSchema.safeParse({
      type: "hero",
      props: { headline: "New" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts a result with one or more edits", () => {
    const result = EditResultSchema.safeParse({
      edits: [{ type: "hero", props: { headline: "New" } }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty edits array", () => {
    const result = EditResultSchema.safeParse({ edits: [] });
    expect(result.success).toBe(false);
  });

  it("rejects edits missing a type", () => {
    const result = EditResultSchema.safeParse({
      edits: [{ props: { headline: "New" } }],
    });
    expect(result.success).toBe(false);
  });
});
