// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// ElementInspectorPanel tests (Phase P22-C)
// Covers: correct controls by element type, editing values, keyboard commit,
// responsive switching + overrides, atomic history, undo/redo, toggles.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { useBlockEditorStore } from "@/features/blocks/store/block-editor-store";
import { useChatStore } from "@/features/chat/store/chat-store";
import { registerDefaultBlocks, isDefaultBlocksRegistered } from "@/features/blocks/registry/block-registry";
import { registerDefaultElements } from "@/features/elements/registry/register-default-elements";
import { sectionToElementTree } from "@/features/elements/adapters/section-element-adapter";
import { setElementLocked } from "@/features/elements/engine/element-operations";
import type { BaseSection } from "@/types/section";
import type { Project } from "@/types/project";
import { ElementInspectorPanel } from "../components/ElementInspectorPanel";

function makeProject(): Project {
  return {
    id: "proj-inspector",
    name: "Inspector",
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
            id: "s-hero",
            type: "hero",
            order: 1,
            visible: true,
            props: { headline: "Hi", subheadline: "", primaryCta: { text: "", href: "#" } },
            styles: {},
          },
          {
            id: "s-custom",
            type: "custom-block",
            order: 2,
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
                    children: ["h1"],
                    props: {},
                    style: { padding: "2rem" },
                    responsive: {},
                    visible: true,
                    locked: false,
                    hidden: false,
                  },
                  h1: {
                    id: "h1",
                    type: "heading",
                    parentId: "s-custom",
                    children: [],
                    props: { text: "Hello", level: 2 },
                    style: { fontSize: 24, color: "#111111" },
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

function customSection(): BaseSection {
  return useEditorStore.getState().project.pages[0].sections[1];
}

function storedHeadingNode(): {
  style?: unknown;
  viewport?: Record<string, unknown> | null;
  hidden?: unknown;
} | undefined {
  const section = customSection();
  const tree = (
    section.props as {
      tree?: { nodes?: Record<string, { style?: unknown; viewport?: unknown; hidden?: unknown }> };
    }
  ).tree;
  return tree?.nodes?.h1 as
    | { style?: unknown; viewport?: Record<string, unknown> | null; hidden?: unknown }
    | undefined;
}

beforeEach(() => {
  if (!isDefaultBlocksRegistered()) registerDefaultBlocks();
  registerDefaultElements();
  useEditorStore.getState().hydrateProject(makeProject(), 1);
  useEditorStore.getState().setDirty(false);
  useBlockEditorStore.getState().reset();
  useChatStore.getState().clearMessages();
});

function renderPanel() {
  render(
    <ElementInspectorPanel pageId="page-1" sectionId="s-custom" />,
  );
}

describe("ElementInspectorPanel — selection and controls", () => {
  it("shows the section root by default and exposes container controls", () => {
    act(() => {
      useEditorStore.getState().selectSection("s-custom");
    });
    renderPanel();
    expect(screen.getByTestId("element-inspector")).toBeTruthy();
    expect(screen.getByTestId("element-inspector-title").textContent).toBe("Container");
    // Container gets Layout with flex direction; no typography section.
    expect(screen.getByTestId("inspector-section-layout")).toBeTruthy();
    expect(screen.queryByTestId("inspector-section-typography")).toBeNull();
  });

  it("shows typography controls for a selected heading block", () => {
    act(() => {
      useEditorStore.getState().selectSection("s-custom");
      useBlockEditorStore.getState().selectBlock("h1");
    });
    renderPanel();
    expect(screen.getByTestId("element-inspector-title").textContent).toBe("Heading");
    expect(screen.getByTestId("inspector-section-typography")).toBeTruthy();
    const fontSize = screen.getByTestId("inspector-fontSize") as HTMLInputElement;
    expect(fontSize.value).toBe("24");
    // A "back to section" breadcrumb appears for nested blocks.
    expect(screen.getByTestId("element-inspector-to-root")).toBeTruthy();
  });

  it("hides the breadcrumb at the section root", () => {
    act(() => {
      useEditorStore.getState().selectSection("s-custom");
      useBlockEditorStore.getState().selectBlock(null);
    });
    renderPanel();
    expect(screen.queryByTestId("element-inspector-to-root")).toBeNull();
  });
});

describe("ElementInspectorPanel — editing + atomic history", () => {
  function selectHeading() {
    act(() => {
      useEditorStore.getState().selectSection("s-custom");
      useBlockEditorStore.getState().selectBlock("h1");
    });
  }

  it("changing font size commits ONE history entry and updates the tree", async () => {
    selectHeading();
    renderPanel();
    const before = useEditorStore.getState().history.past.length;
    const input = screen.getByTestId("inspector-fontSize");
    fireEvent.change(input, { target: { value: "32" } });
    fireEvent.blur(input);
    await waitFor(() => {
      expect(storedHeadingNode()?.style).toMatchObject({ fontSize: 32 });
    });
    expect(useEditorStore.getState().history.past.length).toBe(before + 1);
  });

  it("Enter commits the value too", async () => {
    selectHeading();
    renderPanel();
    const input = screen.getByTestId("inspector-fontSize");
    fireEvent.change(input, { target: { value: "40" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      expect(storedHeadingNode()?.style).toMatchObject({ fontSize: 40 });
    });
  });

  it("typing alone does not create history entries (transient draft)", () => {
    selectHeading();
    renderPanel();
    const before = useEditorStore.getState().history.past.length;
    const input = screen.getByTestId("inspector-fontSize");
    fireEvent.change(input, { target: { value: "100" } });
    // No blur / Enter — nothing committed.
    expect(storedHeadingNode()?.style).toMatchObject({ fontSize: 24 });
    expect(useEditorStore.getState().history.past.length).toBe(before);
  });

  it("undo reverts the inspector change and redo reapplies it", async () => {
    selectHeading();
    renderPanel();
    const input = screen.getByTestId("inspector-fontSize");
    fireEvent.change(input, { target: { value: "48" } });
    fireEvent.blur(input);
    await waitFor(() => expect(storedHeadingNode()?.style).toMatchObject({ fontSize: 48 }));
    act(() => useEditorStore.getState().undo());
    expect(storedHeadingNode()?.style).toMatchObject({ fontSize: 24 });
    act(() => useEditorStore.getState().redo());
    expect(storedHeadingNode()?.style).toMatchObject({ fontSize: 48 });
  });

  it("rejects out-of-bounds values (clamped to field max)", async () => {
    selectHeading();
    renderPanel();
    const input = screen.getByTestId("inspector-fontSize");
    fireEvent.change(input, { target: { value: "9999" } });
    fireEvent.blur(input);
    await waitFor(() => expect(storedHeadingNode()?.style).toMatchObject({ fontSize: 200 }));
  });

  it("the visibility toggle flips the stored hidden flag", async () => {
    selectHeading();
    renderPanel();
    // Expand the Advanced section first (progressive disclosure).
    fireEvent.click(screen.getByTestId("inspector-section-advanced-toggle"));
    const toggle = screen.getByTestId("inspector-hidden");
    expect(toggle.getAttribute("aria-checked")).toBe("true"); // visible
    fireEvent.click(toggle);
    await waitFor(() => expect(storedHeadingNode()?.hidden).toBe(true));
  });
});

describe("ElementInspectorPanel — responsive overrides", () => {
  function selectHeading() {
    act(() => {
      useEditorStore.getState().selectSection("s-custom");
      useBlockEditorStore.getState().selectBlock("h1");
    });
  }

  it("editing at mobile writes a viewport override without touching the base", async () => {
    selectHeading();
    renderPanel();
    fireEvent.click(screen.getByTestId("inspector-breakpoint-mobile"));
    const input = screen.getByTestId("inspector-fontSize");
    fireEvent.change(input, { target: { value: "18" } });
    fireEvent.blur(input);
    await waitFor(() => {
      expect(storedHeadingNode()?.viewport).toMatchObject({ mobile: { fontSize: 18 } });
    });
    expect(storedHeadingNode()?.style).toMatchObject({ fontSize: 24 });
    // The override badge appears for the overridden field.
    expect(screen.getByTestId("inspector-reset-override")).toBeTruthy();
  });

  it("reset override clears only the override", async () => {
    selectHeading();
    renderPanel();
    fireEvent.click(screen.getByTestId("inspector-breakpoint-mobile"));
    const input = screen.getByTestId("inspector-fontSize");
    fireEvent.change(input, { target: { value: "18" } });
    fireEvent.blur(input);
    await waitFor(() => expect(storedHeadingNode()?.viewport).toMatchObject({ mobile: { fontSize: 18 } }));
    fireEvent.click(screen.getByTestId("inspector-reset-override"));
    await waitFor(() => expect(storedHeadingNode()?.viewport?.mobile).toBeUndefined());
    expect(storedHeadingNode()?.style).toMatchObject({ fontSize: 24 });
  });

  it("switching back to desktop edits the base value", async () => {
    selectHeading();
    renderPanel();
    fireEvent.click(screen.getByTestId("inspector-breakpoint-base"));
    const input = screen.getByTestId("inspector-fontSize");
    fireEvent.change(input, { target: { value: "30" } });
    fireEvent.blur(input);
    await waitFor(() => expect(storedHeadingNode()?.style).toMatchObject({ fontSize: 30 }));
  });
});

describe("ElementInspectorPanel — Phase P22-H AI entry", () => {
  it("shows the AI composer for a custom-block section (root container targeted)", () => {
    act(() => {
      useEditorStore.getState().selectSection("s-custom");
    });
    renderPanel();
    expect(screen.getByTestId("element-ai-composer")).toBeTruthy();
    expect(screen.getByText(/Targeting:container · s-custom/i)).toBeTruthy();
  });

  it("targets the selected nested element when one is selected", () => {
    act(() => {
      useEditorStore.getState().selectSection("s-custom");
      useBlockEditorStore.getState().selectBlock("h1");
    });
    renderPanel();
    expect(screen.getByTestId("element-ai-composer")).toBeTruthy();
    expect(screen.getByText(/heading · h1/i)).toBeTruthy();
  });

  it("hides the AI composer for regular (non-custom-block) sections", () => {
    act(() => {
      useEditorStore.getState().selectSection("s-hero");
    });
    render(<ElementInspectorPanel pageId="page-1" sectionId="s-hero" />);
    expect(screen.getByTestId("element-inspector")).toBeTruthy();
    expect(screen.queryByTestId("element-ai-composer")).toBeNull();
  });

  it("submits an element-scoped instruction into the plan pipeline", async () => {
    act(() => {
      useEditorStore.getState().selectSection("s-custom");
      useBlockEditorStore.getState().selectBlock("h1");
    });
    renderPanel();
    const input = screen.getByTestId("element-ai-instruction");
    fireEvent.change(input, { target: { value: "make it bold" } });
    fireEvent.click(screen.getByTestId("element-ai-submit"));
    // The instruction flows into the shared chat as a user message.
    await waitFor(() => {
      const chat = useChatStore.getState();
      expect(chat.messages.some((m) => m.role === "user" && m.content === "make it bold")).toBe(true);
    });
  });
});

describe("ElementInspectorPanel — lock guard", () => {
  it("disables controls for locked elements", async () => {
    act(() => {
      useEditorStore.getState().selectSection("s-custom");
    });
    // Lock the heading through element ops + the store commit boundary.
    const tree = sectionToElementTree(customSection());
    const locked = setElementLocked(tree, "h1", true);
    expect(locked.ok).toBe(true);
    if (locked.ok) {
      const res = useEditorStore.getState().commitElementTree("page-1", "s-custom", locked.value);
      expect(res.ok).toBe(true);
    }
    act(() => useBlockEditorStore.getState().selectBlock("h1"));
    renderPanel();
    const input = screen.getByTestId("inspector-fontSize");
    expect((input as HTMLInputElement).disabled).toBe(true);
  });
});
