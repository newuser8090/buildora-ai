// ---------------------------------------------------------------------------
// TemplateRegistry tests
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { TemplateRegistry } from "../registry/template-registry";
import {
  registerDefaultTemplates,
  resetTemplateRegistration,
} from "../registry/register-default-templates";
import { blankTemplate } from "../templates/blank-template";
import { saasTemplate } from "../templates/saas-template";
import { TemplateError } from "../types";
import { templateRegistry } from "../registry/template-registry";
import type { BuildoraTemplate } from "../types";
import type { Project } from "@/types/project";

function makeTemplate(overrides: Record<string, unknown> = {}): BuildoraTemplate {
  return {
    id: "template-test",
    name: "Test Template",
    description: "A test template.",
    category: "business" as const,
    tags: ["test"],
    defaultName: "Test",
    preview: { sections: [{ kind: "hero" as const, label: "Hero" }] },
    createProject: () => ({}) as unknown as Project,
    ...overrides,
  } as unknown as BuildoraTemplate;
}

describe("TemplateRegistry", () => {
  let registry: TemplateRegistry;

  beforeEach(() => {
    registry = new TemplateRegistry();
  });

  it("registers and retrieves a template", () => {
    registry.register(makeTemplate());
    expect(registry.get("template-test")?.name).toBe("Test Template");
  });

  it("list returns templates in deterministic registration order", () => {
    const a = makeTemplate({ id: "template-a", name: "A" });
    const b = makeTemplate({ id: "template-b", name: "B" });
    const c = makeTemplate({ id: "template-c", name: "C" });
    registry.register(c);
    registry.register(a);
    registry.register(b);

    expect(registry.list().map((t) => t.id)).toEqual([
      "template-c",
      "template-a",
      "template-b",
    ]);
  });

  it("rejects duplicate IDs with a structured DUPLICATE_TEMPLATE_ID error", () => {
    registry.register(makeTemplate());
    expect(() => registry.register(makeTemplate())).toThrowError(TemplateError);
    try {
      registry.register(makeTemplate());
    } catch (err) {
      expect((err as TemplateError).code).toBe("DUPLICATE_TEMPLATE_ID");
      expect((err as TemplateError).templateId).toBe("template-test");
    }
  });

  it("unregister removes a template", () => {
    registry.register(makeTemplate());
    registry.unregister("template-test");
    expect(registry.get("template-test")).toBeUndefined();
  });

  it("clear empties the registry", () => {
    registry.register(makeTemplate());
    registry.register(makeTemplate({ id: "template-two", name: "Two" }));
    registry.clear();
    expect(registry.list()).toHaveLength(0);
  });

  it("unknown template returns undefined", () => {
    expect(registry.get("does-not-exist")).toBeUndefined();
  });

  it("registry operations do not mutate registered templates", () => {
    const template = makeTemplate();
    registry.register(template);
    const before = JSON.stringify(template);
    registry.get("template-test");
    registry.list();
    registry.unregister("template-test");
    registry.register(template);
    expect(JSON.stringify(template)).toBe(before);
  });
});

describe("registerDefaultTemplates", () => {
  it("registers all default templates once", () => {
    resetTemplateRegistration();
    templateRegistry.clear();

    registerDefaultTemplates();
    const list = templateRegistry.list();
    const ids = list.map((t) => t.id);
    expect(ids).toContain("template-blank");
    expect(ids).toContain("template-saas");
    expect(ids).toContain("template-portfolio");
    expect(ids).toContain("template-agency");
    expect(ids).toContain("template-restaurant");
    expect(ids).toContain("template-ecommerce");
    expect(ids).toContain("template-startup");
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is idempotent — repeated calls do not duplicate or throw", () => {
    resetTemplateRegistration();
    templateRegistry.clear();

    registerDefaultTemplates();
    const firstCount = templateRegistry.list().length;
    expect(() => registerDefaultTemplates()).not.toThrow();
    expect(templateRegistry.list().length).toBe(firstCount);
  });

  it("Strict-Mode style double registration is safe", () => {
    resetTemplateRegistration();
    templateRegistry.clear();

    registerDefaultTemplates();
    registerDefaultTemplates();
    const ids = templateRegistry.list().map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("featured templates are identifiable in the default set", () => {
    resetTemplateRegistration();
    templateRegistry.clear();
    registerDefaultTemplates();

    const featured = templateRegistry.list().filter((t) => t.featured);
    expect(featured.length).toBeGreaterThan(0);
    expect(featured.map((t) => t.id)).toContain("template-blank");
    expect(featured.map((t) => t.id)).toContain("template-saas");
  });

  it("blank and saas fixtures are the registered instances", () => {
    resetTemplateRegistration();
    templateRegistry.clear();
    registerDefaultTemplates();

    expect(templateRegistry.get("template-blank")).toBe(blankTemplate);
    expect(templateRegistry.get("template-saas")).toBe(saasTemplate);
  });
});
