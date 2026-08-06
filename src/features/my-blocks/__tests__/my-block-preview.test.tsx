// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// MyBlockPreview — component tests (Phase P4)
//
//   - renders the validated tree through the native block renderer
//   - caps large trees (only the shallowest nodes render)
//   - never mounts executable content: script markup in text props stays
//     inert literal text (no <script> element, no execution)
//   - empty trees show a placeholder
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { MyBlockPreview } from "../components/MyBlockPreview";
import { makeNode, makeTree } from "./helpers";

beforeEach(() => {});

describe("MyBlockPreview", () => {
  it("renders the tree content", () => {
    const tree = makeTree();
    const { container } = render(<MyBlockPreview tree={tree} />);
    expect(container.querySelector('[data-testid="my-block-preview"]')).toBeTruthy();
    expect(container.textContent).toContain("Simple pricing");
    expect(container.textContent).toContain("Pick a plan");
  });

  it("caps very large trees to the shallowest nodes", () => {
    const rootId = "big-root";
    const nodes: Record<string, ReturnType<typeof makeNode>> = {
      [rootId]: makeNode(rootId, { children: [] }),
    };
    const rootChildren: string[] = [];
    for (let i = 0; i < 120; i++) {
      const id = `child-${i}`;
      nodes[id] = makeNode(id, { parentId: rootId, children: [], type: "paragraph", props: { text: `child-${i}` } });
      rootChildren.push(id);
    }
    nodes[rootId].children = rootChildren;
    const { container } = render(<MyBlockPreview tree={{ rootIds: [rootId], nodes }} maxNodes={16} />);
    // The cap keeps the root + a few children; deep leaves never render.
    expect(container.textContent).not.toContain("child-119");
  });

  it("never mounts script content from text props as executable HTML", () => {
    const tree = makeTree();
    const rootId = tree.rootIds[0];
    // Put the payload on an existing text-bearing child (no cycles).
    const paragraphId = tree.nodes[rootId].children[1];
    tree.nodes[paragraphId].props.text = "<script>window.pwned = true</script>";
    const { container } = render(<MyBlockPreview tree={tree} />);
    // No real script element exists in the DOM.
    expect(container.querySelector("script")).toBeNull();
    // The payload is inert literal text, never executed.
    expect((window as unknown as { pwned?: boolean }).pwned).toBeUndefined();
  });

  it("shows a placeholder for an empty tree", () => {
    const { container } = render(<MyBlockPreview tree={{ rootIds: [], nodes: {} }} />);
    expect(container.textContent).toContain("Empty block");
  });

  it("is read-only and aria-hidden (decorative, not interactive)", () => {
    const { container } = render(<MyBlockPreview tree={makeTree()} />);
    const preview = container.querySelector('[data-testid="my-block-preview"]') as HTMLElement;
    expect(preview.getAttribute("aria-hidden")).toBe("true");
    expect(preview.classList.contains("pointer-events-none")).toBe(true);
  });
});
