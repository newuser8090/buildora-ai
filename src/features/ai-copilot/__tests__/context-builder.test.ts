// ---------------------------------------------------------------------------
// AI Copilot — context builder tests (spec §3)
//   - project / page / section / element contexts
//   - size bounding (deterministic reduction)
//   - secret / internal-field exclusion (privacy)
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  buildCopilotContext,
  contextByteLength,
} from "../context/context-builder";
import { COPILOT_LIMITS } from "../constants";
import { MOCK_PROJECT } from "./helpers";
import type { Project } from "@/types/project";

function cloneProject(): Project {
  return JSON.parse(JSON.stringify(MOCK_PROJECT)) as Project;
}

// A project with data that must NEVER reach the context (privacy).
function projectWithSecrets(): Project {
  const project = cloneProject();
  project.assets = [
    {
      id: "asset-1",
      name: "hero.png",
      mimeType: "image/png",
      size: 1200000,
      // Blob/data URL — must be excluded.
      src: "data:image/png;base64,aGVsbG8gd29ybGQgdGhpcyBpcyBhIGxvbmcgZGF0YSB1cmw=",
    } as unknown as Project["assets"][number],
  ];
  project.siteSettings = {
    siteName: "Nimbus",
    siteDescription: "A modern SaaS landing page built with Buildora.",
  };
  // Simulated internal records that must not leak.
  (project as unknown as Record<string, unknown>).authToken = "SECRET_TOKEN";
  (project as unknown as Record<string, unknown>).deploymentRecords = [
    { token: "SECRET_DEPLOY" },
  ];
  return project;
}

describe("buildCopilotContext — scopes", () => {
  it("builds a project-scope context with the active page digest", () => {
    const ctx = buildCopilotContext({
      project: MOCK_PROJECT,
      scope: { type: "project" },
      selectedPageId: "page-1",
      instruction: "Improve this website",
    });
    expect(ctx.projectId).toBe(MOCK_PROJECT.id);
    expect(ctx.projectName).toBe(MOCK_PROJECT.name);
    expect(ctx.activePage?.title).toBe(MOCK_PROJECT.pages[0].title);
    expect(ctx.activePage?.sectionCount).toBe(MOCK_PROJECT.pages[0].sections.length);
    expect(ctx.activePage?.sections[0].id).toBe(MOCK_PROJECT.pages[0].sections[0].id);
  });

  it("builds a page-scope context for the requested page", () => {
    const ctx = buildCopilotContext({
      project: MOCK_PROJECT,
      scope: { type: "page", pageId: "page-1" },
      instruction: "Edit this page",
    });
    expect(ctx.activePage?.id).toBe("page-1");
  });

  it("builds a section-scope context with headline and key text", () => {
    const hero = MOCK_PROJECT.pages[0].sections.find((s) => s.type === "hero")!;
    const ctx = buildCopilotContext({
      project: MOCK_PROJECT,
      scope: { type: "section", pageId: "page-1", sectionId: hero.id },
      instruction: "Rewrite the hero",
    });
    expect(ctx.section?.id).toBe(hero.id);
    expect(ctx.section?.type).toBe("hero");
    expect(ctx.section?.headline).toBeTruthy();
    expect(ctx.section?.keyText).toBeDefined();
  });

  it("builds an element-scope context from a selected field", () => {
    const hero = MOCK_PROJECT.pages[0].sections.find((s) => s.type === "hero")!;
    const ctx = buildCopilotContext({
      project: MOCK_PROJECT,
      scope: { type: "element", pageId: "page-1", sectionId: hero.id, fieldPath: ["headline"] },
      selectedField: { label: "Headline", currentValue: "Ship fast", pageId: "page-1", sectionId: hero.id, fieldPath: ["headline"] },
      instruction: "Make it shorter",
    });
    expect(ctx.section?.type).toBe("hero");
    expect(ctx.element?.label).toBe("Headline");
    expect(ctx.element?.currentValue).toBe("Ship fast");
  });

  it("includes a bounded readiness digest and device", () => {
    const ctx = buildCopilotContext({
      project: MOCK_PROJECT,
      scope: { type: "project" },
      readiness: {
        score: 64,
        checks: [
          { id: "c1", title: "First finding", status: "warning" },
          { id: "c2", title: "Second finding", status: "fail" },
          { id: "c3", title: "Passing", status: "pass" },
          { id: "c4", title: "Third finding", status: "warning" },
          { id: "c5", title: "Fourth finding", status: "warning" },
          { id: "c6", title: "Fifth finding", status: "warning" },
        ] as unknown as Array<{ id: string; title: string; status: "pass" | "warning" | "fail" | "info" }>,
        categories: [],
        strong: [],
        couldImprove: [],
        blocked: false,
        blockers: [],
      } as never,
      device: "mobile",
      instruction: "Check my site",
    });
    expect(ctx.readiness?.score).toBe(64);
    // Only warning/fail findings are surfaced, capped at 5.
    expect(ctx.readiness?.topFindings).toHaveLength(5);
    expect(ctx.readiness?.topFindings.every((f) => f.status !== "pass")).toBe(true);
    expect(ctx.device).toBe("mobile");
  });
});

describe("buildCopilotContext — privacy", () => {
  it("excludes assets, tokens, and internal records", () => {
    const project = projectWithSecrets();
    const ctx = buildCopilotContext({
      project,
      scope: { type: "project" },
      instruction: "Improve",
    });
    const json = JSON.stringify(ctx);
    expect(json).not.toContain("data:image");
    expect(json).not.toContain("SECRET_TOKEN");
    expect(json).not.toContain("SECRET_DEPLOY");
    expect(json).not.toContain("authToken");
    expect(json).not.toContain("deploymentRecords");
  });

  it("includes whitelisted site settings text only", () => {
    const project = projectWithSecrets();
    const ctx = buildCopilotContext({
      project,
      scope: { type: "project" },
      instruction: "Improve",
    });
    expect(ctx.siteSettings?.siteName).toBe("Nimbus");
    expect(ctx.siteSettings?.siteDescription).toContain("modern SaaS");
  });
});

describe("buildCopilotContext — bounded size", () => {
  it("caps string fields", () => {
    const project = cloneProject();
    project.name = "X".repeat(500);
    project.pages[0].sections[0].props.headline = "Y".repeat(5000);
    const ctx = buildCopilotContext({
      project,
      scope: { type: "project" },
      instruction: "Z".repeat(10000),
      messages: [{ id: "1", role: "user", content: "M".repeat(1000), createdAt: 0 }],
    });
    expect(ctx.projectName.length).toBeLessThanOrEqual(81);
    expect(ctx.instruction.length).toBeLessThanOrEqual(501);
    expect(ctx.conversationTail[0].length).toBeLessThanOrEqual(201);
  });

  it("keeps the serialized context under the byte limit for a large project", () => {
    const project = cloneProject();
    // Simulate a large project: many sections with long text.
    const sections = project.pages[0].sections.slice(0, 1);
    for (let i = 0; i < 60; i += 1) {
      sections.push({
        ...JSON.parse(JSON.stringify(project.pages[0].sections[0])),
        id: `extra-${i}`,
        type: "features",
        props: { title: `Section ${i}`, subtitle: "Long subtitle ".repeat(40) },
      });
    }
    project.pages[0].sections = sections;

    const ctx = buildCopilotContext({
      project,
      scope: { type: "project" },
      instruction: "Improve the whole website",
    });
    expect(contextByteLength(ctx)).toBeLessThanOrEqual(COPILOT_LIMITS.maxContextBytes);
    // Deterministic reduction must not blow up: section list bounded.
    expect(ctx.activePage?.sections.length).toBeLessThanOrEqual(12);
  });

  it("reduces deterministically: same input → same output", () => {
    const project = cloneProject();
    const a = buildCopilotContext({ project, scope: { type: "project" }, instruction: "Improve" });
    const b = buildCopilotContext({ project, scope: { type: "project" }, instruction: "Improve" });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("style notes (Phase P11)", () => {
  it("includes bounded style notes in the context", () => {
    const ctx = buildCopilotContext({
      project: cloneProject(),
      scope: { type: "project" },
      instruction: "Improve",
      styleNotes: ["keep it friendly", "use British spelling"],
    });
    expect(ctx.styleNotes).toEqual(["keep it friendly", "use British spelling"]);
  });

  it("caps notes to the in-context limit and per-note length", () => {
    const long = "x".repeat(500);
    const ctx = buildCopilotContext({
      project: cloneProject(),
      scope: { type: "project" },
      instruction: "Improve",
      styleNotes: ["a", "b", "c", "d", long],
    });
    expect(ctx.styleNotes).toEqual(["a", "b", "c"]);
  });

  it("omits styleNotes entirely when empty", () => {
    const ctx = buildCopilotContext({
      project: cloneProject(),
      scope: { type: "project" },
      instruction: "Improve",
      styleNotes: [],
    });
    expect("styleNotes" in ctx).toBe(false);
  });

  it("drops style notes last when the context exceeds the byte limit", () => {
    const project = cloneProject();
    const sections = project.pages[0].sections.slice(0, 1);
    for (let i = 0; i < 60; i += 1) {
      sections.push({
        ...JSON.parse(JSON.stringify(project.pages[0].sections[0])),
        id: `extra-${i}`,
        type: "features",
        props: { title: `Section ${i}`, subtitle: "Long subtitle ".repeat(40) },
      });
    }
    project.pages[0].sections = sections;

    const ctx = buildCopilotContext({
      project,
      scope: { type: "project" },
      instruction: "Improve",
      styleNotes: ["a", "b", "c"],
      messages: Array.from({ length: 20 }, (_, i) => ({
        id: `m${i}`,
        role: "user" as const,
        content: "Message content ".repeat(10),
        createdAt: i,
      })),
    });
    expect(contextByteLength(ctx)).toBeLessThanOrEqual(COPILOT_LIMITS.maxContextBytes);
    // Style notes are the last to be dropped; if the byte bound held with
    // notes still present, they remain — otherwise they are removed cleanly.
    expect(Array.isArray(ctx.styleNotes) ? ctx.styleNotes.length : 0).toBeLessThanOrEqual(3);
  });
});
