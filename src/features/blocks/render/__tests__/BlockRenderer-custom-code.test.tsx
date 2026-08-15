// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// Phase P23-D — BlockRenderer custom-code placeholder
//
// The editor/preview/thumbnail/share surfaces NEVER execute custom code and
// NEVER mount an iframe/srcDoc: a node with EXPLICITLY ENABLED custom code
// renders as an inert placeholder that preserves selection/click behavior.
// Disabled (or absent) custom code renders exactly as before.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { registerDefaultBlocks, isDefaultBlocksRegistered } from "../../registry/block-registry";
import { BlockRenderer } from "../BlockRenderer";
import type { BlockTree, BlockNode } from "../../types";

beforeEach(() => {
  if (!isDefaultBlocksRegistered()) registerDefaultBlocks();
});

function node(id: string, overrides: Partial<BlockNode> = {}): BlockNode {
  return {
    id,
    type: "heading",
    parentId: null,
    children: [],
    props: { text: "Hello" },
    style: {},
    responsive: {},
    visible: true,
    locked: false,
    hidden: false,
    ...overrides,
  } as BlockNode;
}

function treeWithNodes(nodes: Record<string, BlockNode>): BlockTree {
  return { rootIds: Object.keys(nodes), nodes };
}

describe("BlockRenderer — enabled custom code placeholder (P23-D)", () => {
  it("renders an inert placeholder instead of the real content", () => {
    const tree = treeWithNodes({
      n1: node("n1", {
        customCode: { enabled: true, html: "<marquee>hi</marquee>", css: "p{}", js: "alert(1)" },
      } as unknown as Partial<BlockNode>),
    });
    const { container } = render(<BlockRenderer tree={tree} />);
    expect(screen.getByTestId("block-custom-code-placeholder")).toBeTruthy();
    // The node's real content is NOT rendered.
    expect(screen.queryByText("Hello")).toBeNull();
    // The user's code text never reaches the DOM.
    expect(container.textContent).not.toContain("marquee");
    expect(container.textContent).not.toContain("alert(1)");
    expect(container.textContent).not.toContain("p{}");
  });

  it("never mounts an iframe, srcDoc, or script anywhere", () => {
    const tree = treeWithNodes({
      n1: node("n1", {
        customCode: { enabled: true, js: "document.write(1)" },
      } as unknown as Partial<BlockNode>),
    });
    const { container } = render(<BlockRenderer tree={tree} />);
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("[srcdoc]")).toBeNull();
  });

  it("preserves selection/click behavior on the placeholder", () => {
    const onSelectBlock = vi.fn();
    const tree = treeWithNodes({
      n1: node("n1", { customCode: { enabled: true } } as unknown as Partial<BlockNode>),
    });
    render(<BlockRenderer tree={tree} onSelectBlock={onSelectBlock} />);
    fireEvent.click(screen.getByTestId("block-custom-code-placeholder"));
    expect(onSelectBlock).toHaveBeenCalledWith("n1");
  });

  it("hidden nodes with enabled custom code still return null (hooks unconditional)", () => {
    const tree = treeWithNodes({
      n1: node("n1", {
        hidden: true,
        customCode: { enabled: true },
      } as unknown as Partial<BlockNode>),
    });
    const { container } = render(<BlockRenderer tree={tree} />);
    expect(screen.queryByTestId("block-custom-code-placeholder")).toBeNull();
    expect(container.querySelector("[data-block-id]")).toBeNull();
  });
});

describe("BlockRenderer — disabled/absent custom code renders exactly as before (P23-D)", () => {
  it("legacy (enabled-absent) custom code renders the normal node", () => {
    const tree = treeWithNodes({
      n1: node("n1", { customCode: { css: "p{}", js: "x()" } } as unknown as Partial<BlockNode>),
    });
    const { container } = render(<BlockRenderer tree={tree} />);
    expect(screen.getByTestId("block-heading")).toBeTruthy();
    expect(screen.getByText("Hello")).toBeTruthy();
    expect(screen.queryByTestId("block-custom-code-placeholder")).toBeNull();
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("explicit enabled:false custom code renders the normal node", () => {
    const tree = treeWithNodes({
      n1: node("n1", { customCode: { enabled: false, js: "x()" } } as unknown as Partial<BlockNode>),
    });
    render(<BlockRenderer tree={tree} />);
    expect(screen.getByTestId("block-heading")).toBeTruthy();
    expect(screen.getByText("Hello")).toBeTruthy();
  });

  it("nodes without custom code are unchanged", () => {
    const tree = treeWithNodes({ n1: node("n1") });
    render(<BlockRenderer tree={tree} />);
    expect(screen.getByTestId("block-heading")).toBeTruthy();
    expect(screen.getByText("Hello")).toBeTruthy();
    expect(screen.queryByTestId("block-custom-code-placeholder")).toBeNull();
  });

  it("non-leaf content nodes keep their own rendering", () => {
    const tree = treeWithNodes({
      n1: node("n1", { type: "paragraph", props: { text: "Body" } }),
    });
    render(<BlockRenderer tree={tree} />);
    expect(screen.getByTestId("block-paragraph")).toBeTruthy();
    expect(screen.getByText("Body")).toBeTruthy();
  });
});
