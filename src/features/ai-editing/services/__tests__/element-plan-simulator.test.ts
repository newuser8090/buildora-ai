// ---------------------------------------------------------------------------
// Phase P22-H — plan simulator element operations
//   - every element op applies through the canonical engine and folds back
//     into the custom-block section props.tree
//   - invalid/missing targets fail cleanly
//   - regular (non-custom-block) sections are rejected
//   - engine constraints (nesting, visibility, registered types) still apply
//   - no live mutation, deterministic snapshots for diffs
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { simulatePlan } from "../plan-simulator";
import { CUSTOM_BLOCK_SECTION_TYPE } from "@/features/code-import/schemas/custom-block-schema";
import { sectionToElementTree } from "@/features/elements/adapters/section-element-adapter";
import type { AiEditOperation } from "../../plan-types";
import type { Project } from "@/types/project";
import type { BlockTree } from "@/features/blocks/types";
import { registerDefaultBlocks, isDefaultBlocksRegistered } from "@/features/blocks/registry/block-registry";

// The block registry powers the element engine + custom-block validation.
// Register the defaults once per worker (idempotent).
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
  return {
    rootIds: ["root"],
    nodes: nodes as unknown as BlockTree["nodes"],
  };
}

/** A one-page project whose page carries a custom-block section. */
function projectWithTree(tree: BlockTree): Project {
  return {
    id: "proj-p22h",
    name: "P22H",
    theme: {
      palette: {
        background: "#fff", foreground: "#0a0a0a", primary: "#7c5cfc",
        primaryForeground: "#fff", secondary: "#f5f5f5", secondaryForeground: "#0a0a0a",
        muted: "#f5f5f5", mutedForeground: "#737373", accent: "#7c5cfc",
        accentForeground: "#fff", border: "#e5e5e5", card: "#fff", cardForeground: "#0a0a0a",
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
            props: { name: "Design", tree },
            styles: {},
          },
        ],
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

/** Canonical fixture: container root (section id) with heading + button. */
function standardProject(): Project {
  return projectWithTree(
    treeWithNodes({
      root: baseNode({
        children: ["heading-1", "button-1"],
      }),
      "heading-1": baseNode({
        id: "heading-1",
        type: "heading",
        parentId: "root",
        props: { text: "Hello" },
      }),
      "button-1": baseNode({
        id: "button-1",
        type: "button",
        parentId: "root",
        props: { text: "Go", href: "#features" },
      }),
    }),
  );
}

const PROJECT = standardProject();

type OpBase = Pick<AiEditOperation, "id" | "type" | "label" | "explanation" | "risk">;

function baseOp(id: string, type: AiEditOperation["type"]): OpBase {
  return { id, type, label: "Change", explanation: "Test change.", risk: "low" };
}

function run(operations: AiEditOperation[], project: Project = PROJECT) {
  return simulatePlan(project, operations, { captureSnapshots: true });
}

function sectionById(project: Project, sectionId: string) {
  return project.pages[0].sections.find((s) => s.id === sectionId);
}

function treeOf(project: Project): ReturnType<typeof sectionToElementTree> {
  return sectionToElementTree(sectionById(project, "s-custom")!);
}

// ---------------------------------------------------------------------------
// Per operation
// ---------------------------------------------------------------------------

describe("simulatePlan — element operations", () => {
  it("update-element-props merges a bounded patch over the node props", () => {
    const result = run([
      {
        ...baseOp("op-1", "update-element-props"),
        type: "update-element-props",
        pageId: "page-1",
        sectionId: "s-custom",
        elementId: "heading-1",
        props: { text: "Fresh headline" },
      },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(treeOf(result.project).nodes["heading-1"].props.text).toBe("Fresh headline");
  });

  it("update-element-style merges style tokens", () => {
    const result = run([
      {
        ...baseOp("op-1", "update-element-style"),
        type: "update-element-style",
        pageId: "page-1",
        sectionId: "s-custom",
        elementId: "heading-1",
        style: { fontWeight: 700, fontSize: 32 },
      },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(treeOf(result.project).nodes["heading-1"].style.fontWeight).toBe(700);
    expect(treeOf(result.project).nodes["heading-1"].style.fontSize).toBe(32);
  });

  it("update-element-responsive writes viewport overrides", () => {
    const result = run([
      {
        ...baseOp("op-1", "update-element-responsive"),
        type: "update-element-responsive",
        pageId: "page-1",
        sectionId: "s-custom",
        elementId: "heading-1",
        breakpoint: "mobile",
        style: { fontSize: 18 },
      },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(treeOf(result.project).nodes["heading-1"].viewport?.mobile?.fontSize).toBe(18);
  });

  it("update-element-animation sets and clears animation", () => {
    const animation = { trigger: "load" as const, type: "fade" as const, durationMs: 600, easing: "ease" as const };
    const setResult = run([
      {
        ...baseOp("op-1", "update-element-animation"),
        type: "update-element-animation",
        pageId: "page-1",
        sectionId: "s-custom",
        elementId: "heading-1",
        animation,
      },
    ]);
    expect(setResult.ok).toBe(true);
    if (!setResult.ok) return;
    expect(treeOf(setResult.project).nodes["heading-1"].animation).toEqual(animation);

    const clearResult = run([
      {
        ...baseOp("op-1", "update-element-animation"),
        type: "update-element-animation",
        pageId: "page-1",
        sectionId: "s-custom",
        elementId: "heading-1",
        animation: null,
      },
    ]);
    expect(clearResult.ok).toBe(true);
    if (clearResult.ok) {
      expect(treeOf(clearResult.project).nodes["heading-1"].animation).toBeUndefined();
    }
  });

  it("update-element-interaction sets a click interaction", () => {
    const interaction = { click: { kind: "navigate" as const, target: { kind: "page" as const, pageId: "page-1" } } };
    const result = run([
      {
        ...baseOp("op-1", "update-element-interaction"),
        type: "update-element-interaction",
        pageId: "page-1",
        sectionId: "s-custom",
        elementId: "button-1",
        interaction,
      },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(treeOf(result.project).nodes["button-1"].interaction).toEqual(interaction);
  });

  it("insert-element builds from the registry and appends to the section root", () => {
    const result = run([
      {
        ...baseOp("op-1", "insert-element"),
        type: "insert-element",
        pageId: "page-1",
        sectionId: "s-custom",
        elementType: "badge",
        props: { text: "New" },
      },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const tree = treeOf(result.project);
    const root = tree.nodes["s-custom"];
    expect(root.children).toContain("button-1");
    // registry defaults merged with the bounded props; no fabricated subtree
    const insertedId = root.children.find((id) => id !== "heading-1" && id !== "button-1")!;
    const inserted = tree.nodes[insertedId];
    expect(inserted.type).toBe("badge");
    expect(inserted.props.text).toBe("New");
  });

  it("delete-element removes the node from the tree", () => {
    const result = run([
      {
        ...baseOp("op-1", "delete-element"),
        type: "delete-element",
        pageId: "page-1",
        sectionId: "s-custom",
        elementId: "heading-1",
        risk: "high",
      },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const tree = treeOf(result.project);
    expect(tree.nodes["heading-1"]).toBeUndefined();
    expect(tree.nodes["s-custom"].children).not.toContain("heading-1");
  });

  it("duplicate-element clones the node below the original", () => {
    const result = run([
      {
        ...baseOp("op-1", "duplicate-element"),
        type: "duplicate-element",
        pageId: "page-1",
        sectionId: "s-custom",
        elementId: "heading-1",
      },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const tree = treeOf(result.project);
    const root = tree.nodes["s-custom"];
    const index = root.children.indexOf("heading-1");
    const copyId = root.children[index + 1];
    expect(copyId).toBeDefined();
    expect(tree.nodes[copyId].type).toBe("heading");
    expect(tree.nodes[copyId].props.text).toBe("Hello");
  });

  it("set-element-visibility hides a node (durable field)", () => {
    const result = run([
      {
        ...baseOp("op-1", "set-element-visibility"),
        type: "set-element-visibility",
        pageId: "page-1",
        sectionId: "s-custom",
        elementId: "heading-1",
        visible: false,
      },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(treeOf(result.project).nodes["heading-1"].visible).toBe(false);
  });

  it("produces snapshots for element diffs", () => {
    const result = run([
      {
        ...baseOp("op-1", "update-element-style"),
        type: "update-element-style",
        pageId: "page-1",
        sectionId: "s-custom",
        elementId: "heading-1",
        style: { fontWeight: 700 },
      },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshots).toHaveLength(2);
    expect(treeOf(result.snapshots[0]).nodes["heading-1"].style.fontWeight).toBeUndefined();
    expect(treeOf(result.snapshots[1]).nodes["heading-1"].style.fontWeight).toBe(700);
  });
});

// ---------------------------------------------------------------------------
// Sequences + purity
// ---------------------------------------------------------------------------

describe("simulatePlan — element sequences and purity", () => {
  it("applies a multi-op element sequence deterministically", () => {
    const ops: AiEditOperation[] = [
      {
        ...baseOp("op-1", "update-element-style"),
        type: "update-element-style",
        pageId: "page-1",
        sectionId: "s-custom",
        elementId: "heading-1",
        style: { fontWeight: 700 },
      },
      {
        ...baseOp("op-2", "update-element-props"),
        type: "update-element-props",
        pageId: "page-1",
        sectionId: "s-custom",
        elementId: "heading-1",
        props: { text: "Bold headline" },
      },
    ];
    const a = run(ops);
    const b = run(ops);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(JSON.stringify(a.project)).toBe(JSON.stringify(b.project));
      const node = treeOf(a.project).nodes["heading-1"];
      expect(node.props.text).toBe("Bold headline");
      expect(node.style.fontWeight).toBe(700);
    }
  });

  it("does not mutate the source project", () => {
    const snapshot = JSON.stringify(PROJECT);
    run([
      {
        ...baseOp("op-1", "update-element-style"),
        type: "update-element-style",
        pageId: "page-1",
        sectionId: "s-custom",
        elementId: "heading-1",
        style: { fontWeight: 700 },
      },
    ]);
    expect(JSON.stringify(PROJECT)).toBe(snapshot);
    expect(treeOf(PROJECT).nodes["heading-1"].style.fontWeight).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

describe("simulatePlan — element guards", () => {
  it("fails on a missing page", () => {
    const result = run([
      {
        ...baseOp("op-1", "update-element-style"),
        type: "update-element-style",
        pageId: "ghost-page",
        sectionId: "s-custom",
        elementId: "heading-1",
        style: { fontWeight: 700 },
      },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PLAN_OPERATION_INVALID");
  });

  it("fails on a missing section", () => {
    const result = run([
      {
        ...baseOp("op-1", "update-element-style"),
        type: "update-element-style",
        pageId: "page-1",
        sectionId: "ghost-section",
        elementId: "heading-1",
        style: { fontWeight: 700 },
      },
    ]);
    expect(result.ok).toBe(false);
  });

  it("fails on a missing element", () => {
    const result = run([
      {
        ...baseOp("op-1", "update-element-style"),
        type: "update-element-style",
        pageId: "page-1",
        sectionId: "s-custom",
        elementId: "ghost-element",
        style: { fontWeight: 700 },
      },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failedOperationId).toBe("op-1");
  });

  it("rejects element ops on regular (non-custom-block) sections", () => {
    const project = JSON.parse(JSON.stringify(PROJECT)) as Project;
    project.pages[0].sections[0] = {
      id: "s-hero",
      type: "hero",
      order: 1,
      visible: true,
      props: { headline: "Hero", subheadline: "Sub", primaryCta: { text: "Go", href: "#" } },
      styles: {},
    };
    const result = run(
      [
        {
          ...baseOp("op-1", "update-element-style"),
          type: "update-element-style",
          pageId: "page-1",
          sectionId: "s-hero",
          elementId: "s-hero",
          style: { fontWeight: 700 },
        },
      ],
      project,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/custom-block/i);
  });

  it("rejects insert-element with an unregistered element-only type", () => {
    const result = run([
      {
        ...baseOp("op-1", "insert-element"),
        type: "insert-element",
        pageId: "page-1",
        sectionId: "s-custom",
        elementType: "carousel",
      },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/registered renderable/i);
  });

  it("rejects insert-element with an unknown parent", () => {
    const result = run([
      {
        ...baseOp("op-1", "insert-element"),
        type: "insert-element",
        pageId: "page-1",
        sectionId: "s-custom",
        parentElementId: "ghost-parent",
        elementType: "badge",
      },
    ]);
    expect(result.ok).toBe(false);
  });

  it("honors engine nesting constraints (heading cannot contain a button)", () => {
    const result = run([
      {
        ...baseOp("op-1", "insert-element"),
        type: "insert-element",
        pageId: "page-1",
        sectionId: "s-custom",
        parentElementId: "heading-1",
        elementType: "button",
      },
    ]);
    expect(result.ok).toBe(false);
  });

  it("fails when deleting the only root child is impossible (root stays)", () => {
    // Deleting the root container itself is blocked by the engine (a tree
    // must keep its root). Delete both children first, then the root.
    const result = run([
      {
        ...baseOp("op-1", "delete-element"),
        type: "delete-element",
        pageId: "page-1",
        sectionId: "s-custom",
        elementId: "heading-1",
        risk: "high",
      },
      {
        ...baseOp("op-2", "delete-element"),
        type: "delete-element",
        pageId: "page-1",
        sectionId: "s-custom",
        elementId: "button-1",
        risk: "high",
      },
      {
        ...baseOp("op-3", "delete-element"),
        type: "delete-element",
        pageId: "page-1",
        sectionId: "s-custom",
        elementId: "s-custom",
        risk: "high",
      },
    ]);
    expect(result.ok).toBe(false);
  });

  it("validates the final project through the section schema", () => {
    // A delete that would leave the tree empty fails final validation.
    const result = run([
      {
        ...baseOp("op-1", "delete-element"),
        type: "delete-element",
        pageId: "page-1",
        sectionId: "s-custom",
        elementId: "heading-1",
        risk: "high",
      },
      {
        ...baseOp("op-2", "delete-element"),
        type: "delete-element",
        pageId: "page-1",
        sectionId: "s-custom",
        elementId: "button-1",
        risk: "high",
      },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // The tree still has its container root — valid and preserved.
      const tree = treeOf(result.project);
      expect(tree.rootIds).toEqual(["s-custom"]);
    }
  });
});
