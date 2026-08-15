// ---------------------------------------------------------------------------
// Editor store — responsive decisions (Phase P22-F)
//   - acceptResponsiveDecision: ONE atomic history entry folding the viewport
//     override AND recording the AI decision
//   - rejectResponsiveDecision: ONE entry recording the user rejection
//   - proposals are NEVER auto-applied; no-ops skip history
//   - decisions persist through the validated Project schema
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { useEditorStore } from "@/features/editor/store/editor-store";
import type { Project } from "@/types/project";
import { ProjectSchema } from "@/features/generation/schemas/generation-plan-schema";
import { registerDefaultBlocks, isDefaultBlocksRegistered } from "@/features/blocks/registry/block-registry";
import { registerDefaultElements } from "@/features/elements/registry/register-default-elements";
import type { ResponsiveDecision } from "@/features/elements/responsive/types";
import { sectionToElementTree } from "@/features/elements/adapters/section-element-adapter";
import { setElementLocked } from "@/features/elements/engine/element-operations";

function makeProject(): Project {
  return {
    id: "proj-resp",
    name: "Responsive",
    theme: {
      palette: {
        background: "#ffffff", foreground: "#0a0a0a", primary: "#7c5cfc",
        primaryForeground: "#ffffff", secondary: "#f5f5f5", secondaryForeground: "#0a0a0a",
        muted: "#f5f5f5", mutedForeground: "#737373", accent: "#7c5cfc",
        accentForeground: "#ffffff", border: "#e5e5e5", card: "#ffffff", cardForeground: "#0a0a0a",
      },
      typography: { fontFamily: "Geist", headingFont: "Geist", baseSize: "16px", scale: 1.25 },
      spacing: { sectionPadding: "6rem 0", containerMaxWidth: "1120px", gap: "1.5rem" },
      radius: { sm: "0.375rem", md: "0.5rem", lg: "0.75rem", xl: "1rem", full: "9999px" },
      shadows: { sm: "0 1px 2px rgba(0,0,0,0.05)", md: "0 4px 6px rgba(0,0,0,0.07)", lg: "0 10px 15px rgba(0,0,0,0.1)", xl: "0 20px 25px rgba(0,0,0,0.15)" },
    },
    assets: [],
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
            props: {
              name: "Grid design",
              tree: {
                rootIds: ["s-custom"],
                nodes: {
                  "s-custom": {
                    id: "s-custom",
                    type: "container",
                    parentId: null,
                    children: ["g1"],
                    props: {},
                    style: {},
                    responsive: {},
                    visible: true,
                    locked: false,
                    hidden: false,
                  },
                  g1: {
                    id: "g1",
                    type: "grid",
                    parentId: "s-custom",
                    children: ["c1", "c2", "c3", "c4"],
                    props: { columns: 4 },
                    style: { display: "grid", gap: "1rem" },
                    responsive: {},
                    visible: true,
                    locked: false,
                    hidden: false,
                  },
                  c1: { id: "c1", type: "container", parentId: "g1", children: [], props: {}, style: {}, responsive: {}, visible: true, locked: false, hidden: false },
                  c2: { id: "c2", type: "container", parentId: "g1", children: [], props: {}, style: {}, responsive: {}, visible: true, locked: false, hidden: false },
                  c3: { id: "c3", type: "container", parentId: "g1", children: [], props: {}, style: {}, responsive: {}, visible: true, locked: false, hidden: false },
                  c4: { id: "c4", type: "container", parentId: "g1", children: [], props: {}, style: {}, responsive: {}, visible: true, locked: false, hidden: false },
                },
              },
            },
            styles: {},
          },
        ],
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function storedGridViewport() {
  const section = useEditorStore.getState().project.pages[0].sections[0];
  const tree = (section.props as { tree?: { nodes?: Record<string, { viewport?: unknown }> } }).tree;
  return tree?.nodes?.g1?.viewport;
}

function storedDecisions(): ResponsiveDecision[] {
  return useEditorStore.getState().project.responsiveDecisions ?? [];
}

const aiDecision = (): ResponsiveDecision => ({
  elementId: "g1",
  viewport: "mobile",
  transformation: "grid-columns-1",
  appliedBy: "ai",
  state: "applied",
  note: "Show 1 column on mobile",
});

const rejectDecision = (): ResponsiveDecision => ({
  elementId: "g1",
  viewport: "mobile",
  transformation: "grid-columns-1",
  appliedBy: "user",
  state: "rejected",
  note: "Show 1 column on mobile",
});

beforeEach(() => {
  if (!isDefaultBlocksRegistered()) registerDefaultBlocks();
  registerDefaultElements();
  useEditorStore.getState().hydrateProject(makeProject(), 1);
  useEditorStore.getState().setDirty(false);
});

describe("acceptResponsiveDecision", () => {
  it("folds the viewport override and records the AI decision in ONE history entry", () => {
    const pastBefore = useEditorStore.getState().history.past.length;
    const result = useEditorStore.getState().acceptResponsiveDecision("page-1", "s-custom", aiDecision());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.changed).toBe(true);

    expect(storedGridViewport()).toEqual({ mobile: { gridTemplateColumns: "repeat(1, minmax(0, 1fr))" } });
    expect(storedDecisions()).toEqual([aiDecision()]);
    expect(useEditorStore.getState().history.past.length).toBe(pastBefore + 1);

    const schemaOk = ProjectSchema.safeParse(useEditorStore.getState().project);
    expect(schemaOk.success).toBe(true);
  });

  it("undo/redo revert/re-apply the override AND the decision together", () => {
    useEditorStore.getState().acceptResponsiveDecision("page-1", "s-custom", aiDecision());
    expect(storedGridViewport()).toBeTruthy();
    expect(storedDecisions()).toHaveLength(1);

    useEditorStore.getState().undo();
    expect(storedGridViewport()).toBeUndefined();
    expect(storedDecisions()).toHaveLength(0);

    useEditorStore.getState().redo();
    expect(storedGridViewport()).toEqual({ mobile: { gridTemplateColumns: "repeat(1, minmax(0, 1fr))" } });
    expect(storedDecisions()).toHaveLength(1);
  });

  it("rejects unknown elements and locked elements with no state change", () => {
    const before = useEditorStore.getState().project;
    const unknown = useEditorStore.getState().acceptResponsiveDecision("page-1", "s-custom", { ...aiDecision(), elementId: "nope" });
    expect(unknown.ok).toBe(false);
    expect(useEditorStore.getState().project).toEqual(before);

    // Lock g1 through the commit boundary, then the accept must fail.
    const section = useEditorStore.getState().project.pages[0].sections[0];
    const tree = sectionToElementTree(section);
    const locked = setElementLocked(tree, "g1", true);
    if (locked.ok) {
      useEditorStore.getState().commitElementTree("page-1", "s-custom", locked.value);
    }
    const lockedResult = useEditorStore.getState().acceptResponsiveDecision("page-1", "s-custom", aiDecision());
    expect(lockedResult.ok).toBe(false);
    expect(storedDecisions()).toHaveLength(0);
  });

  it("rejects unknown sections/pages", () => {
    expect(useEditorStore.getState().acceptResponsiveDecision("page-x", "s-custom", aiDecision()).ok).toBe(false);
    expect(useEditorStore.getState().acceptResponsiveDecision("page-1", "s-x", aiDecision()).ok).toBe(false);
  });

  it("is a no-op when the decision is already recorded and nothing changed", () => {
    useEditorStore.getState().acceptResponsiveDecision("page-1", "s-custom", aiDecision());
    const pastBefore = useEditorStore.getState().history.past.length;
    const again = useEditorStore.getState().acceptResponsiveDecision("page-1", "s-custom", aiDecision());
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.changed).toBe(false);
    expect(useEditorStore.getState().history.past.length).toBe(pastBefore);
    expect(storedDecisions()).toHaveLength(1);
  });

  it("rejects arbitrary transformation strings at the boundary", () => {
    const bad = useEditorStore.getState().acceptResponsiveDecision("page-1", "s-custom", {
      ...aiDecision(),
      transformation: "carousel",
    } as unknown as ResponsiveDecision);
    expect(bad.ok).toBe(false);
    expect(storedDecisions()).toHaveLength(0);
    expect(storedGridViewport()).toBeUndefined();
  });
});

describe("rejectResponsiveDecision", () => {
  it("records the user rejection in one history entry", () => {
    const pastBefore = useEditorStore.getState().history.past.length;
    const result = useEditorStore.getState().rejectResponsiveDecision(rejectDecision());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.changed).toBe(true);
    expect(storedDecisions()).toEqual([rejectDecision()]);
    expect(useEditorStore.getState().history.past.length).toBe(pastBefore + 1);
    expect(storedGridViewport()).toBeUndefined(); // nothing auto-applied
    const schemaOk = ProjectSchema.safeParse(useEditorStore.getState().project);
    expect(schemaOk.success).toBe(true);
  });

  it("rejecting twice is a no-op (no history pollution)", () => {
    useEditorStore.getState().rejectResponsiveDecision(rejectDecision());
    const pastBefore = useEditorStore.getState().history.past.length;
    const again = useEditorStore.getState().rejectResponsiveDecision(rejectDecision());
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.changed).toBe(false);
    expect(useEditorStore.getState().history.past.length).toBe(pastBefore);
  });

  it("undo removes the recorded rejection", () => {
    useEditorStore.getState().rejectResponsiveDecision(rejectDecision());
    useEditorStore.getState().undo();
    expect(storedDecisions()).toHaveLength(0);
  });
});

describe("persistence round-trip", () => {
  it("decisions survive a hydrate + ProjectSchema validation round-trip", () => {
    useEditorStore.getState().acceptResponsiveDecision("page-1", "s-custom", aiDecision());
    const saved = useEditorStore.getState().project;
    const parsed = ProjectSchema.safeParse(JSON.parse(JSON.stringify(saved)));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.responsiveDecisions).toEqual([aiDecision()]);
    }
  });
});
