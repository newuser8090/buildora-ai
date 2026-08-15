// ---------------------------------------------------------------------------
// Phase P22-H — element diffs
//   - every element operation produces a readable element-kind diff
//   - props/style/responsive/animation/interaction show before/after values
//   - insert/delete/duplicate produce structural summaries
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { buildDiffs } from "../diff-builder";
import { simulatePlan } from "../plan-simulator";
import { CUSTOM_BLOCK_SECTION_TYPE } from "@/features/code-import/schemas/custom-block-schema";
import type { AiEditOperation } from "../../plan-types";
import type { Project } from "@/types/project";
import type { BlockTree } from "@/features/blocks/types";
import { registerDefaultBlocks, isDefaultBlocksRegistered } from "@/features/blocks/registry/block-registry";

// The block registry powers the element engine + custom-block validation.
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

function standardProject(): Project {
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
            props: {
              name: "Design",
              tree: treeWithNodes({
                root: baseNode({ children: ["heading-1", "button-1"] }),
                "heading-1": baseNode({ id: "heading-1", type: "heading", parentId: "root", props: { text: "Hello" } }),
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

type OpBase = Pick<AiEditOperation, "id" | "type" | "label" | "explanation" | "risk">;

function baseOp(id: string, type: AiEditOperation["type"]): OpBase {
  return { id, type, label: "Change", explanation: "Test change.", risk: "low" };
}

function diffsFor(ops: AiEditOperation[]): ReturnType<typeof buildDiffs> {
  const sim = simulatePlan(standardProject(), ops, { captureSnapshots: true });
  if (!sim.ok) throw new Error(`Simulation failed: ${sim.error.message}`);
  return buildDiffs(ops, sim.snapshots);
}

// ---------------------------------------------------------------------------
// Element diff kinds
// ---------------------------------------------------------------------------

describe("buildDiffs — element operations", () => {
  it("update-element-props diffs changed props only", () => {
    const diffs = diffsFor([
      {
        ...baseOp("op-1", "update-element-props"),
        type: "update-element-props",
        pageId: "page-1",
        sectionId: "s-custom",
        elementId: "heading-1",
        props: { text: "Fresh headline" },
      },
    ]);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].kind).toBe("element");
    const text = diffs[0].fields.find((f) => f.key === "text");
    expect(text?.before).toBe("Hello");
    expect(text?.after).toBe("Fresh headline");
  });

  it("update-element-style diffs style tokens", () => {
    const diffs = diffsFor([
      {
        ...baseOp("op-1", "update-element-style"),
        type: "update-element-style",
        pageId: "page-1",
        sectionId: "s-custom",
        elementId: "heading-1",
        style: { fontWeight: 700 },
      },
    ]);
    expect(diffs[0].kind).toBe("element");
    const fontWeight = diffs[0].fields.find((f) => f.key === "fontWeight");
    expect(fontWeight?.after).toBe(700);
  });

  it("update-element-responsive diffs viewport overrides", () => {
    const diffs = diffsFor([
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
    expect(diffs[0].kind).toBe("element");
    expect(diffs[0].fields.some((f) => f.key === "fontSize" && f.after === 18)).toBe(true);
  });

  it("update-element-animation diffs the animation object", () => {
    const diffs = diffsFor([
      {
        ...baseOp("op-1", "update-element-animation"),
        type: "update-element-animation",
        pageId: "page-1",
        sectionId: "s-custom",
        elementId: "heading-1",
        animation: { trigger: "load", type: "fade", durationMs: 600, easing: "ease" },
      },
    ]);
    expect(diffs[0].kind).toBe("element");
    const field = diffs[0].fields.find((f) => f.key === "animation");
    expect(JSON.stringify(field?.after)).toContain("fade");
  });

  it("update-element-interaction diffs the interaction object", () => {
    const diffs = diffsFor([
      {
        ...baseOp("op-1", "update-element-interaction"),
        type: "update-element-interaction",
        pageId: "page-1",
        sectionId: "s-custom",
        elementId: "button-1",
        interaction: { click: { kind: "navigate", target: { kind: "page", pageId: "page-1" } } },
      },
    ]);
    expect(diffs[0].kind).toBe("element");
    expect(diffs[0].fields.some((f) => f.key === "interaction")).toBe(true);
  });

  it("insert-element describes the added element", () => {
    const diffs = diffsFor([
      {
        ...baseOp("op-1", "insert-element"),
        type: "insert-element",
        pageId: "page-1",
        sectionId: "s-custom",
        elementType: "badge",
        props: { text: "New" },
      },
    ]);
    expect(diffs[0].kind).toBe("element");
    const added = diffs[0].fields.find((f) => f.label === "Added");
    expect(added?.after).toContain("Badge");
  });

  it("delete-element describes the removed element", () => {
    const diffs = diffsFor([
      {
        ...baseOp("op-1", "delete-element"),
        type: "delete-element",
        pageId: "page-1",
        sectionId: "s-custom",
        elementId: "heading-1",
        risk: "high",
      },
    ]);
    expect(diffs[0].kind).toBe("element");
    const removed = diffs[0].fields.find((f) => f.label === "Removed");
    expect(removed?.before).toContain("Heading");
  });

  it("duplicate-element describes the copied element", () => {
    const diffs = diffsFor([
      {
        ...baseOp("op-1", "duplicate-element"),
        type: "duplicate-element",
        pageId: "page-1",
        sectionId: "s-custom",
        elementId: "heading-1",
      },
    ]);
    expect(diffs[0].kind).toBe("element");
    const duplicated = diffs[0].fields.find((f) => f.label === "Duplicated");
    expect(duplicated?.after).toContain("Heading");
  });

  it("set-element-visibility diffs the visibility toggle", () => {
    const diffs = diffsFor([
      {
        ...baseOp("op-1", "set-element-visibility"),
        type: "set-element-visibility",
        pageId: "page-1",
        sectionId: "s-custom",
        elementId: "heading-1",
        visible: false,
      },
    ]);
    expect(diffs[0].kind).toBe("visibility");
    expect(diffs[0].fields[0].before).toBe("Visible");
    expect(diffs[0].fields[0].after).toBe("Hidden");
  });
});
