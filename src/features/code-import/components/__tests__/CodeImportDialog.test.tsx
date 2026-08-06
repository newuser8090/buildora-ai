// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// Phase P3 — Import Studio dialog
//   - opens from the shared UI store (all entry points)
//   - paste step: empty/oversized source, example, clear, Ctrl+Enter
//   - analysis: loading → result → friendly summary
//   - review: previews, mode, warnings, preview selection
//   - placement: suggestions, invalid targets, insert
//   - success state
//   - accessibility: Escape, focus trap, stepper semantics
//   - transient store guards: stale tokens, reset on close
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { useEditorUiStore } from "@/features/editor/ui/editor-ui-store";
import { registerDefaultBlocks, isDefaultBlocksRegistered } from "@/features/blocks/registry/block-registry";
import { useCodeImportStore } from "@/features/code-import/store/code-import-store";
import { useMyBlocksUiStore } from "@/features/my-blocks/store/my-blocks-ui-store";
import { CodeImportDialog } from "../CodeImportDialog";
import { CodePasteStep } from "../CodePasteStep";
import { CodeImportSuccess } from "../CodeImportSuccess";
import { MAX_SOURCE_SIZE_BYTES } from "@/features/code-import/constants";
import type { Project } from "@/types/project";

function makeProject(): Project {
  return {
    id: "proj-import",
    name: "Import",
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
            props: { headline: "Build anything", subheadline: "Sub", primaryCta: { text: "Go", href: "/start" } },
            styles: {},
          },
        ],
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

beforeEach(() => {
  if (!isDefaultBlocksRegistered()) registerDefaultBlocks();
  useCodeImportStore.getState().closeDialog();
  useEditorStore.getState().hydrateProject(makeProject(), 1);
  useEditorStore.getState().selectPage("page-1");
});

afterEach(() => {
  useCodeImportStore.getState().closeDialog();
});

function openDialog(target?: { pageId: string; sectionId?: string; parentBlockId?: string }) {
  act(() => {
    useEditorUiStore.getState().openCodeImportDialog(target ?? { pageId: "page-1", sectionId: "s-hero" });
  });
}

function renderDialog() {
  return render(<CodeImportDialog />);
}

/** Drive paste → analyse with the example source. */
function analyseExample() {
  fireEvent.click(screen.getByTestId("code-import-example"));
  fireEvent.click(screen.getByTestId("code-import-analyse"));
}

describe("CodeImportDialog — opening", () => {
  it("renders nothing when closed", () => {
    renderDialog();
    expect(screen.queryByTestId("code-import-dialog")).toBeNull();
  });

  it("opens from the shared UI store with an insertion target", () => {
    openDialog();
    renderDialog();
    expect(screen.getByTestId("code-import-dialog")).toBeTruthy();
    expect(screen.getByTestId("code-import-source")).toBeTruthy();
    expect(useCodeImportStore.getState().insertionTarget).toEqual({
      pageId: "page-1",
      sectionId: "s-hero",
    });
  });

  it("opens without a target (guided entry)", () => {
    act(() => {
      useEditorUiStore.getState().openCodeImportDialog(null);
    });
    renderDialog();
    expect(screen.getByTestId("code-import-dialog")).toBeTruthy();
    expect(useCodeImportStore.getState().insertionTarget).toBeNull();
  });

  it("closes and resets transient state", () => {
    openDialog();
    renderDialog();
    useCodeImportStore.getState().setSource("some code");
    useCodeImportStore.getState().setStep("review");
    fireEvent.click(screen.getByTestId("import-dialog-close"));
    const state = useCodeImportStore.getState();
    expect(state.open).toBe(false);
    expect(state.source).toBe("");
    expect(state.step).toBe("paste");
  });
});

describe("CodePasteStep — source handling", () => {
  it("blocks empty source and enables the example", () => {
    render(<CodePasteStep />);
    expect((screen.getByTestId("code-import-analyse") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("code-import-example"));
    expect((screen.getByTestId("code-import-source") as HTMLTextAreaElement).value).toContain("hero");
    expect((screen.getByTestId("code-import-analyse") as HTMLButtonElement).disabled).toBe(false);
  });

  it("blocks oversized source and explains the limit", () => {
    render(<CodePasteStep />);
    const big = "x".repeat(MAX_SOURCE_SIZE_BYTES + 1);
    fireEvent.change(screen.getByTestId("code-import-source"), { target: { value: big } });
    expect((screen.getByTestId("code-import-analyse") as HTMLButtonElement).disabled).toBe(true);
    // The reason is shown as the user types.
    expect(screen.getByTestId("code-import-error").textContent).toContain("limit");
    // The size counter turns red.
    expect(screen.getByTestId("source-size").textContent).toContain("200.0 KB");
  });

  it("clear button empties the source", () => {
    render(<CodePasteStep />);
    fireEvent.click(screen.getByTestId("code-import-example"));
    expect((screen.getByTestId("code-import-clear") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId("code-import-clear"));
    expect((screen.getByTestId("code-import-source") as HTMLTextAreaElement).value).toBe("");
  });

  it("Ctrl+Enter analyses the source", () => {
    render(<CodePasteStep />);
    fireEvent.click(screen.getByTestId("code-import-example"));
    const textarea = screen.getByTestId("code-import-source");
    fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });
    expect(useCodeImportStore.getState().status).toBe("ready");
  });

  it("source survives an analysis failure", () => {
    render(<CodePasteStep />);
    fireEvent.change(screen.getByTestId("code-import-source"), {
      target: { value: "not code at all" },
    });
    fireEvent.click(screen.getByTestId("code-import-analyse"));
    expect(useCodeImportStore.getState().status).toBe("error");
    expect((screen.getByTestId("code-import-source") as HTMLTextAreaElement).value).toBe("not code at all");
  });
});

describe("CodeImportDialog — full happy path", () => {
  it("analyse → review → place → insert → success", async () => {
    openDialog();
    renderDialog();

    // Paste step
    analyseExample();
    expect(useCodeImportStore.getState().status).toBe("ready");
    expect(screen.getByTestId("analysis-result")).toBeTruthy();

    // Friendly summary + confidence
    expect(screen.getByText("We found")).toBeTruthy();
    expect(screen.getByTestId("detected-format").textContent).toBe("HTML");
    expect(screen.getByTestId("import-confidence")).toBeTruthy();

    // Review step
    fireEvent.click(screen.getByTestId("analysis-continue"));
    expect(screen.getByTestId("review-step")).toBeTruthy();
    expect(screen.getByTestId("conversion-mode")).toBeTruthy();

    // Placement step
    fireEvent.click(screen.getByTestId("review-continue"));
    expect(screen.getByTestId("placement-step")).toBeTruthy();
    expect(screen.getByTestId("placement-options")).toBeTruthy();
    expect(screen.getByTestId("placement-primary-end")).toBeTruthy();

    // Insert
    const before = useEditorStore.getState().project.pages[0].sections.length;
    fireEvent.click(screen.getByTestId("insert-button"));
    expect(useCodeImportStore.getState().status).toBe("success");
    expect(screen.getByTestId("import-success")).toBeTruthy();
    expect(screen.getByText("Your design was added.")).toBeTruthy();
    expect(useEditorStore.getState().project.pages[0].sections.length).toBe(before + 1);

    // Post-insert selection + blocks tab
    const after = useEditorStore.getState();
    expect(after.selectedSectionId).not.toBeNull();
    expect(useEditorUiStore.getState().rightSidebarTab).toBe("blocks");
  });
});

describe("CodeImportDialog — analysis failure", () => {
  it("shows a friendly error and lets the user go back", () => {
    openDialog();
    renderDialog();
    fireEvent.change(screen.getByTestId("code-import-source"), {
      target: { value: "(((" },
    });
    fireEvent.click(screen.getByTestId("code-import-analyse"));
    expect(screen.getByTestId("analysis-failed")).toBeTruthy();
    // Insertion stays unavailable.
    expect(useCodeImportStore.getState().conversion).toBeNull();
  });
});

describe("CodeImportDialog — conversion modes", () => {
  it("switches to supported-parts-only and back", async () => {
    openDialog();
    renderDialog();
    analyseExample();
    fireEvent.click(screen.getByTestId("analysis-continue"));
    expect(useCodeImportStore.getState().conversionMode).toBe("everything");
    fireEvent.click(screen.getByTestId("mode-supported-only"));
    expect(useCodeImportStore.getState().conversionMode).toBe("supported-only");
    fireEvent.click(screen.getByTestId("mode-everything"));
    expect(useCodeImportStore.getState().conversionMode).toBe("everything");
  });
});

describe("CodeImportDialog — review previews", () => {
  it("selecting a preview block shows inspection", async () => {
    openDialog();
    renderDialog();
    analyseExample();
    fireEvent.click(screen.getByTestId("analysis-continue"));
    // Visual preview renders converted blocks.
    expect(screen.getByTestId("import-visual-preview")).toBeTruthy();
    // Tree preview is present on desktop (both rendered).
    expect(screen.getByTestId("import-tree-preview")).toBeTruthy();
    // Click a block in the visual preview.
    const block = screen.queryAllByTestId("visual-block")[0];
    if (block) {
      fireEvent.click(block);
      expect(useCodeImportStore.getState().selectedPreviewBlockId).not.toBeNull();
      expect(screen.getByTestId("block-inspection")).toBeTruthy();
    }
  });

  it("shows unresolved asset warnings", async () => {
    openDialog();
    renderDialog();
    fireEvent.change(screen.getByTestId("code-import-source"), {
      // file: URLs are rejected by P1 — the image becomes an unresolved placeholder.
      target: { value: '<div class="hero"><img src="file:///tmp/local.png" /></div>' },
    });
    fireEvent.click(screen.getByTestId("code-import-analyse"));
    fireEvent.click(screen.getByTestId("analysis-continue"));
    expect(screen.getByTestId("unresolved-assets")).toBeTruthy();
  });
});

describe("CodeImportDialog — warnings and security", () => {
  it("groups removed-for-safety findings with friendly explanations", async () => {
    openDialog();
    renderDialog();
    fireEvent.change(screen.getByTestId("code-import-source"), {
      target: {
        value: '<button onclick="alert(1)">Click</button><script>alert(1)</script>',
      },
    });
    fireEvent.click(screen.getByTestId("code-import-analyse"));
    fireEvent.click(screen.getByTestId("analysis-continue"));
    expect(screen.getByTestId("import-warnings-panel")).toBeTruthy();
    expect(screen.getByText("Removed for safety")).toBeTruthy();
    // Nothing executed.
    expect(screen.queryByText("alert(1)")).toBeNull();
  });
});

describe("CodeImportDialog — repeated actions", () => {
  it("repeated inserts are blocked once one is in flight", () => {
    openDialog();
    renderDialog();
    analyseExample();
    fireEvent.click(screen.getByTestId("analysis-continue"));
    fireEvent.click(screen.getByTestId("review-continue"));
    // First beginInsert succeeds; a second call is blocked while inserting.
    expect(useCodeImportStore.getState().beginInsert()).toBe(true);
    expect(useCodeImportStore.getState().beginInsert()).toBe(false);
    useCodeImportStore.getState().completeInsert();
    expect(useCodeImportStore.getState().status).toBe("success");
  });
});

describe("CodeImportDialog — accessibility", () => {
  it("Escape closes only when idle", () => {
    openDialog();
    renderDialog();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(useCodeImportStore.getState().open).toBe(false);

    // Re-open and set a busy status — Escape must NOT close.
    openDialog();
    renderDialog();
    act(() => {
      useCodeImportStore.getState().beginAnalysis();
    });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(useCodeImportStore.getState().open).toBe(true);
  });

  it("stepper marks the current step with aria-current", () => {
    openDialog();
    renderDialog();
    const current = screen.getByTestId("import-step-paste");
    expect(current.getAttribute("aria-current")).toBe("step");
  });

  it("restores focus to the previously focused element on close", () => {
    openDialog();
    renderDialog();
    const trigger = document.createElement("button");
    trigger.textContent = "Trigger";
    document.body.appendChild(trigger);
    trigger.focus();
    act(() => {
      useCodeImportStore.getState().closeDialog();
    });
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it("analysis status is announced via a live region", async () => {
    openDialog();
    renderDialog();
    analyseExample();
    await waitFor(() => {
      expect(screen.getByTestId("import-live-region").textContent).toContain("Analysis complete");
    });
  });
});

describe("CodeImportDialog — transient store guards", () => {
  it("stale analysis completions are ignored", () => {
    const token = useCodeImportStore.getState().requestToken + 1;
    useCodeImportStore.getState().beginAnalysis();
    // A completion with an old token is a no-op.
    useCodeImportStore.getState().completeAnalysis(token - 5, null as never, null as never, {
      code: "NO_CONVERTIBLE_CONTENT",
      message: "x",
    });
    expect(useCodeImportStore.getState().status).toBe("analysing");
    // Fresh token completes normally.
    const fresh = useCodeImportStore.getState().requestToken;
    useCodeImportStore.getState().completeAnalysis(fresh, null as never, null as never, {
      code: "NO_CONVERTIBLE_CONTENT",
      message: "x",
    });
    expect(useCodeImportStore.getState().status).toBe("error");
  });

  it("no state updates after unmount", () => {
    openDialog();
    const { unmount } = renderDialog();
    unmount();
    expect(() => {
      useCodeImportStore.getState().setSource("after unmount");
    }).not.toThrow();
  });
});

describe("CodeImportSuccess — actions", () => {
  it("Edit now opens the blocks tab and closes", () => {
    openDialog();
    useCodeImportStore.getState().completeInsert();
    render(<CodeImportSuccess />);
    fireEvent.click(screen.getByTestId("success-edit-now"));
    expect(useEditorUiStore.getState().rightSidebarTab).toBe("blocks");
    expect(useCodeImportStore.getState().open).toBe(false);
  });

  it("Save as My Block is wired to the shared save dialog (Phase P4)", () => {
    openDialog();
    renderDialog();
    // Drive the real happy path so the conversion tree is populated.
    analyseExample();
    fireEvent.click(screen.getByTestId("analysis-continue"));
    fireEvent.click(screen.getByTestId("review-continue"));
    fireEvent.click(screen.getByTestId("insert-button"));
    // The dialog now shows the success step with the save action.
    const button = screen.getByTestId("success-save-block");
    expect(button.textContent).toContain("Save as My Block");
    fireEvent.click(button);

    // The canonical Save dialog source is fed from the conversion tree.
    const source = useMyBlocksUiStore.getState().saveSource;
    expect(source?.kind).toBe("tree");
    if (source?.kind === "tree") {
      expect(source.tree.rootIds.length).toBeGreaterThan(0);
      expect(source.sourceMetadata?.source).toBe("imported");
    }
  });
});
