// ---------------------------------------------------------------------------
// TemplateProjectFactory tests
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { TemplateProjectFactory } from "../services/template-project-factory";
import {
  registerDefaultTemplates,
  resetTemplateRegistration,
} from "../registry/register-default-templates";
import { templateRegistry } from "../registry/template-registry";
import { ProjectSchema } from "@/features/generation/schemas/generation-plan-schema";
import { validateProjectName } from "@/features/projects/utils/validate-project-name";
import { TemplateError } from "../types";
import type { TemplateIdFactory } from "../types";

// ---------------------------------------------------------------------------
// Deterministic ID factory
// ---------------------------------------------------------------------------

const FIXED_NOW = "2026-08-01T00:00:00.000Z";

let idCounter = 0;

function deterministicIdFactory(): TemplateIdFactory {
  return {
    projectId: () => `proj-${++idCounter}`,
    pageId: (templateId, index) => `${templateId}-page-${index}`,
    sectionId: (templateId, type, index) => `${templateId}-${type}-${index}`,
  };
}

describe("TemplateProjectFactory", () => {
  let factory: TemplateProjectFactory;

  beforeEach(() => {
    resetTemplateRegistration();
    templateRegistry.clear();
    registerDefaultTemplates();
    factory = new TemplateProjectFactory();
  });

  const create = (templateId: string, projectName: string) =>
    factory.createProjectFromTemplate({
      templateId,
      projectName,
      now: FIXED_NOW,
      idFactory: deterministicIdFactory(),
    });

  describe("blank template", () => {
    it("creates a valid blank project", () => {
      const result = create("template-blank", "Untitled Project");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.project.pages).toHaveLength(1);
      expect(result.project.assets).toHaveLength(0);
      expect(result.project.pages[0].sections.length).toBeGreaterThan(0);
    });

    it("uses the injected project name", () => {
      const result = create("template-blank", "My Blank");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.project.name).toBe("My Blank");
    });
  });

  describe("every default template", () => {
    const ALL_TEMPLATE_IDS = [
      "template-blank",
      "template-saas",
      "template-portfolio",
      "template-agency",
      "template-restaurant",
      "template-ecommerce",
      "template-startup",
    ];

    for (const templateId of ALL_TEMPLATE_IDS) {
      it(`${templateId} produces a schema-valid project`, () => {
        const result = create(templateId, "Test Project");
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const parsed = ProjectSchema.safeParse(result.project);
        expect(parsed.success).toBe(true);
      });
    }

    it("all created projects pass ProjectSchema", () => {
      for (const templateId of ALL_TEMPLATE_IDS) {
        const result = create(templateId, "Test Project");
        expect(result.ok, templateId).toBe(true);
        if (!result.ok) continue;
        expect(ProjectSchema.safeParse(result.project).success).toBe(true);
      }
    });
  });

  describe("canonical name validation", () => {
    it("rejects an empty name", () => {
      const result = create("template-saas", "   ");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("INVALID_PROJECT_NAME");
    });

    it("rejects a name over 80 characters", () => {
      const result = create("template-saas", "a".repeat(81));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("INVALID_PROJECT_NAME");
    });

    it("accepts exactly 80 characters", () => {
      const name = "a".repeat(80);
      expect(validateProjectName(name).valid).toBe(true);
      const result = create("template-saas", name);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.project.name).toBe(name);
    });

    it("trims the accepted name", () => {
      const result = create("template-saas", "  Trimmed Name  ");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.project.name).toBe("Trimmed Name");
    });

    it("error is a TemplateError instance", () => {
      const result = create("template-saas", "");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBeInstanceOf(TemplateError);
    });
  });

  describe("template resolution", () => {
    it("returns TEMPLATE_NOT_FOUND for unknown template", () => {
      const result = create("template-nope", "Test");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("TEMPLATE_NOT_FOUND");
      expect(result.error.templateId).toBe("template-nope");
    });
  });

  describe("injected identity and time", () => {
    it("uses the injected project ID", () => {
      const result = factory.createProjectFromTemplate({
        templateId: "template-saas",
        projectName: "Test",
        projectId: "explicit-id",
        now: FIXED_NOW,
        idFactory: deterministicIdFactory(),
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.project.id).toBe("explicit-id");
    });

    it("uses one injected clock value for both timestamps", () => {
      const result = create("template-saas", "Test");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.project.createdAt).toBe(FIXED_NOW);
      expect(result.project.updatedAt).toBe(FIXED_NOW);
    });

    it("page IDs are unique within a project", () => {
      const result = create("template-saas", "Test");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const pageIds = result.project.pages.map((p) => p.id);
      expect(new Set(pageIds).size).toBe(pageIds.length);
    });

    it("section IDs are unique within a project", () => {
      const result = create("template-saas", "Test");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const sectionIds = result.project.pages.flatMap((p) =>
        p.sections.map((s) => s.id),
      );
      expect(new Set(sectionIds).size).toBe(sectionIds.length);
    });
  });

  describe("deep independence", () => {
    it("two creations from the same template are fully independent", () => {
      const a = create("template-saas", "A");
      const b = create("template-saas", "B");
      expect(a.ok && b.ok).toBe(true);
      if (!a.ok || !b.ok) return;

      // Different project IDs
      expect(a.project.id).not.toBe(b.project.id);

      // Mutating A's theme must not affect B
      a.project.theme.palette.primary = "#ff0000";
      a.project.pages[0].sections[0].props.logoText = "Mutated";
      a.project.assets.push({} as never);

      expect(b.project.theme.palette.primary).not.toBe("#ff0000");
      expect(b.project.pages[0].sections[0].props.logoText).not.toBe("Mutated");
      expect(b.project.assets).toHaveLength(0);
    });

    it("created projects share nothing with the template definition", () => {
      const result = create("template-saas", "Test");
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      result.project.theme.palette.primary = "#123456";
      result.project.pages[0].sections = [];

      // Re-create and verify it is pristine
      const second = create("template-saas", "Test");
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(second.project.theme.palette.primary).not.toBe("#123456");
      expect(second.project.pages[0].sections.length).toBeGreaterThan(0);
    });

    it("theme objects are independent between creations", () => {
      const a = create("template-portfolio", "A");
      const b = create("template-portfolio", "B");
      expect(a.ok && b.ok).toBe(true);
      if (!a.ok || !b.ok) return;
      a.project.theme.palette.accent = "#111111";
      expect(b.project.theme.palette.accent).not.toBe("#111111");
    });

    it("asset arrays are independent between creations", () => {
      const a = create("template-saas", "A");
      const b = create("template-saas", "B");
      expect(a.ok && b.ok).toBe(true);
      if (!a.ok || !b.ok) return;
      expect(a.project.assets).not.toBe(b.project.assets);
    });
  });

  describe("content integrity", () => {
    it("has no runtime persistence fields embedded", () => {
      const result = create("template-saas", "Test");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const asRecord = result.project as unknown as Record<string, unknown>;
      expect("revision" in asRecord).toBe(false);
      expect("savedAt" in asRecord).toBe(false);
    });

    it("legacy unsupported props are absent", () => {
      const result = create("template-saas", "Test");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      for (const page of result.project.pages) {
        for (const section of page.sections) {
          const props = section.props as Record<string, unknown>;
          expect("children" in props).toBe(false);
        }
      }
    });

    it("links use the { text, href } model", () => {
      const result = create("template-agency", "Test");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      for (const page of result.project.pages) {
        for (const section of page.sections) {
          const props = section.props as Record<string, unknown>;
          for (const key of ["navLinks", "links"]) {
            const value = props[key];
            if (Array.isArray(value)) {
              for (const item of value) {
                expect(typeof item).toBe("object");
                expect(typeof (item as { text?: unknown }).text).toBe("string");
                expect(typeof (item as { href?: unknown }).href).toBe("string");
              }
            }
          }
        }
      }
    });
  });

  describe("injected idFactory", () => {
    it("uses the injected factory and not crypto when provided", () => {
      const calls: string[] = [];
      const spyFactory: TemplateIdFactory = {
        projectId: () => {
          calls.push("projectId");
          return "spy-proj";
        },
        pageId: (t, i) => {
          calls.push("pageId");
          return `spy-page-${i}`;
        },
        sectionId: (t, type, i) => {
          calls.push("sectionId");
          return `spy-sec-${i}`;
        },
      };
      const result = factory.createProjectFromTemplate({
        templateId: "template-blank",
        projectName: "Test",
        now: FIXED_NOW,
        idFactory: spyFactory,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.project.id).toBe("spy-proj");
      expect(calls).toContain("pageId");
      expect(calls).toContain("sectionId");
    });
  });
});
