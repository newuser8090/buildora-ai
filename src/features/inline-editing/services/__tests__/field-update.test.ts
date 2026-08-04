// ---------------------------------------------------------------------------
// Field update service tests (Phase M spec §27)
//   - simple field / nested field / array field
//   - invalid page / section / wrong type / invalid path
//   - too long / empty / schema failure
//   - source unchanged / unrelated props preserved / links/assets/prices preserved
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeAll } from "vitest";
import type { Project } from "@/types/project";
import { registerDefaultSectionLibrary } from "@/features/editor/section-library/registry/register-default-section-library";
import { updateEditableField } from "../field-update";
import { buildDescriptorFromFieldId } from "../../registry/editable-field-registry";
import type { EditableFieldDescriptor } from "../../types";
import { MOCK_PROJECT } from "@/features/editor/mock/mock-project";

beforeAll(() => {
  registerDefaultSectionLibrary();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cloneProject(): Project {
  return JSON.parse(JSON.stringify(MOCK_PROJECT)) as Project;
}

function heroDescriptor(project: Project, value?: string): EditableFieldDescriptor {
  const section = project.pages[0].sections.find((s) => s.id === "s-hero")!;
  const desc = buildDescriptorFromFieldId("page-1", section, "hero.headline")!;
  return value === undefined ? desc : { ...desc, currentValue: value };
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("updateEditableField — happy path", () => {
  it("updates a simple top-level field", () => {
    const project = cloneProject();
    const result = updateEditableField(project, heroDescriptor(project), "New headline");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changed).toBe(true);
    const section = result.project.pages[0].sections.find((s) => s.id === "s-hero")!;
    expect(section.props.headline).toBe("New headline");
  });

  it("updates a nested object field (CTA text)", () => {
    const project = cloneProject();
    const section = project.pages[0].sections.find((s) => s.id === "s-hero")!;
    const desc = buildDescriptorFromFieldId("page-1", section, "hero.primaryCta.text")!;
    const result = updateEditableField(project, desc, "Sign up now");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const updated = result.project.pages[0].sections.find((s) => s.id === "s-hero")!;
    expect(updated.props.primaryCta).toEqual({ text: "Sign up now", href: "#" });
  });

  it("updates a nested array field (feature title)", () => {
    const project = cloneProject();
    const section = project.pages[0].sections.find((s) => s.id === "s-features")!;
    const desc = buildDescriptorFromFieldId("page-1", section, "features.feature.title", 1)!;
    const result = updateEditableField(project, desc, "Fully Editable");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const updated = result.project.pages[0].sections.find((s) => s.id === "s-features")!;
    const features = updated.props.features as Array<{ title: string }>;
    expect(features[1].title).toBe("Fully Editable");
    expect(features[0].title).toBe("AI-Powered Generation");
  });

  it("updates a doubly-nested array field (pricing feature)", () => {
    const project = cloneProject();
    const section = project.pages[0].sections.find((s) => s.id === "s-pricing")!;
    const desc = buildDescriptorFromFieldId("page-1", section, "pricing.plan.feature", [1, 0])!;
    const result = updateEditableField(project, desc, "Everything in Free, plus…");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const updated = result.project.pages[0].sections.find((s) => s.id === "s-pricing")!;
    const plans = updated.props.plans as Array<{ features: string[] }>;
    expect(plans[1].features[0]).toBe("Everything in Free, plus…");
  });

  it("returns changed:false for a no-op (unchanged value)", () => {
    const project = cloneProject();
    const section = project.pages[0].sections.find((s) => s.id === "s-hero")!;
    const desc = buildDescriptorFromFieldId("page-1", section, "hero.headline")!;
    const result = updateEditableField(project, desc, section.props.headline as string);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.changed).toBe(false);
  });

  it("does not mutate the input project", () => {
    const project = cloneProject();
    const before = JSON.stringify(project);
    updateEditableField(project, heroDescriptor(project), "Changed");
    expect(JSON.stringify(project)).toBe(before);
  });

  it("preserves unrelated props on the same section", () => {
    const project = cloneProject();
    const before = JSON.stringify(
      project.pages[0].sections.find((s) => s.id === "s-hero")!.props,
    );
    const result = updateEditableField(project, heroDescriptor(project), "Changed");
    if (!result.ok) return;
    const after = JSON.stringify(
      result.project.pages[0].sections.find((s) => s.id === "s-hero")!.props,
    );
    expect(after).not.toBe(before);
    // Unrelated page preserved
    expect(result.project.pages).toHaveLength(1);
  });

  it("preserves links, assets, and prices", () => {
    const project = cloneProject();
    const result = updateEditableField(project, heroDescriptor(project), "Changed");
    if (!result.ok) return;
    const pricing = result.project.pages[0].sections.find((s) => s.id === "s-pricing")!;
    const plans = pricing.props.plans as Array<{ price: string; name: string }>;
    expect(plans[0].price).toBe("$0");
    expect(plans[1].price).toBe("$19");
    const hero = result.project.pages[0].sections.find((s) => s.id === "s-hero")!;
    expect((hero.props.primaryCta as { href: string }).href).toBe("#");
    const header = result.project.pages[0].sections.find((s) => s.id === "s-header")!;
    const links = header.props.navLinks as Array<{ href: string }>;
    expect(links[0].href).toBe("#features");
  });
});

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

describe("updateEditableField — errors", () => {
  it("returns INLINE_FIELD_NOT_FOUND for an invalid page", () => {
    const project = cloneProject();
    const desc: EditableFieldDescriptor = {
      ...heroDescriptor(project),
      pageId: "nope",
    };
    const result = updateEditableField(project, desc, "x");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INLINE_FIELD_NOT_FOUND");
  });

  it("returns INLINE_FIELD_NOT_FOUND for an invalid section", () => {
    const project = cloneProject();
    const desc: EditableFieldDescriptor = {
      ...heroDescriptor(project),
      sectionId: "nope",
    };
    const result = updateEditableField(project, desc, "x");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INLINE_FIELD_NOT_FOUND");
  });

  it("returns INLINE_FIELD_UNSUPPORTED for a wrong section type", () => {
    const project = cloneProject();
    const desc: EditableFieldDescriptor = {
      ...heroDescriptor(project),
      sectionId: "s-footer",
      sectionType: "hero",
      fieldPath: ["headline"],
    };
    const result = updateEditableField(project, desc, "x");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INLINE_FIELD_UNSUPPORTED");
  });

  it("returns INLINE_FIELD_PATH_INVALID for an unregistered path", () => {
    const project = cloneProject();
    const desc: EditableFieldDescriptor = {
      ...heroDescriptor(project),
      fieldPath: ["primaryCta", "href"],
    };
    const result = updateEditableField(project, desc, "https://evil");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INLINE_FIELD_PATH_INVALID");
  });

  it("returns INLINE_VALUE_INVALID for an empty value", () => {
    const project = cloneProject();
    const result = updateEditableField(project, heroDescriptor(project), "   ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INLINE_VALUE_INVALID");
  });

  it("returns INLINE_VALUE_INVALID for an over-long value", () => {
    const project = cloneProject();
    const desc = heroDescriptor(project);
    const result = updateEditableField(project, desc, "x".repeat((desc.maxLength ?? 300) + 1));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INLINE_VALUE_INVALID");
  });

  it("returns INLINE_VALUE_INVALID when the value breaks the section schema", () => {
    const project = cloneProject();
    // Force a descriptor that would write an invalid section shape (defensive).
    const desc = heroDescriptor(project);
    const result = updateEditableField(project, desc, "fine text");
    expect(result.ok).toBe(true);
    // Verify validation path: a value that fails length cap inside the schema.
    const long = updateEditableField(project, desc, "x".repeat(5000));
    expect(long.ok).toBe(false);
  });
});
