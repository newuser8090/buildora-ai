import { describe, expect, it } from "vitest";
import { TemplateProjectFactory } from "../services/template-project-factory";
import { TemplateRegistry } from "../registry/template-registry";
import { blankTemplate } from "../templates/blank-template";
import type { BuildoraTemplate, TemplateIdFactory } from "../types";

const ids: TemplateIdFactory = {
  projectId: () => "project-1",
  pageId: (_templateId, index) => `page-${index}`,
  sectionId: (_templateId, type, index) => `${type}-${index}`,
};

function makeTemplate(): BuildoraTemplate {
  return {
    ...blankTemplate,
    id: "template-custom-code-test",
    name: "Custom Code Test",
    createProject: (context) => {
      const project = blankTemplate.createProject(context);
      project.pages[0].sections.push({
        id: "custom-section",
        type: "custom-block",
        order: 99,
        visible: true,
        props: {
          name: "Custom",
          tree: {
            rootIds: ["heading-1"],
            nodes: {
              "heading-1": {
                id: "heading-1",
                type: "heading",
                parentId: null,
                children: [],
                props: { text: "Hello" },
                style: {},
                responsive: {},
                visible: true,
                locked: false,
                hidden: false,
                customCode: { enabled: true, html: "<div>unsafe</div>", css: ".x{}", js: "alert(1)" },
              },
            },
          },
        },
        styles: {},
      } as never);
      return project;
    },
  };
}

describe("P23-E template boundary", () => {
  it("strips customCode from template-created projects", () => {
    const registry = new TemplateRegistry();
    registry.register(makeTemplate());
    const factory = new TemplateProjectFactory({ registry });

    const result = factory.createProjectFromTemplate({
      templateId: "template-custom-code-test",
      projectName: "Test",
      now: "2026-08-01T00:00:00.000Z",
      idFactory: ids,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const section = result.project.pages[0].sections.find((item) => item.id === "custom-section");
    expect(section).toBeDefined();
    const tree = (section?.props as { tree: { nodes: Record<string, Record<string, unknown>> } }).tree;
    expect(tree.nodes["heading-1"].customCode).toBeUndefined();
  });
});
