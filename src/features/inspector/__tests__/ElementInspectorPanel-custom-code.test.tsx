// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// Phase P23-D — end-to-end custom-code handoff
//
//   editor:      ElementInspectorPanel → Custom Code section → enable (with
//                explicit confirmation) → author code → commit
//   persistence: commitElementTree folds the enabled payload back into the
//                section's stored tree (survives the custom-block schema)
//   export:      the stored enabled payload produces a srcdocs entry in the
//                generated page (the P23-C emission path), and the emitted
//                tree carries only the opt-in flag
//
// Also verifies (D-note): the AI plan vocabulary contains NO custom-code
// operation — custom code is author-only in P23-D.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { useBlockEditorStore } from "@/features/blocks/store/block-editor-store";
import { registerDefaultBlocks, isDefaultBlocksRegistered } from "@/features/blocks/registry/block-registry";
import { registerDefaultElements } from "@/features/elements/registry/register-default-elements";
import type { Project } from "@/types/project";
import { ElementInspectorPanel } from "../components/ElementInspectorPanel";
import { CUSTOM_BLOCK_SECTION_TYPE } from "@/features/code-import/schemas/custom-block-schema";
import { computePageRoutes } from "@/features/routing/routes";
import { generatePageFile } from "@/features/export/generators/page-generator";
import { AiEditOperationSchema } from "@/features/ai-editing/schemas/plan-schemas";

function makeProject(): Project {
  return {
    id: "proj-p23d-inspector",
    name: "P23D Inspector",
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
              tree: {
                rootIds: ["s-custom"],
                nodes: {
                  "s-custom": {
                    id: "s-custom",
                    type: "container",
                    parentId: null,
                    children: ["b1"],
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

function storedCustomCode(id: string): unknown {
  const section = useEditorStore.getState().project.pages[0].sections[0];
  const tree = (section.props as { tree?: { nodes?: Record<string, Record<string, unknown>> } }).tree;
  return tree?.nodes?.[id]?.customCode;
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

function expandSection(sectionId: string) {
  fireEvent.click(screen.getByTestId(`inspector-section-${sectionId}-toggle`));
}

describe("P23-D inspector — Custom Code section (leaf blocks only)", () => {
  it("renders the Custom Code section for a leaf heading node", () => {
    renderPanelFor("b1");
    expandSection("custom-code");
    expect(screen.getByTestId("custom-code-add")).toBeTruthy();
    expect(screen.queryByTestId("custom-code-html")).toBeNull();
  });

  it("does not render the Custom Code section for the container root", () => {
    renderPanelFor("s-custom");
    expect(screen.queryByTestId("inspector-section-custom-code-toggle")).toBeNull();
  });
});

describe("P23-D e2e — inspector → persistence → export handoff", () => {
  it("enabling with confirmation and authoring code persists enabled data and reaches export", async () => {
    renderPanelFor("b1");
    expandSection("custom-code");

    // 1. Enable (explicit confirmation).
    fireEvent.click(screen.getByTestId("custom-code-add"));
    expect(screen.getByTestId("custom-code-confirm")).toBeTruthy();
    fireEvent.click(screen.getByTestId("custom-code-confirm-enable"));

    // 2. Author CSS — commits on blur.
    const css = screen.getByTestId("custom-code-css") as HTMLTextAreaElement;
    fireEvent.change(css, { target: { value: "p { color: red; }" } });
    fireEvent.blur(css);

    // 3. Persisted through the store (one history entry per interaction).
    await waitFor(() => {
      expect(storedCustomCode("b1")).toMatchObject({ enabled: true, css: "p { color: red; }" });
    });

    // 4. Export handoff — the stored enabled payload drives a srcdocs entry.
    const project = useEditorStore.getState().project;
    const routes = computePageRoutes(project.pages);
    const page = generatePageFile(project, project.pages[0], routes);
    expect(page.content).toContain("srcdocs={");
    expect(page.content).toContain('"b1"');
    // The emitted tree never carries the code text — only the opt-in flag.
    expect(page.content).not.toContain("customCode\\\":{\\\"css\\\"");
  });

  it("disabling after authoring keeps the payload inert and drops it from export", async () => {
    renderPanelFor("b1");
    expandSection("custom-code");

    fireEvent.click(screen.getByTestId("custom-code-add"));
    fireEvent.click(screen.getByTestId("custom-code-confirm-enable"));
    const css = screen.getByTestId("custom-code-css") as HTMLTextAreaElement;
    fireEvent.change(css, { target: { value: "p{}" } });
    fireEvent.blur(css);
    await waitFor(() => {
      expect(storedCustomCode("b1")).toMatchObject({ enabled: true, css: "p{}" });
    });

    // Disable → payload stays, enabled flips to false.
    fireEvent.click(screen.getByTestId("custom-code-disable"));
    await waitFor(() => {
      expect(storedCustomCode("b1")).toMatchObject({ enabled: false, css: "p{}" });
    });

    // Export drops it entirely (no srcdocs entry, no code text).
    const project = useEditorStore.getState().project;
    const routes = computePageRoutes(project.pages);
    const page = generatePageFile(project, project.pages[0], routes);
    expect(page.content).not.toContain("srcdocs=");
    expect(page.content).not.toContain("p{}");
  });

  it("removing clears customCode from the stored tree", async () => {
    renderPanelFor("b1");
    expandSection("custom-code");
    fireEvent.click(screen.getByTestId("custom-code-add"));
    fireEvent.click(screen.getByTestId("custom-code-confirm-enable"));
    await waitFor(() => {
      expect(storedCustomCode("b1")).toMatchObject({ enabled: true });
    });
    fireEvent.click(screen.getByTestId("custom-code-remove"));
    await waitFor(() => {
      expect(storedCustomCode("b1")).toBeUndefined();
    });
  });
});

describe("P23-D — no AI custom-code operation (author-only surface)", () => {
  it("the AI edit operation vocabulary has no custom-code member", () => {
    const result = AiEditOperationSchema.safeParse({
      type: "update-element-custom-code",
      pageId: "page-1",
      sectionId: "s-custom",
      elementId: "b1",
      code: { enabled: true, css: "p{}" },
    });
    // The unknown discriminator is rejected, and the error enumerates the
    // ENTIRE valid operation vocabulary — none of which is a custom-code op.
    expect(result.success).toBe(false);
    if (!result.success) {
      const message = JSON.stringify(result.error.issues);
      expect(message).toContain("Invalid discriminator value");
      expect(message).not.toContain("custom-code");
    }
  });
});
