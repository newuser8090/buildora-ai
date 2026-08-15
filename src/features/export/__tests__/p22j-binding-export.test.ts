// ---------------------------------------------------------------------------
// Phase P22-J — static snapshot export
//   - resolved values are baked into the generated site (no runtime fetch)
//   - unresolved bindings keep their static fallback
//   - dangling collection references are rejected by the export validator
//   - untrusted record data can never become executable code
//   - no secrets/client credentials are emitted
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import type { Project } from "@/types/project";
import type { ElementTree } from "@/features/elements/types";
import { resolveProjectBindingsForExport } from "@/features/elements/binding/resolve";
import { generatePageRoutes } from "../generators/page-generator";
import { validateProjectForExport } from "../validators/export-validator";

function makeProject(overrides?: Partial<Omit<Project, "pages">> & { pages?: Project["pages"] }): Project {
  return {
    id: "proj-p22j-export",
    name: "P22J Export",
    theme: {
      palette: {
        background: "#fff", foreground: "#0a0a0a", primary: "#7c5cfc",
        primaryForeground: "#fff", secondary: "#f5f5f5", secondaryForeground: "#0a0a0a",
        muted: "#f5f5f5", mutedForeground: "#737373", accent: "#7c5cfc",
        accentForeground: "#fff", border: "#e5e5e5", card: "#fff", cardForeground: "#000",
      },
      typography: { fontFamily: "Geist", headingFont: "Geist", baseSize: "16px", scale: 1.25 },
      spacing: { sectionPadding: "6rem 0", containerMaxWidth: "1120px", gap: "1.5rem" },
      radius: { sm: "0.375rem", md: "0.5rem", lg: "0.75rem", xl: "1rem", full: "9999px" },
      shadows: { sm: "0 1px 2px rgba(0,0,0,0.05)", md: "0 4px 6px rgba(0,0,0,0.07)", lg: "0 10px 15px rgba(0,0,0,0.1)", xl: "0 20px 25px rgba(0,0,0,0.15)" },
    },
    assets: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...(overrides as Partial<Project>),
  } as Project;
}

function customBlockProject(binding: Record<string, unknown> | undefined): Project {
  const tree: ElementTree = {
    rootIds: ["root"],
    nodes: {
      root: {
        id: "root",
        type: "container",
        parentId: null,
        children: ["h1"],
        props: {},
        style: {},
        responsive: {},
        visible: true,
        locked: false,
        hidden: false,
      },
      h1: {
        id: "h1",
        type: "heading",
        parentId: "root",
        children: [],
        props: { text: "Fallback heading" },
        style: {},
        responsive: {},
        visible: true,
        locked: false,
        hidden: false,
        ...(binding ? { binding: binding as never } : {}),
      },
    },
  };
  return makeProject({
    collections: [
      { id: "products", name: "Products", fields: [{ id: "f1", name: "name", type: "text" }] },
    ],
    pages: [
      {
        id: "page-1",
        title: "Home",
        slug: "/",
        sections: [
          {
            id: "s-custom",
            type: "custom-block",
            order: 1,
            visible: true,
            props: { name: "Design", tree },
            styles: {},
          },
        ],
      },
    ],
  });
}

describe("static snapshot export — baked values", () => {
  it("bakes resolved values into the generated page and removes the binding", () => {
    const project = customBlockProject({
      source: "collection",
      collectionId: "products",
      path: "name",
      field: "text",
    });
    const resolved = resolveProjectBindingsForExport(project, {
      products: [{ id: "p1", name: "Nimbus Pro" }],
    });
    const files = generatePageRoutes(resolved);
    const home = files.find((f) => f.path === "app/page.tsx");
    expect(home).toBeDefined();
    expect(home!.content).toContain("Nimbus Pro");
    // The binding metadata is gone from the exported payload (static snapshot).
    expect(home!.content).not.toContain('"binding"');
  });

  it("keeps the static fallback for unresolved bindings", () => {
    const project = customBlockProject({
      source: "collection",
      collectionId: "products",
      path: "ghost",
      field: "text",
    });
    const resolved = resolveProjectBindingsForExport(project, {
      products: [{ id: "p1", name: "Nimbus Pro" }],
    });
    const files = generatePageRoutes(resolved);
    const home = files.find((f) => f.path === "app/page.tsx");
    expect(home!.content).toContain("Fallback heading");
    expect(home!.content).not.toContain("Nimbus Pro");
  });

  it("unbound custom blocks export exactly as before (no change)", () => {
    const project = customBlockProject(undefined);
    const resolved = resolveProjectBindingsForExport(project, {});
    const files = generatePageRoutes(resolved);
    const home = files.find((f) => f.path === "app/page.tsx");
    expect(home!.content).toContain("Fallback heading");
  });
});

describe("export validator — dangling collection references", () => {
  it("rejects a binding to a missing collection", () => {
    const project = customBlockProject({
      source: "collection",
      collectionId: "ghost",
      path: "name",
      field: "text",
    });
    const validation = validateProjectForExport(project);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((e) => e.includes("missing collection"))).toBe(true);
  });

  it("accepts a binding to an existing collection", () => {
    const project = customBlockProject({
      source: "collection",
      collectionId: "products",
      path: "name",
      field: "text",
    });
    const validation = validateProjectForExport(project);
    expect(validation.valid).toBe(true);
  });

  it("ignores non-collection bindings (future sources are not dangling)", () => {
    const project = customBlockProject({ source: "page", path: "title", field: "text" });
    const validation = validateProjectForExport(project);
    expect(validation.valid).toBe(true);
  });
});

describe("security — untrusted data cannot become executable code", () => {
  it("bakes a javascript: value only as inert data (image safety gate)", () => {
    const project = customBlockProject({
      source: "collection",
      collectionId: "products",
      path: "src",
      field: "src",
    });
    const resolved = resolveProjectBindingsForExport(project, {
      products: [{ id: "p1", src: "javascript:alert(1)" }],
    });
    const tree = (resolved.pages[0].sections[0].props as { tree: ElementTree }).tree;
    // The unsafe value is rejected at resolve time → static fallback kept.
    expect(tree.nodes.h1.props.src).toBeUndefined();
  });

  it("never emits eval / new Function / dangerouslySetInnerHTML for record data", () => {
    const project = customBlockProject({
      source: "collection",
      collectionId: "products",
      path: "name",
      field: "text",
    });
    const resolved = resolveProjectBindingsForExport(project, {
      products: [{ id: "p1", name: "x".repeat(10), extra: { deep: true } }],
    });
    const files = generatePageRoutes(resolved);
    const home = files.find((f) => f.path === "app/page.tsx");
    expect(home!.content).not.toMatch(/eval\s*\(/);
    expect(home!.content).not.toContain("new Function");
    expect(home!.content).not.toContain("dangerouslySetInnerHTML");
  });

  it("never emits secrets or client credentials", () => {
    const project = customBlockProject({
      source: "collection",
      collectionId: "products",
      path: "name",
      field: "text",
    });
    const resolved = resolveProjectBindingsForExport(project, {
      products: [
        {
          id: "p1",
          name: "Nimbus Pro",
          serviceRoleKey: "sb_secret_do_not_leak",
          password: "hunter2",
        },
      ],
    });
    const files = generatePageRoutes(resolved);
    const all = files.map((f) => f.content).join("\n");
    expect(all).not.toContain("sb_secret_do_not_leak");
    expect(all).not.toContain("hunter2");
    expect(all).not.toContain("service-role");
  });

  it("treats HTML-bearing record data as inert escaped text, never live markup", () => {
    const project = customBlockProject({
      source: "collection",
      collectionId: "products",
      path: "name",
      field: "text",
    });
    const payload = '<img src=x onerror="alert(1)">' + "{unsafe}";
    const resolved = resolveProjectBindingsForExport(project, {
      products: [{ id: "p1", name: payload }],
    });
    const files = generatePageRoutes(resolved);
    const home = files.find((f) => f.path === "app/page.tsx");
    expect(home).toBeDefined();
    // The baked value cannot break out of the generated string context:
    // every double quote is JSON-escaped, so the raw payload (with live
    // unescaped quotes) can never appear verbatim in the generated file.
    expect(home!.content).not.toContain('onerror="alert(1)"');
    // And the exported CustomBlock component is a fixed known runtime — no
    // dangerouslySetInnerHTML, no script emission.
    expect(home!.content).not.toContain("dangerouslySetInnerHTML");
  });
});
