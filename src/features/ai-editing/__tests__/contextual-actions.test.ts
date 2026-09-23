// ---------------------------------------------------------------------------
// Contextual AI actions (Stage 5) — engine tests
//
// Covers the deterministic routing + transforms:
//   - chip lists per target kind (text element / widget / section),
//   - text transforms (punchier, friendly, Hindi) writing `props.text`,
//   - NL style parsing ("make background light green", "dark orange"),
//   - style commits writing tokens WITHOUT touching base style,
//   - section-level requests (discount banner / regenerate copy) via
//     updateSectionProps,
//   - every successful commit landing as exactly ONE history entry.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, vi } from "vitest";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { useCanvasInteractionStore } from "@/features/canvas/store/canvas-interaction-store";
import {
  registerDefaultBlocks,
  isDefaultBlocksRegistered,
} from "@/features/blocks/registry/block-registry";
import { registerDefaultElements } from "@/features/elements/registry/register-default-elements";
import {
  contextualChips,
  getContextualTarget,
  parseStyleRequest,
  runContextualAction,
  isContextualPrompt,
} from "../contextual-actions";
import type { BaseSection } from "@/types/section";
import type { Project } from "@/types/project";
import type { ElementTree } from "@/features/elements/types";

const PAGE_ID = "page-1";
const HERO_ID = "s-hero";
const HEAD_A_ID = "h-head-a";
const BTN_B_ID = "b-btn-b";
const BOX_C_ID = "c-box-c";

function durableHero(): BaseSection {
  const nodes: Record<string, unknown> = {
    [HERO_ID]: {
      id: HERO_ID, type: "container", parentId: null, children: [HEAD_A_ID, BTN_B_ID, BOX_C_ID],
      props: { _sectionType: "hero", _sectionId: HERO_ID }, style: {}, responsive: {},
      visible: true, locked: false, hidden: false,
    },
    [HEAD_A_ID]: {
      id: HEAD_A_ID, type: "heading", parentId: HERO_ID, children: [],
      props: { text: "Fresh groceries delivered", level: 2 }, style: {},
      responsive: {}, visible: true, locked: false, hidden: false,
    },
    [BTN_B_ID]: {
      id: BTN_B_ID, type: "button", parentId: HERO_ID, children: [],
      props: { text: "Shop now", href: "#" }, style: {},
      responsive: {}, visible: true, locked: false, hidden: false,
    },
    [BOX_C_ID]: {
      id: BOX_C_ID, type: "container", parentId: HERO_ID, children: [],
      props: {}, style: {},
      responsive: {}, visible: true, locked: false, hidden: false,
    },
  };
  return {
    id: HERO_ID, type: "hero", order: 1, visible: true,
    props: {
      headline: "Fresh groceries delivered",
      subheadline: "Every morning at your door",
      primaryCta: { text: "Go", href: "#" },
    },
    styles: {}, tree: { rootIds: [HERO_ID], nodes } as ElementTree,
  } as unknown as BaseSection;
}

function makeProject(): Project {
  return {
    id: "proj-ctx", name: "Contextual",
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
      shadows: { sm: "a", md: "b", lg: "c", xl: "d" },
    },
    assets: [],
    pages: [{ id: PAGE_ID, title: "Home", slug: "/", sections: [durableHero()] }],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function historyDepth(): number {
  const state = useEditorStore.getState() as unknown as {
    history?: { past?: unknown[] };
  };
  return state.history?.past?.length ?? 0;
}

function heroTree(): ElementTree {
  const section = useEditorStore
    .getState()
    .project.pages.find((p) => p.id === PAGE_ID)
    ?.sections.find((s) => s.id === HERO_ID);
  return (section?.tree as ElementTree) as ElementTree;
}

function selectSection() {
  useEditorStore.getState().selectSection(HERO_ID);
  useCanvasInteractionStore.getState().setSelection([HERO_ID], {
    multi: false,
    anchorId: HERO_ID,
  });
}

function selectElement(id: string) {
  useEditorStore.getState().selectSection(HERO_ID);
  useCanvasInteractionStore.getState().setSelection([id], { multi: false, anchorId: id });
}

describe("contextual chips + routing", () => {
  beforeEach(() => {
    if (!isDefaultBlocksRegistered()) registerDefaultBlocks();
    registerDefaultElements();
    useEditorStore.getState().initProject(makeProject());
    useEditorStore.getState().setDirty(false);
    useCanvasInteractionStore.getState().reset();
  });

  it("offers text chips for a text element target", () => {
    selectElement(HEAD_A_ID);
    const chips = contextualChips(getContextualTarget());
    expect(chips).toEqual(["Make punchier", "Translate to Hindi", "Change tone to friendly"]);
  });

  it("offers style chips for a widget target (buttons are text-capable)", () => {
    // Buttons carry text, so they get the text chips…
    selectElement(BTN_B_ID);
    expect(contextualChips(getContextualTarget())).toEqual([
      "Make punchier",
      "Translate to Hindi",
      "Change tone to friendly",
    ]);
    // …while a plain container gets the style chips.
    selectElement(BOX_C_ID);
    expect(contextualChips(getContextualTarget())).toEqual([
      "Make background light green",
      "Change button to dark orange",
    ]);
  });

  it("offers section chips at section level", () => {
    selectSection();
    const target = getContextualTarget();
    expect(target?.elementId).toBeNull();
    expect(contextualChips(target)).toEqual([
      "Add discount banner",
      "Regenerate copy with fresh items",
    ]);
  });

  it("detects contextual prompts for the local engine", () => {
    expect(isContextualPrompt("make background light green")).toBe(true);
    expect(isContextualPrompt("Make punchier")).toBe(true);
    expect(isContextualPrompt("Add discount banner")).toBe(true);
    expect(isContextualPrompt("write a poem about eggs")).toBe(false);
  });
});

describe("text transforms", () => {
  beforeEach(() => {
    if (!isDefaultBlocksRegistered()) registerDefaultBlocks();
    registerDefaultElements();
    useEditorStore.getState().initProject(makeProject());
    useEditorStore.getState().setDirty(false);
    useCanvasInteractionStore.getState().reset();
  });

  it("Make punchier rewrites the text as one history entry", () => {
    selectElement(HEAD_A_ID);
    const before = historyDepth();
    const result = runContextualAction("Make punchier");
    expect(result.ok).toBe(true);
    const node = heroTree().nodes[HEAD_A_ID];
    expect(String(node.props.text)).toMatch(/farm-fresh/i);
    expect(historyDepth()).toBe(before + 1);
  });

  it("Change tone to friendly softens a button", () => {
    selectElement(BTN_B_ID);
    const result = runContextualAction("Change tone to friendly");
    expect(result.ok).toBe(true);
    expect(heroTree().nodes[BTN_B_ID].props.text).toBe("Come on in");
  });

  it("Translate to Hindi produces Devanagari output", () => {
    selectElement(HEAD_A_ID);
    const result = runContextualAction("Translate to Hindi");
    expect(result.ok).toBe(true);
    const text = heroTree().nodes[HEAD_A_ID].props.text as string;
    expect(text === "Fresh groceries delivered").toBe(false);
    expect(/[\u0900-\u097F]/.test(text)).toBe(true);
    expect(text).toContain("ताज़ा");
  });

  it("style and text commits never bleed into each other's base values", () => {
    selectElement(HEAD_A_ID);
    runContextualAction("Make punchier");
    // Base style of the heading is untouched by a text transform.
    expect(heroTree().nodes[HEAD_A_ID].style.color).toBeUndefined();
  });
});

describe("style NL parsing", () => {
  beforeEach(() => {
    if (!isDefaultBlocksRegistered()) registerDefaultBlocks();
    registerDefaultElements();
    useEditorStore.getState().initProject(makeProject());
    useEditorStore.getState().setDirty(false);
    useCanvasInteractionStore.getState().reset();
  });

  it("parses 'make background light green' into background+contrast tokens", () => {
    selectElement(BTN_B_ID);
    const parsed = parseStyleRequest("make background light green");
    expect(parsed).not.toBeNull();
    // Green base (#16A34A) lightened toward white — no longer the base shade.
    expect(parsed?.tokens.background).toMatch(/^#/);
    expect(parsed?.tokens.background).not.toBe("#16A34A");
    expect(parsed?.tokens.color).toBeDefined();

    const before = historyDepth();
    const result = runContextualAction("make background light green");
    expect(result.ok).toBe(true);
    expect(heroTree().nodes[BTN_B_ID].style.background).toMatch(/^#/);
    expect(historyDepth()).toBe(before + 1);
  });

  it("parses 'change button to dark orange' as a text color", () => {
    selectElement(BTN_B_ID);
    const parsed = parseStyleRequest("change button to dark orange");
    expect(parsed?.tokens.color).toMatch(/^#/);
    // Dark shade of #F97316 → darker than the base.
    expect(parsed?.tokens.color).not.toBe("#F97316");
  });

  it("returns null when no color is recognizable", () => {
    expect(parseStyleRequest("make it sparkle")).toBeNull();
  });
});

describe("section-level requests", () => {
  beforeEach(() => {
    if (!isDefaultBlocksRegistered()) registerDefaultBlocks();
    registerDefaultElements();
    useEditorStore.getState().initProject(makeProject());
    useEditorStore.getState().setDirty(false);
    useCanvasInteractionStore.getState().reset();
    vi.restoreAllMocks();
  });

  it("Add discount banner writes the section copy slot as one entry", () => {
    selectSection();
    const before = historyDepth();
    const result = runContextualAction("Add discount banner");
    expect(result.ok).toBe(true);
    const section = useEditorStore
      .getState()
      .project.pages.find((p) => p.id === PAGE_ID)
      ?.sections.find((s) => s.id === HERO_ID);
    expect((section?.props.subheadline as string) ?? "").toContain("20% OFF");
    expect(historyDepth()).toBe(before + 1);
  });

  it("Regenerate copy rewrites copy keys without changing structure", () => {
    selectSection();
    const result = runContextualAction("Regenerate copy with fresh items");
    expect(result.ok).toBe(true);
    const section = useEditorStore
      .getState()
      .project.pages.find((p) => p.id === PAGE_ID)
      ?.sections.find((s) => s.id === HERO_ID);
    expect(section?.props.headline).toMatch(/^(Fresh pick|Handpicked for you|Today's special)/);
    // Structure preserved: CTA object untouched.
    expect(section?.props.primaryCta).toEqual({ text: "Go", href: "#" });
  });

  it("does not touch section props when only a style request is available", () => {
    selectSection();
    const before = historyDepth();
    const result = runContextualAction("make it sparkle");
    expect(result.ok).toBe(false);
    expect(historyDepth()).toBe(before);
  });
});
