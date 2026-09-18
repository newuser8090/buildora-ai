// ---------------------------------------------------------------------------
// Phase P22-G — export parity for animations + interactions
//   - the generated custom-block component carries animation + interaction
//     fields on BlockNode
//   - animation keyframes CSS is emitted (fade/slide/scale/bounce/reveal/
//     blur/rotate)
//   - reduced-motion handling exists in the generated CSS
//   - safe click navigation is emitted (no raw user JS, no unsafe hrefs)
//   - scroll-to runtime helper is bounded and known
//   - hover/focus effect CSS is emitted
//   - page routes are passed to the CustomBlock component
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import type { Project } from "@/types/project";
import { MOCK_PROJECT } from "@/features/editor/mock/mock-project";
import { generateCustomBlockComponent } from "../generators/section-generators/custom-block-generator";
import { generatePageFile } from "../generators/page-generator";
import { computePageRoutes } from "@/features/routing/routes";

describe("generateCustomBlockComponent — P22-G emission", () => {
  const code = generateCustomBlockComponent().content;

  it("carries animation + interaction on the BlockNode interface", () => {
    expect(code).toContain("animation?: {");
    expect(code).toContain("interaction?: {");
    // Phase P24-C closeout — the declaration is deliberately WIDER than the
    // kinds this runtime resolves, so a tree emitted from the editor with the
    // full P22-G interaction vocabulary still type-checks in the generated
    // site (formId / handlerId / offset / speed / nested animations). These
    // assertions therefore check the DECLARED MEMBERS rather than one-line
    // formatting, which would break on every faithful widening of the type.
    expect(code).toContain("click?: {");
    expect(code).toContain("hover?: {");
    expect(code).toContain("focus?: {");
    expect(code).toContain("scroll?: {");
    // P22-G members still present on the interaction surface.
    expect(code).toContain("target?: Record<string, unknown>;");
    expect(code).toContain("elementId?: string;");
    expect(code).toContain("scale?: number;");
    expect(code).toContain("shadow?: string;");
    // P24-C widening — the remaining authored interaction targets.
    expect(code).toContain("formId?: string;");
    expect(code).toContain("handlerId?: string;");
    expect(code).toContain("offset?: number;");
    expect(code).toContain("speed?: number;");
  });

  it("emits keyframes for every supported preset", () => {
    for (const preset of ["fade", "slide", "scale", "bounce", "reveal", "blur", "rotate"]) {
      expect(code).toContain(`@keyframes ba-${preset}`);
    }
    // custom is never emitted
    expect(code).not.toContain("@keyframes ba-custom");
  });

  it("emits the reduced-motion guard", () => {
    expect(code).toContain("prefers-reduced-motion: reduce");
    expect(code).toContain("data-ba-anim=\\\"load\\\"");
    expect(code).toContain("animation: none !important");
  });

  it("emits safe navigation resolution (no raw user JS)", () => {
    expect(code).toContain("baIsSafeNav");
    expect(code).toContain("javascript:");
    expect(code).not.toContain("eval(");
    expect(code).not.toContain("new Function");
  });

  it("emits the bounded scroll-to runtime helper", () => {
    expect(code).toContain("function baScrollTo");
    expect(code).toContain("scrollIntoView");
  });

  it("emits hover/focus effect rule builders", () => {
    expect(code).toContain(":hover");
    expect(code).toContain(":focus-visible");
    expect(code).toContain("baEffectRule");
  });

  it("emits the reveal IntersectionObserver", () => {
    expect(code).toContain("IntersectionObserver");
    expect(code).toContain("data-ba-reveal");
    expect(code).toContain("ba-reveal-in");
  });

  it("keeps all P22-F viewport parity markers", () => {
    expect(code).toContain("TABLET_MAX_WIDTH = 1024");
    expect(code).toContain("MOBILE_MAX_WIDTH = 768");
    expect(code).toContain("viewportOverrides");
    expect(code).toContain("Object.assign(merged, viewportOverrides(viewport, width));");
  });
});

describe("generatePageFile — P22-G routes reach the exported component", () => {
  it("passes the page route map to CustomBlock", () => {
    const project: Project = {
      ...MOCK_PROJECT,
      pages: [
        {
          id: "home",
          title: "Home",
          slug: "/",
          sections: [
            {
              id: "cb-1",
              type: "custom-block",
              order: 1,
              visible: true,
              props: {
                name: "Design",
                tree: {
                  rootIds: ["cb-1"],
                  nodes: {
                    "cb-1": {
                      id: "cb-1",
                      type: "container",
                      parentId: null,
                      children: ["b1"],
                      props: {},
                      style: {},
                      responsive: {},
                      animation: { trigger: "load", type: "fade", durationMs: 400 },
                      interaction: {
                        click: { kind: "navigate", target: { kind: "page", pageId: "home" } },
                      },
                      visible: true,
                      locked: false,
                      hidden: false,
                    },
                    b1: {
                      id: "b1",
                      type: "heading",
                      parentId: "cb-1",
                      children: [],
                      props: { text: "Hi" },
                      style: {},
                      responsive: {},
                      visible: true,
                      locked: false,
                      hidden: false,
                    },
                  },
                },
              },
              styles: {},
            },
          ],
        },
      ],
    };
    const routes = computePageRoutes(project.pages);
    const file = generatePageFile(project, project.pages[0], routes);
    expect(file.content).toContain('<CustomBlock key="cb-1"');
    // The typed NavTarget + animation data serialize into the tree props.
    expect(file.content).toContain('"animation":');
    expect(file.content).toContain('"interaction":');
    expect(file.content).toContain('"kind":"navigate"');
    // The route map resolves NavTargets in the exported site.
    expect(file.content).toContain('routes={{"home":"/"}}');
  });
});
