// ---------------------------------------------------------------------------
// Publishing — deterministic hashing tests (Phase P7)
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { contentHashOfProject, hashExportFiles } from "../services/hash";
import type { Project } from "@/types/project";
import type { OutputFile } from "@/features/export/pipeline/types";

function makeProject(overrides?: Partial<Project>): Project {
  return {
    id: "proj-1",
    name: "Test",
    theme: {
      palette: {
        background: "#fff", foreground: "#000", primary: "#7c5cfc",
        primaryForeground: "#fff", secondary: "#f5f5f5", secondaryForeground: "#000",
        muted: "#f5f5f5", mutedForeground: "#737373", accent: "#7c5cfc",
        accentForeground: "#fff", border: "#e5e5e5", card: "#fff", cardForeground: "#000",
      },
      typography: { fontFamily: "sans-serif", headingFont: "sans-serif", baseSize: "16px", scale: 1.25 },
      spacing: { sectionPadding: "5rem 0", containerMaxWidth: "1120px", gap: "1.5rem" },
      radius: { sm: "0.375rem", md: "0.5rem", lg: "0.75rem", xl: "1rem", full: "9999px" },
      shadows: { sm: "0 1px 2px rgba(0,0,0,0.05)", md: "0 4px 6px rgba(0,0,0,0.07)", lg: "0 10px 15px rgba(0,0,0,0.1)", xl: "0 20px 25px rgba(0,0,0,0.15)" },
    },
    assets: [],
    pages: [
      {
        id: "p1", title: "Home", slug: "/",
        sections: [
          { id: "s1", type: "hero", order: 1, visible: true, props: { headline: "Hello" }, styles: {} },
        ],
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("contentHashOfProject", () => {
  it("is deterministic for identical projects", () => {
    const a = contentHashOfProject(makeProject());
    const b = contentHashOfProject(makeProject());
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it("changes when content changes", () => {
    const base = makeProject();
    const edited = makeProject();
    edited.pages[0].sections[0].props.headline = "Hello world";
    expect(contentHashOfProject(base)).not.toBe(contentHashOfProject(edited));
  });

  it("is insensitive to top-level key insertion order", () => {
    const project = makeProject();
    const a = contentHashOfProject(project);
    const reordered = {} as Record<string, unknown>;
    const keys = Object.keys(project).sort((x, y) => (x < y ? 1 : -1)); // reverse order
    for (const key of keys) {
      reordered[key] = project[key as keyof Project];
    }
    expect(contentHashOfProject(reordered as unknown as Project)).toBe(a);
  });

  it("does not mutate the project", () => {
    const project = makeProject();
    const before = JSON.stringify(project);
    contentHashOfProject(project);
    expect(JSON.stringify(project)).toBe(before);
  });

  it("is stable across calls with the same session data", () => {
    const project = makeProject();
    expect(contentHashOfProject(project)).toBe(contentHashOfProject(project));
  });
});

describe("hashExportFiles", () => {
  function files(): OutputFile[] {
    return [
      { path: "index.html", content: "<html>a</html>" },
      { path: "about.html", content: "<html>b</html>" },
    ];
  }

  it("is deterministic for identical file sets", () => {
    expect(hashExportFiles(files())).toBe(hashExportFiles(files()));
  });

  it("is independent of file order", () => {
    const sorted = files();
    const reversed = [...sorted].reverse();
    expect(hashExportFiles(sorted)).toBe(hashExportFiles(reversed));
  });

  it("changes when file content changes", () => {
    const changed = files();
    changed[0] = { ...changed[0], content: "<html>changed</html>" };
    expect(hashExportFiles(changed)).not.toBe(hashExportFiles(files()));
  });

  it("changes when the file set changes", () => {
    const fewer = files().slice(0, 1);
    expect(hashExportFiles(fewer)).not.toBe(hashExportFiles(files()));
  });
});
