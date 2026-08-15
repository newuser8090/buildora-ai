// ---------------------------------------------------------------------------
// Phase P22-H — rule-based element recognizers
//   - element scope runs ONLY the element recognizers (section/page
//     recognizers never misinterpret element-scoped instructions)
//   - deterministic commands: style, responsive, animation, interaction,
//     insert (registry type only), delete, duplicate, visibility
//   - insert ops NEVER fabricate subtree JSON (type + bounded props only)
//   - unsupported/element-only types produce warnings, never ops
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { RuleBasedPlanner, type PlanIdFactory } from "../rule-based-planner";
import { CUSTOM_BLOCK_SECTION_TYPE } from "@/features/code-import/schemas/custom-block-schema";
import { simulatePlan } from "../../services/plan-simulator";
import type { AiEditPlannerInput } from "../../plan-types";
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

function elementProject(): Project {
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

const PROJECT = elementProject();

let opCounter = 0;

function deterministicIdFactory(): PlanIdFactory {
  return {
    planId: () => "plan-test-1",
    pageId: () => `page-new-${(opCounter += 1)}`,
    sectionId: (type) => `sec-${type}-${(opCounter += 1)}`,
    operationId: (index) => `op-${index}`,
  };
}

function planner() {
  opCounter = 0;
  return new RuleBasedPlanner({ idFactory: deterministicIdFactory() });
}

function elementInput(
  instruction: string,
  overrides?: Partial<AiEditPlannerInput>,
): AiEditPlannerInput {
  return {
    instruction,
    scope: { type: "element", pageId: "page-1", sectionId: "s-custom", elementId: "heading-1" },
    project: PROJECT,
    baseRevision: 3,
    ...overrides,
  };
}

async function singleOp(instruction: string) {
  const result = await planner().createPlan(elementInput(instruction));
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  expect(result.plan.operations).toHaveLength(1);
  return result.plan.operations[0];
}

// ---------------------------------------------------------------------------
// Style / responsive / animation / interaction
// ---------------------------------------------------------------------------

describe("rule-based planner — element style and motion", () => {
  it("makes the selected element bold", async () => {
    const op = await singleOp("Make the selected heading bold");
    expect(op.type).toBe("update-element-style");
    const styleOp = op as { elementId: string; style: Record<string, unknown> };
    expect(styleOp.elementId).toBe("heading-1");
    expect(styleOp.style.fontWeight).toBe(700);
  });

  it("makes the selected element larger", async () => {
    const op = await singleOp("Make the selected heading larger");
    expect(op.type).toBe("update-element-style");
    expect((op as { style: Record<string, unknown> }).style.fontSize).toBeGreaterThan(20);
  });

  it("makes the selected element smaller on mobile (viewport override)", async () => {
    const op = await singleOp("Make the selected heading smaller on mobile");
    expect(op.type).toBe("update-element-responsive");
    const responsive = op as { breakpoint: string; style: Record<string, unknown> };
    expect(responsive.breakpoint).toBe("mobile");
    expect(responsive.style.fontSize).toBeLessThan(20);
  });

  it("adds a fade-on-scroll animation", async () => {
    const op = await singleOp("Add a fade animation to the selected element on scroll");
    expect(op.type).toBe("update-element-animation");
    const animation = (op as { animation: { trigger: string; type: string } }).animation;
    expect(animation.trigger).toBe("scroll");
    expect(animation.type).toBe("fade");
  });

  it("links the element to a page by keyword", async () => {
    const op = await singleOp("Link the button to the home page");
    expect(op.type).toBe("update-element-interaction");
    const interaction = (op as { interaction: { click: { target: { kind: string } } } }).interaction;
    expect(interaction.click.target.kind).toBe("page");
  });

  it("adds a hover highlight", async () => {
    const result = await planner().createPlan(
      elementInput("Highlight the selected button accent on hover"),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const hoverOp = result.plan.operations.find(
      (op) => op.type === "update-element-interaction",
    );
    expect(hoverOp).toBeDefined();
    const interaction = (hoverOp as { interaction: { hover: { backgroundColor: string } } }).interaction;
    expect(interaction.hover.backgroundColor).toContain("accent");
  });
});

// ---------------------------------------------------------------------------
// Structure: insert / delete / duplicate / visibility
// ---------------------------------------------------------------------------

describe("rule-based planner — element structure", () => {
  it("inserts a registered renderable element with bounded props only", async () => {
    const op = await singleOp("Add a button element to this section");
    expect(op.type).toBe("insert-element");
    const insert = op as {
      sectionId: string;
      elementType: string;
      props?: Record<string, unknown>;
      style?: Record<string, unknown>;
      parentElementId?: string;
    };
    expect(insert.sectionId).toBe("s-custom");
    expect(insert.elementType).toBe("button");
    // No arbitrary subtree JSON — only the type + optional bounded patch.
    expect(Object.keys(insert)).not.toContain("node");
    expect(Object.keys(insert)).not.toContain("tree");
    expect(Object.keys(insert)).not.toContain("children");
  });

  it("rejects element-only insert types with a structured warning", async () => {
    // Keywords with NO registered renderable block mapping stay rejected.
    // (Element-only keywords that map to a renderable family — e.g. "text"
    // → paragraph, "list" → stack, "price" → pricing-card — remain
    // insertable through the registry, which is the approved behavior.)
    for (const keyword of ["carousel", "logo", "marquee", "aurora"]) {
      const result = await planner().createPlan(
        elementInput(`Add a ${keyword} element to this section`),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("PLAN_NO_CHANGES");
      }
      expect(
        result.warnings?.some((w) => w.includes("not a supported element")),
      ).toBe(true);
    }
  });

  it("maps element-only keywords to their registered renderable block family", async () => {
    // "price" resolves to the registered renderable pricing-card block — the
    // planner supplies only the type + bounded content, never fabricated JSON.
    const result = await planner().createPlan(
      elementInput("Add a price element to this section"),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const insert = result.plan.operations[0] as { type: string; elementType: string };
    expect(insert.type).toBe("insert-element");
    expect(insert.elementType).toBe("pricing-card");
  });

  it("duplicates the selected element", async () => {
    const op = await singleOp("Duplicate the selected element");
    expect(op.type).toBe("duplicate-element");
    expect((op as { elementId: string }).elementId).toBe("heading-1");
  });

  it("deletes the selected element (high risk)", async () => {
    const op = await singleOp("Delete the selected element");
    expect(op.type).toBe("delete-element");
    expect(op.risk).toBe("high");
  });

  it("hides and shows the selected element", async () => {
    const hide = await singleOp("Hide the selected element");
    expect(hide.type).toBe("set-element-visibility");
    expect((hide as { visible: boolean }).visible).toBe(false);

    // Showing an already-visible element is a no-op — hide it in the fixture
    // first so the show command has a real change to plan.
    const hiddenProject = JSON.parse(JSON.stringify(PROJECT)) as Project;
    const tree = (hiddenProject.pages[0].sections[0].props as { tree: BlockTree }).tree;
    tree.nodes["heading-1"].visible = false;

    const show = await planner().createPlan(
      elementInput("Show the selected element", { project: hiddenProject }),
    );
    expect(show.ok).toBe(true);
    if (!show.ok) return;
    const showOp = show.plan.operations[0] as { type: string; visible: boolean };
    expect(showOp.type).toBe("set-element-visibility");
    expect(showOp.visible).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Scope isolation + pipeline fit
// ---------------------------------------------------------------------------

describe("rule-based planner — element scope isolation", () => {
  it("does NOT run section/page recognizers on element-scoped instructions", async () => {
    // \"delete the selected element\" must produce an element op, never a
    // section delete (there is no \"selected section\" in this scope).
    const op = await singleOp("Delete the selected element");
    expect(op.type).toBe("delete-element");
  });

  it("produces a no-change error for unsupported element instructions", async () => {
    const result = await planner().createPlan(
      elementInput("Give the selected element a 3D parallax tilt effect"),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PLAN_NO_CHANGES");
  });

  it("generated element plans simulate cleanly and fold into the tree", async () => {
    const result = await planner().createPlan(
      elementInput("Make the selected heading bold and duplicate it"),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.operations.length).toBeGreaterThanOrEqual(2);
    const sim = simulatePlan(PROJECT, result.plan.operations);
    expect(sim.ok).toBe(true);
  });

  it("never mutates the input project", async () => {
    const snapshot = JSON.stringify(PROJECT);
    await planner().createPlan(elementInput("Delete the selected element and hide the other"));
    expect(JSON.stringify(PROJECT)).toBe(snapshot);
  });
});
