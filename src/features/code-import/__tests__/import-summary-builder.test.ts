// ---------------------------------------------------------------------------
// Phase P3 — friendly import summary builder
//   - friendly labels map block types to beginner language
//   - layout types hidden by default
//   - deterministic ordering + pluralisation
//   - capped output
//   - no mutation of the input tree
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import type { BlockNode, BlockTree } from "@/features/blocks/types";
import { registerDefaultBlocks, isDefaultBlocksRegistered } from "@/features/blocks/registry/block-registry";
import {
  buildFriendlyImportSummary,
  friendlyBlockLabel,
  friendlyFoundList,
  friendlyItemSentence,
  pluralizeFriendlyLabel,
} from "@/features/code-import/presentation/import-summary-builder";

function makeNode(id: string, type: BlockNode["type"], parentId: string | null, children: string[] = []): BlockNode {
  return {
    id,
    type,
    parentId,
    children,
    props: {},
    style: {},
    responsive: {},
    visible: true,
    locked: false,
    hidden: false,
  };
}

function makeTree(): BlockTree {
  return {
    rootIds: ["root"],
    nodes: {
      root: makeNode("root", "container", null, ["nav", "h1", "p1", "p2", "btn", "card1", "card2", "card3", "div"]),
      nav: makeNode("nav", "navbar", "root"),
      h1: makeNode("h1", "heading", "root"),
      p1: makeNode("p1", "paragraph", "root"),
      p2: makeNode("p2", "paragraph", "root"),
      btn: makeNode("btn", "button", "root"),
      card1: makeNode("card1", "pricing-card", "root"),
      card2: makeNode("card2", "pricing-card", "root"),
      card3: makeNode("card3", "pricing-card", "root"),
      div: makeNode("div", "divider", "root"),
    },
  };
}

beforeEach(() => {
  if (!isDefaultBlocksRegistered()) registerDefaultBlocks();
});

describe("friendlyBlockLabel", () => {
  it("maps composite and navigation types to friendly names", () => {
    expect(friendlyBlockLabel("navbar")).toBe("Top navigation");
    expect(friendlyBlockLabel("pricing-card")).toBe("Pricing card");
    expect(friendlyBlockLabel("faq-item")).toBe("Question and answer");
    expect(friendlyBlockLabel("review-card")).toBe("Customer review");
    expect(friendlyBlockLabel("heading")).toBe("Heading");
    expect(friendlyBlockLabel("paragraph")).toBe("Text");
  });

  it("falls back to the raw type for unknown types", () => {
    expect(friendlyBlockLabel("mystery-block")).toBe("mystery-block");
  });
});

describe("pluralizeFriendlyLabel", () => {
  it("keeps singular forms for count 1", () => {
    expect(pluralizeFriendlyLabel("Heading", 1)).toBe("Heading");
  });

  it("handles irregular plurals", () => {
    expect(pluralizeFriendlyLabel("Question and answer", 2)).toBe("Questions and answers");
    expect(pluralizeFriendlyLabel("Customer review", 2)).toBe("Customer reviews");
    expect(pluralizeFriendlyLabel("Top navigation", 2)).toBe("Top navigation");
  });

  it("defaults to +s", () => {
    expect(pluralizeFriendlyLabel("Badge", 2)).toBe("Badges");
  });
});

describe("buildFriendlyImportSummary", () => {
  it("hides layout-only types by default and counts them in the total", () => {
    const summary = buildFriendlyImportSummary(makeTree());
    const labels = summary.items.map((i) => i.label);
    expect(labels).not.toContain("Container");
    expect(labels).not.toContain("Divider");
    expect(summary.totalBlocks).toBe(10); // includes layout nodes
  });

  it("includes layout types when requested", () => {
    const summary = buildFriendlyImportSummary(makeTree(), { includeLayout: true });
    const labels = summary.items.map((i) => i.label);
    expect(labels).toContain("Container");
    expect(labels).toContain("Divider");
  });

  it("aggregates counts and pluralises display labels", () => {
    const summary = buildFriendlyImportSummary(makeTree());
    const paragraphs = summary.items.find((i) => i.label === "Text");
    expect(paragraphs?.count).toBe(2);
    expect(paragraphs?.displayLabel).toBe("Text blocks");
    const pricing = summary.items.find((i) => i.label === "Pricing card");
    expect(pricing?.count).toBe(3);
    expect(pricing?.displayLabel).toBe("Pricing cards");
  });

  it("orders deterministically: count desc, then label asc", () => {
    const summary = buildFriendlyImportSummary(makeTree());
    expect(summary.items[0].label).toBe("Pricing card"); // 3
    for (let i = 1; i < summary.items.length; i += 1) {
      expect(summary.items[i - 1].count).toBeGreaterThanOrEqual(summary.items[i].count);
    }
  });

  it("caps the output and reports the cap", () => {
    const summary = buildFriendlyImportSummary(makeTree(), { cap: 2 });
    expect(summary.items.length).toBe(2);
    expect(summary.capped).toBe(true);
    const uncapped = buildFriendlyImportSummary(makeTree(), { cap: 20 });
    expect(uncapped.capped).toBe(false);
  });

  it("returns an empty item list for an empty tree", () => {
    const summary = buildFriendlyImportSummary({ rootIds: [], nodes: {} });
    expect(summary.items).toEqual([]);
    expect(summary.totalBlocks).toBe(0);
  });

  it("does not mutate the input tree", () => {
    const tree = makeTree();
    const snapshot = JSON.stringify(tree);
    buildFriendlyImportSummary(tree);
    expect(JSON.stringify(tree)).toBe(snapshot);
  });
});

describe("friendlyFoundList / friendlyItemSentence", () => {
  it("produces the canonical 'We found' list", () => {
    const list = friendlyFoundList(makeTree());
    expect(list).toContain("Pricing cards");
    expect(list).toContain("Top navigation");
    expect(list).not.toContain("Container");
  });

  it("sentences respect count", () => {
    expect(friendlyItemSentence("Button", 1)).toBe("Button");
    expect(friendlyItemSentence("Button", 2)).toBe("Buttons");
  });
});
