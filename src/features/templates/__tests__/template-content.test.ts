// ---------------------------------------------------------------------------
// Default template content tests
//
// For every default template: expected section types, expected order, visible
// sections, no unsupported section types, all props validate, all links use
// the { text, href } model, no empty required headings, no placeholder/lorem
// text, no duplicate section IDs, no object values rendered as direct text.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { TemplateProjectFactory } from "../services/template-project-factory";
import { templateRegistry } from "../registry/template-registry";
import {
  registerDefaultTemplates,
  resetTemplateRegistration,
} from "../registry/register-default-templates";
import { ProjectSchema } from "@/features/generation/schemas/generation-plan-schema";
import { useEditorStore } from "@/features/editor/store/editor-store";
import type { TemplateIdFactory } from "../types";
import type { Project } from "@/types/project";

// ---------------------------------------------------------------------------
// Deterministic ID factory
// ---------------------------------------------------------------------------

function deterministicIdFactory(): TemplateIdFactory {
  let n = 0;
  return {
    projectId: () => `proj-${++n}`,
    pageId: (t, i) => `${t}-page-${i}`,
    sectionId: (t, type, i) => `${t}-${type}-${i}`,
  };
}

// ---------------------------------------------------------------------------
// Expected structures per template
// ---------------------------------------------------------------------------

const EXPECTED_SECTIONS: Record<string, string[]> = {
  "template-blank": ["hero"],
  "template-saas": ["header", "hero", "features", "pricing", "faq", "cta", "footer"],
  "template-startup": ["header", "hero", "features", "faq", "cta", "footer"],
  "template-portfolio": ["header", "hero", "features", "cta", "footer"],
  "template-agency": ["header", "hero", "features", "faq", "cta", "footer"],
  "template-restaurant": ["header", "hero", "features", "cta", "footer"],
  "template-ecommerce": ["header", "hero", "features", "pricing", "cta", "footer"],
  "template-event": ["header", "hero", "features", "faq", "cta", "footer"],
  "template-personal": ["header", "hero", "features", "features", "features", "cta", "footer"],
};

const SUPPORTED_SECTION_TYPES = new Set([
  "header",
  "hero",
  "features",
  "pricing",
  "faq",
  "cta",
  "footer",
]);

const PLACEHOLDER_PATTERNS = [
  /lorem/i,
  /ipsum/i,
  /\bYour Company\b/i,
  /\bFeature 1\b/i,
  /\bYOUR NAME\b/i,
  /\bTODO\b/i,
  /\bXXX\b/i,
];

describe("default template content", () => {
  let factory: TemplateProjectFactory;

  beforeEach(() => {
    resetTemplateRegistration();
    templateRegistry.clear();
    registerDefaultTemplates();
    factory = new TemplateProjectFactory();
  });

  const allTemplates = () => templateRegistry.list();
  const ids = () => allTemplates().map((t) => t.id);

  const createProject = (templateId: string): Project => {
    const result = factory.createProjectFromTemplate({
      templateId,
      projectName: "Test Project",
      now: "2026-08-01T00:00:00.000Z",
      idFactory: deterministicIdFactory(),
    });
    if (!result.ok) throw new Error(`Template ${templateId} failed: ${result.error.message}`);
    return result.project;
  };

  it("has at least the six required default templates", () => {
    const list = ids();
    for (const required of [
      "template-blank",
      "template-saas",
      "template-portfolio",
      "template-agency",
      "template-restaurant",
      "template-ecommerce",
    ]) {
      expect(list).toContain(required);
    }
  });

  it("each template matches its expected section types in order", () => {
    for (const template of allTemplates()) {
      const project = createProject(template.id);
      const types = project.pages[0].sections.map((s) => s.type);
      expect(types, template.id).toEqual(EXPECTED_SECTIONS[template.id]);
    }
  });

  it("uses only supported section types", () => {
    for (const template of allTemplates()) {
      const project = createProject(template.id);
      for (const section of project.pages.flatMap((p) => p.sections)) {
        expect(SUPPORTED_SECTION_TYPES.has(section.type), `${template.id}: ${section.type}`).toBe(true);
      }
    }
  });

  it("sections are visible and ordered starting at 1", () => {
    for (const template of allTemplates()) {
      const project = createProject(template.id);
      const sections = [...project.pages[0].sections].sort((a, b) => a.order - b.order);
      sections.forEach((section, index) => {
        expect(section.visible, `${template.id}: ${section.id}`).toBe(true);
        expect(section.order, `${template.id}: ${section.id}`).toBe(index + 1);
      });
    }
  });

  it("has no duplicate section IDs within a project", () => {
    for (const template of allTemplates()) {
      const project = createProject(template.id);
      const ids_ = project.pages.flatMap((p) => p.sections.map((s) => s.id));
      expect(new Set(ids_).size, template.id).toBe(ids_.length);
    }
  });

  it("every template project passes the Project schema", () => {
    for (const template of allTemplates()) {
      const project = createProject(template.id);
      const parsed = ProjectSchema.safeParse(project);
      expect(parsed.success, template.id).toBe(true);
    }
  });

  it("normalizes through the editor store without errors", () => {
    // hydrateProject normalizes assets; template projects must be compatible.
    for (const template of allTemplates()) {
      const project = createProject(template.id);
      expect(() => useEditorStore.getState().initProject(project)).not.toThrow();
    }
  });

  it("links use the { text, href } model everywhere", () => {
    for (const template of allTemplates()) {
      const project = createProject(template.id);
      for (const page of project.pages) {
        for (const section of page.sections) {
          const props = section.props as Record<string, unknown>;
          for (const key of ["navLinks", "links"]) {
            const value = props[key];
            if (Array.isArray(value)) {
              for (const item of value) {
                expect(typeof item, `${template.id}: ${key}`).toBe("object");
                const linkItem = item as { text?: unknown; href?: unknown };
                expect(typeof linkItem.text, `${template.id}: ${key}`).toBe("string");
                expect(
                  (linkItem.text as string).length,
                  `${template.id}: ${key}`,
                ).toBeGreaterThan(0);
                expect(typeof linkItem.href, `${template.id}: ${key}`).toBe("string");
              }
            }
          }
          if (typeof props.primaryCta === "object" && props.primaryCta !== null) {
            const cta = props.primaryCta as { text?: unknown; href?: unknown };
            expect(typeof cta.text, template.id).toBe("string");
            expect(typeof cta.href, template.id).toBe("string");
          }
          if (typeof props.secondaryCta === "object" && props.secondaryCta !== null) {
            const cta = props.secondaryCta as { text?: unknown; href?: unknown };
            expect(typeof cta.text, template.id).toBe("string");
            expect(typeof cta.href, template.id).toBe("string");
          }
          // CTA sections: ctaText must be a plain string, not an object.
          if (section.type === "cta") {
            expect(typeof props.ctaText, template.id).toBe("string");
          }
        }
      }
    }
  });

  it("has no empty required headings", () => {
    for (const template of allTemplates()) {
      const project = createProject(template.id);
      for (const section of project.pages.flatMap((p) => p.sections)) {
        const props = section.props as Record<string, unknown>;
        const headingKeys = ["headline", "title"];
        for (const key of headingKeys) {
          if (typeof props[key] === "string") {
            expect((props[key] as string).trim().length, `${template.id}: ${section.type}.${key}`).toBeGreaterThan(0);
          }
        }
        // Features
        if (section.type === "features" && Array.isArray(props.features)) {
          for (const feature of props.features as { title?: unknown }[]) {
            expect(typeof feature.title, template.id).toBe("string");
            expect((feature.title as string).trim().length, template.id).toBeGreaterThan(0);
          }
        }
        // Pricing plans
        if (section.type === "pricing" && Array.isArray(props.plans)) {
          for (const plan_ of props.plans as { name?: unknown }[]) {
            expect(typeof plan_.name, template.id).toBe("string");
            expect((plan_.name as string).trim().length, template.id).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it("has no placeholder or lorem text", () => {
    for (const template of allTemplates()) {
      const project = createProject(template.id);
      const json = JSON.stringify(project);
      for (const pattern of PLACEHOLDER_PATTERNS) {
        expect(pattern.test(json), `${template.id}: ${pattern}`).toBe(false);
      }
    }
  });

  it("has no object values rendered as direct text fields", () => {
    for (const template of allTemplates()) {
      const project = createProject(template.id);
      for (const section of project.pages.flatMap((p) => p.sections)) {
        const props = section.props as Record<string, unknown>;
        // ctaText, logoText, headline, title, subheadline, text must be strings.
        for (const key of ["ctaText", "logoText", "headline", "title", "subheadline", "text", "ctaHref"]) {
          if (key in props) {
            expect(typeof props[key], `${template.id}: ${section.type}.${key}`).toBe("string");
          }
        }
      }
    }
  });

  it("every created project has fresh timestamps from the injected clock", () => {
    for (const template of allTemplates()) {
      const project = createProject(template.id);
      expect(project.createdAt).toBe("2026-08-01T00:00:00.000Z");
      expect(project.updatedAt).toBe("2026-08-01T00:00:00.000Z");
    }
  });
});
