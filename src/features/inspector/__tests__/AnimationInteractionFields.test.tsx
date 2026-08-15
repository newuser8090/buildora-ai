// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// Phase P22-G — inspector Animation + Interactions sections
//   - both sections render for a selected element
//   - controls update the durable model through the store (one history entry)
//   - clearing (None / toggle off) sets the property to null
//   - unsupported actions (toggle/modal/submit/custom) are NOT exposed
//   - NavTargetPicker authoring works (page target)
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { useBlockEditorStore } from "@/features/blocks/store/block-editor-store";
import { registerDefaultBlocks, isDefaultBlocksRegistered } from "@/features/blocks/registry/block-registry";
import { registerDefaultElements } from "@/features/elements/registry/register-default-elements";
import type { Project } from "@/types/project";
import { ElementInspectorPanel } from "../components/ElementInspectorPanel";

function makeProject(): Project {
  return {
    id: "proj-p22g-inspector",
    name: "P22G Inspector",
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
              name: "Design",
              tree: {
                rootIds: ["s-custom"],
                nodes: {
                  "s-custom": {
                    id: "s-custom",
                    type: "container",
                    parentId: null,
                    children: ["b1", "b2"],
                    props: {},
                    style: {},
                    responsive: {},
                    visible: true,
                    locked: false,
                    hidden: false,
                  },
                  b1: {
                    id: "b1",
                    type: "heading",
                    parentId: "s-custom",
                    children: [],
                    props: { text: "Hello", level: 2 },
                    style: {},
                    responsive: {},
                    visible: true,
                    locked: false,
                    hidden: false,
                  },
                  b2: {
                    id: "b2",
                    type: "paragraph",
                    parentId: "s-custom",
                    children: [],
                    props: { text: "Body" },
                    style: {},
                    responsive: {},
                    visible: true,
                    locked: false,
                    hidden: false,
                  },
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

function storedNode(id: string) {
  const section = useEditorStore.getState().project.pages[0].sections[0];
  const tree = (section.props as { tree?: { nodes?: Record<string, Record<string, unknown>> } }).tree;
  return tree?.nodes?.[id];
}

function storedAnimation(id: string): unknown {
  const node = storedNode(id);
  return node?.animation;
}

function storedInteraction(id: string): unknown {
  const node = storedNode(id);
  return node?.interaction;
}

beforeEach(() => {
  if (!isDefaultBlocksRegistered()) registerDefaultBlocks();
  registerDefaultElements();
  useEditorStore.getState().hydrateProject(makeProject(), 1);
  useEditorStore.getState().setDirty(false);
  useBlockEditorStore.getState().reset();
});

function renderPanelFor(elementId: string) {
  act(() => {
    useEditorStore.getState().selectSection("s-custom");
    useBlockEditorStore.getState().selectBlock(elementId);
  });
  render(<ElementInspectorPanel pageId="page-1" sectionId="s-custom" />);
}

// Expand a collapsible inspector section by its toggle test id.
function expandSection(sectionId: string) {
  const toggle = screen.getByTestId(`inspector-section-${sectionId}-toggle`);
  fireEvent.click(toggle);
}

describe("P22-G inspector — Animation section", () => {
  it("renders the Animation group with trigger options", () => {
    renderPanelFor("b1");
    expandSection("animation");
    expect(screen.getByTestId("inspector-animation-trigger")).toBeTruthy();
    expect(screen.getByTestId("inspector-animation-trigger-load")).toBeTruthy();
    expect(screen.getByTestId("inspector-animation-trigger-none")).toBeTruthy();
    expect(screen.getByTestId("inspector-animation-preset")).toBeTruthy();
    expect(screen.getByTestId("inspector-animation-duration")).toBeTruthy();
    expect(screen.getByTestId("inspector-animation-delay")).toBeTruthy();
    expect(screen.getByTestId("inspector-animation-easing")).toBeTruthy();
    expect(screen.getByTestId("inspector-animation-repeat")).toBeTruthy();
    expect(screen.getByTestId("inspector-animation-direction")).toBeTruthy();
  });

  it("configuring an entrance animation commits the model (one history entry)", async () => {
    renderPanelFor("b1");
    expandSection("animation");
    const before = useEditorStore.getState().history.past.length;
    fireEvent.click(screen.getByTestId("inspector-animation-trigger-load"));
    await waitFor(() => {
      expect(storedAnimation("b1")).toMatchObject({ trigger: "load", type: "fade" });
    });
    expect(useEditorStore.getState().history.past.length).toBe(before + 1);

    // Switch preset — still one entry per interaction.
    fireEvent.change(screen.getByTestId("inspector-animation-preset"), { target: { value: "slide" } });
    await waitFor(() => {
      expect(storedAnimation("b1")).toMatchObject({ trigger: "load", type: "slide" });
    });
  });

  it("duration commits on blur and is bounded", async () => {
    renderPanelFor("b1");
    expandSection("animation");
    fireEvent.click(screen.getByTestId("inspector-animation-trigger-load"));
    const duration = screen.getByTestId("inspector-animation-duration");
    fireEvent.change(duration, { target: { value: "800" } });
    fireEvent.blur(duration);
    await waitFor(() => {
      expect(storedAnimation("b1")).toMatchObject({ durationMs: 800 });
    });
  });

  it("choosing None clears the animation to null", async () => {
    act(() => {
      useEditorStore.getState().updateElementAnimation("page-1", "s-custom", "b1", {
        trigger: "load",
        type: "fade",
        durationMs: 400,
      });
    });
    renderPanelFor("b1");
    expandSection("animation");
    fireEvent.click(screen.getByTestId("inspector-animation-trigger-none"));
    await waitFor(() => {
      expect(storedAnimation("b1")).toBeUndefined();
    });
  });
});

describe("P22-G inspector — Interactions section", () => {
  it("renders Click / Hover / Focus / Scroll groups only (no deferred actions)", () => {
    renderPanelFor("b1");
    expandSection("interactions");
    expect(screen.getByTestId("inspector-interaction-click-kind")).toBeTruthy();
    expect(screen.getByTestId("inspector-interaction-click-navigate")).toBeTruthy();
    expect(screen.getByTestId("inspector-interaction-click-scroll-to")).toBeTruthy();
    expect(screen.getByTestId("inspector-interaction-hover")).toBeTruthy();
    expect(screen.getByTestId("inspector-interaction-focus")).toBeTruthy();
    expect(screen.getByTestId("inspector-interaction-scroll")).toBeTruthy();
    // Deferred kinds must NOT be exposed anywhere.
    expect(screen.queryByText(/toggle/i)).toBeNull();
    expect(screen.queryByText(/modal/i)).toBeNull();
    expect(screen.queryByText(/submit/i)).toBeNull();
    expect(screen.queryByText(/custom handler/i)).toBeNull();
  });

  it("configuring click → navigate stores a typed NavTarget", async () => {
    renderPanelFor("b1");
    expandSection("interactions");
    fireEvent.click(screen.getByTestId("inspector-interaction-click-navigate"));
    await waitFor(() => {
      expect(storedInteraction("b1")).toMatchObject({
        click: { kind: "navigate", target: { kind: "page" } },
      });
    });
    const stored = storedInteraction("b1") as { click: { target: { pageId: string } } };
    expect(stored.click.target.pageId).toBe("page-1");
  });

  it("enabling hover writes a bounded effect and disabling clears it", async () => {
    renderPanelFor("b1");
    expandSection("interactions");
    const toggle = screen.getByTestId("inspector-interaction-hover");
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(storedInteraction("b1")).toMatchObject({ hover: { scale: 1.05 } });
    });

    // Edit scale through the EffectEditor.
    const scale = screen.getByTestId("inspector-interaction-hover-scale");
    fireEvent.change(scale, { target: { value: "1.1" } });
    fireEvent.blur(scale);
    await waitFor(() => {
      expect(storedInteraction("b1")).toMatchObject({ hover: { scale: 1.1 } });
    });

    // Toggle off clears hover to null.
    fireEvent.click(screen.getByTestId("inspector-interaction-hover"));
    await waitFor(() => {
      const interaction = storedInteraction("b1") as { hover: unknown } | null;
      expect(interaction?.hover).toBeNull();
    });
  });

  it("configuring scroll reveal stores a reveal animation", async () => {
    renderPanelFor("b1");
    expandSection("interactions");
    fireEvent.click(screen.getByTestId("inspector-interaction-scroll"));
    await waitFor(() => {
      expect(storedInteraction("b1")).toMatchObject({
        scroll: { kind: "reveal", animation: { trigger: "scroll" } },
      });
    });
    fireEvent.change(screen.getByTestId("inspector-interaction-scroll-preset"), {
      target: { value: "blur" },
    });
    await waitFor(() => {
      expect(storedInteraction("b1")).toMatchObject({
        scroll: { kind: "reveal", animation: { type: "blur" } },
      });
    });
  });

  it("configuring click → scroll-to lists in-tree targets", async () => {
    renderPanelFor("b1");
    expandSection("interactions");
    fireEvent.click(screen.getByTestId("inspector-interaction-click-scroll-to"));
    await waitFor(() => {
      expect(storedInteraction("b1")).toMatchObject({
        click: { kind: "scroll-to" },
      });
    });
    const select = screen.getByTestId("inspector-interaction-scroll-target") as HTMLSelectElement;
    expect(select.options.length).toBeGreaterThan(0);
  });
});
