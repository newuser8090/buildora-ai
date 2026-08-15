import { describe, it, expect } from "vitest";
import { serializeProject, deserializeProject } from "../services/project-serializer";
import { normalizeProject } from "../services/project-normalizer";
import { ProjectSchema } from "@/features/generation/schemas/generation-plan-schema";
import type { Project } from "@/types/project";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProject(overrides?: Partial<Project>): Project {
  return {
    id: "proj-collections",
    name: "Collections Test",
    theme: {
      palette: {
        background: "#ffffff", foreground: "#0a0a0a", primary: "#7c5cfc",
        primaryForeground: "#ffffff", secondary: "#f5f5f5", secondaryForeground: "#0a0a0a",
        muted: "#f5f5f5", mutedForeground: "#737373", accent: "#7c5cfc",
        accentForeground: "#ffffff", border: "#e5e5e5", card: "#ffffff", cardForeground: "#000000",
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
          { id: "s1", type: "hero", order: 1, visible: true, props: {}, styles: {} },
        ],
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const COLLECTIONS = [
  {
    id: "col-products",
    name: "Products",
    fields: [
      { id: "f1", name: "name", type: "text" as const },
      { id: "f2", name: "price", type: "number" as const },
    ],
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Project collections persistence", () => {
  it("serialize → deserialize → normalize → validate preserves collections", () => {
    const project = makeProject({ collections: COLLECTIONS });
    const json = serializeProject(project);
    const parsed = JSON.parse(json) as { project: unknown };

    // Collections survive the serializer's allow-list.
    const parsedProject = parsed.project as { collections?: unknown };
    expect(parsedProject.collections).toEqual(COLLECTIONS);

    // Full pipeline round trip.
    const result = deserializeProject(json);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.project.collections).toEqual(COLLECTIONS);
      // The validated project still passes ProjectSchema.
      const validation = ProjectSchema.safeParse(result.project);
      expect(validation.success).toBe(true);
    }
  });

  it("normalizeProject preserves valid collections and drops invalid entries", () => {
    const raw = makeProject({
      collections: [
        COLLECTIONS[0],
        { id: "bad", name: "Bad", fields: [{ id: "x", name: "x", type: "date" as never }] },
        "not-a-collection" as unknown as { id: string; name: string; fields: never[] },
      ],
    });
    const normalized = normalizeProject(raw);
    expect(normalized.success).toBe(true);
    if (normalized.success) {
      expect(normalized.project.collections).toEqual(COLLECTIONS);
    }
  });

  it("old projects without collections stay valid and normalize unchanged", () => {
    const project = makeProject();
    expect(project.collections).toBeUndefined();
    const json = serializeProject(project);
    const result = deserializeProject(json);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.project.collections).toBeUndefined();
    }
  });

  it("normalizeProject leaves collections undefined when the field is absent", () => {
    const raw = makeProject();
    const normalized = normalizeProject(raw);
    expect(normalized.success).toBe(true);
    if (normalized.success) {
      expect(normalized.project.collections).toBeUndefined();
    }
  });

  it("serializer strips non-project transient keys but keeps collections", () => {
    const project = makeProject({ collections: COLLECTIONS }) as Project & {
      transientState?: unknown;
    };
    (project as unknown as Record<string, unknown>).transientState = { x: 1 };
    const json = serializeProject(project);
    const parsed = JSON.parse(json) as { project: Record<string, unknown> };
    expect(parsed.project.transientState).toBeUndefined();
    expect(parsed.project.collections).toEqual(COLLECTIONS);
  });
});
