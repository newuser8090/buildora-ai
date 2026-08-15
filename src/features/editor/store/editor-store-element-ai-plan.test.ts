// ---------------------------------------------------------------------------
// Editor store — atomic element AI plan application (Phase P22-H)
//
// Element-scoped plans flow through the SAME applyAiEditPlan boundary as
// section/page/project plans: one atomic history entry, stale-revision and
// project-identity guards, destructive confirmation, selection self-healing.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { useEditorStore } from "./editor-store";
import { CUSTOM_BLOCK_SECTION_TYPE } from "@/features/code-import/schemas/custom-block-schema";
import type { AiEditOperation, AiEditPlan } from "@/features/ai-editing/plan-types";
import type { Project } from "@/types/project";
import type { BlockTree } from "@/features/blocks/types";
import { registerDefaultBlocks, isDefaultBlocksRegistered } from "@/features/blocks/registry/block-registry";

// The element engine validates tree types against the block registry.
if (!isDefaultBlocksRegistered()) registerDefaultBlocks();

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function baseNode(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "root",
    type: "container",
    parentId: null,
    children: [],
    props: {},
    style: {},
    responsive: {},
    visible: true,
    locked: false,
    hidden: false,
    ...overrides,
  };
}

function treeWithNodes(nodes: Record<string, unknown>): BlockTree {
  return { rootIds: ["root"], nodes: nodes as unknown as BlockTree["nodes"] };
}

function makeProject(): Project {
  return {
    id: "test-proj",
    name: "Test",
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
            type: CUSTOM_BLOCK_SECTION_TYPE,
            order: 1,
            visible: true,
            props: {
              name: "Design",
              tree: treeWithNodes({
                root: baseNode({ children: ["heading-1", "button-1"] }),
                "heading-1": baseNode({ id: "heading-1", type: "heading", parentId: "root", props: { text: "Original" } }),
                "button-1": baseNode({ id: "button-1", type: "button", parentId: "root", props: { text: "Go", href: "#features" } }),
              }),
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

function baseOp(id: string): Partial<AiEditOperation> {
  return { id, label: "Change", explanation: "Test change.", risk: "low" };
}

function makePlan(revision = 1, operations?: AiEditOperation[]): AiEditPlan {
  return {
    version: 1,
    id: "plan-1",
    projectId: "test-proj",
    baseRevision: revision,
    scope: { type: "element", pageId: "page-1", sectionId: "s-custom", elementId: "heading-1" },
    instruction: "Make the heading bold",
    summary: "One change.",
    operations: operations ?? [
      {
        ...baseOp("op-1"),
        type: "update-element-style",
        pageId: "page-1",
        sectionId: "s-custom",
        elementId: "heading-1",
        style: { fontWeight: 700 },
      } as AiEditOperation,
    ],
    warnings: [],
    createdAt: "2026-01-02T00:00:00.000Z",
    provider: "rule-based",
  };
}

function hydrate(project: Project, revision = 1) {
  useEditorStore.getState().hydrateProject(project, revision);
}

function headingText(): string {
  const section = useEditorStore.getState().project.pages[0].sections.find((s) => s.id === "s-custom")!;
  const tree = (section.props as { tree: BlockTree }).tree;
  return tree.nodes["heading-1"].props.text as string;
}

function headingStyle(): Record<string, unknown> {
  const section = useEditorStore.getState().project.pages[0].sections.find((s) => s.id === "s-custom")!;
  const tree = (section.props as { tree: BlockTree }).tree;
  return tree.nodes["heading-1"].style as Record<string, unknown>;
}

function treeOf(project: Project): BlockTree {
  return (project.pages[0].sections[0].props as { tree: BlockTree }).tree;
}

beforeEach(() => {
  useEditorStore.setState({
    project: makeProject(),
    selectedSectionId: "s-custom",
    selectedPageId: "page-1",
    viewport: "desktop",
    zoom: 100,
    isGenerating: false,
    generationProgress: 0,
    history: {
      past: [],
      present: makeProject(),
      future: [],
    },
    _editingSession: null,
    revision: 1,
    isDirty: false,
    activeProjectId: "test-proj",
    saveStatus: "saved",
  });
});

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

describe("applyAiEditPlan — element plans", () => {
  it("applies an element style op atomically through the existing boundary", () => {
    hydrate(makeProject(), 1);
    const result = useEditorStore.getState().applyAiEditPlan(makePlan(1));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.applied).toBe(1);
    expect(headingStyle().fontWeight).toBe(700);
  });

  it("creates exactly ONE history entry for a multi-op element plan", () => {
    hydrate(makeProject(), 1);
    const plan = makePlan(1, [
      {
        ...baseOp("op-1"),
        type: "update-element-style",
        pageId: "page-1",
        sectionId: "s-custom",
        elementId: "heading-1",
        style: { fontWeight: 700 },
      } as AiEditOperation,
      {
        ...baseOp("op-2"),
        type: "update-element-props",
        pageId: "page-1",
        sectionId: "s-custom",
        elementId: "heading-1",
        props: { text: "Bold headline" },
      } as AiEditOperation,
    ]);
    const result = useEditorStore.getState().applyAiEditPlan(plan);
    expect(result.ok).toBe(true);
    expect(useEditorStore.getState().history.past.length).toBe(1);
    expect(headingText()).toBe("Bold headline");
    expect(headingStyle().fontWeight).toBe(700);
  });

  it("one Undo restores the full pre-plan tree and one Redo reapplies", () => {
    hydrate(makeProject(), 1);
    const plan = makePlan(1, [
      {
        ...baseOp("op-1"),
        type: "update-element-style",
        pageId: "page-1",
        sectionId: "s-custom",
        elementId: "heading-1",
        style: { fontWeight: 700 },
      } as AiEditOperation,
      {
        ...baseOp("op-2"),
        type: "update-element-props",
        pageId: "page-1",
        sectionId: "s-custom",
        elementId: "heading-1",
        props: { text: "Bold headline" },
      } as AiEditOperation,
    ]);
    useEditorStore.getState().applyAiEditPlan(plan);

    useEditorStore.getState().undo();
    expect(headingText()).toBe("Original");
    expect(headingStyle().fontWeight).toBeUndefined();

    useEditorStore.getState().redo();
    expect(headingText()).toBe("Bold headline");
    expect(headingStyle().fontWeight).toBe(700);
  });

  it("rejects stale element plans (revision changed)", () => {
    hydrate(makeProject(), 2);
    const result = useEditorStore.getState().applyAiEditPlan(makePlan(1));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PLAN_STALE");
    expect(useEditorStore.getState().history.past.length).toBe(0);
  });

  it("rejects element plans for a different project", () => {
    hydrate(makeProject(), 1);
    const mismatch = useEditorStore.getState().applyAiEditPlan({
      ...makePlan(1),
      projectId: "other-project",
    });
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) expect(mismatch.error.code).toBe("PLAN_PROJECT_MISMATCH");
  });

  it("requires destructive confirmation for element deletes (high risk)", () => {
    hydrate(makeProject(), 1);
    const plan = makePlan(1, [
      {
        ...baseOp("op-1"),
        risk: "high",
        type: "delete-element",
        pageId: "page-1",
        sectionId: "s-custom",
        elementId: "heading-1",
      } as AiEditOperation,
    ]);
    const denied = useEditorStore.getState().applyAiEditPlan(plan);
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.error.code).toBe("PLAN_DESTRUCTIVE_CONFIRMATION_REQUIRED");
    }
    expect(treeOf(useEditorStore.getState().project).nodes["heading-1"]).toBeDefined();

    const allowed = useEditorStore.getState().applyAiEditPlan(plan, undefined, {
      allowDestructive: true,
    });
    expect(allowed.ok).toBe(true);
    expect(treeOf(useEditorStore.getState().project).nodes["heading-1"]).toBeUndefined();
  });

  it("a failed element simulation leaves the project untouched", () => {
    hydrate(makeProject(), 1);
    const plan = makePlan(1, [
      {
        ...baseOp("op-1"),
        type: "update-element-style",
        pageId: "page-1",
        sectionId: "s-custom",
        elementId: "ghost-element",
        style: { fontWeight: 700 },
      } as AiEditOperation,
    ]);
    const result = useEditorStore.getState().applyAiEditPlan(plan);
    expect(result.ok).toBe(false);
    expect(treeOf(useEditorStore.getState().project).nodes["heading-1"].props.text).toBe("Original");
    expect(useEditorStore.getState().history.past.length).toBe(0);
  });

  it("keeps the section selection after an element plan", () => {
    hydrate(makeProject(), 1);
    useEditorStore.getState().selectSection("s-custom");
    useEditorStore.getState().applyAiEditPlan(makePlan(1));
    expect(useEditorStore.getState().selectedSectionId).toBe("s-custom");
  });
});
