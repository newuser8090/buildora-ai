// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// AI Copilot — panel component tests (spec §2, §9)
//   - open/close (including Escape)
//   - starter prompts
//   - scope indicator (never pretends a selection exists)
//   - planning → approval → apply → change summary → undo
//   - cancel / retry / error states
//   - element quick actions (selected text)
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { useInlineEditingStore } from "@/features/inline-editing/store/inline-editing-store";
import { useCopilotStore } from "../../store/copilot-store";
import { CopilotPanel } from "../CopilotPanel";
import { handleCopilotMessage } from "../../services/copilot-service";
import type { EditableFieldDescriptor } from "@/features/inline-editing/types";
import {
  hydrateEditor,
  makePlan,
  diffsForPlan,
} from "../../__tests__/helpers";

vi.mock("../../services/copilot-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/copilot-service")>();
  return {
    ...actual,
    handleCopilotMessage: vi.fn(),
    requestElementSuggestion: vi.fn(),
  };
});

function resetStores() {
  useCopilotStore.setState({
    open: false,
    status: "idle",
    scopeChoice: "auto",
    messages: [],
    planState: null,
    elementSuggestion: null,
    error: null,
    appliedSummary: null,
    lastRequest: null,
    requestSeq: 0,
    styleNotes: [],
    memoryRestored: false,
  });
  useInlineEditingStore.setState({ selectedField: null } as never);
  hydrateEditor();
}

beforeEach(() => {
  resetStores();
  vi.mocked(handleCopilotMessage).mockReset();
});

function renderOpen() {
  useCopilotStore.getState().openPanel();
  return render(<CopilotPanel />);
}

function heroField(): EditableFieldDescriptor {
  return {
    pageId: "page-1",
    sectionId: "s-hero",
    sectionType: "hero",
    fieldPath: ["headline"],
    kind: "textarea",
    label: "Headline",
    currentValue: "Build beautiful websites\nwith AI assistance",
    aiEditable: true,
  };
}

async function typeAndSend(text: string) {
  const input = screen.getByTestId("copilot-input");
  fireEvent.change(input, { target: { value: text } });
  fireEvent.click(screen.getByTestId("copilot-send"));
  await act(async () => {});
}

describe("open / close", () => {
  it("renders nothing when closed", () => {
    render(<CopilotPanel />);
    expect(screen.queryByTestId("copilot-panel")).toBeNull();
  });

  it("renders the panel with an accessible label when open", () => {
    renderOpen();
    expect(screen.getByTestId("copilot-panel")).toBeTruthy();
    expect(screen.getByRole("complementary").getAttribute("aria-label")).toBe("AI Copilot");
  });

  it("closes on Escape", () => {
    renderOpen();
    expect(screen.getByTestId("copilot-panel")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useCopilotStore.getState().open).toBe(false);
  });

  it("closes via the close button", () => {
    renderOpen();
    fireEvent.click(screen.getByTestId("copilot-close"));
    expect(useCopilotStore.getState().open).toBe(false);
  });
});

describe("starter prompts", () => {
  it("shows starter prompts on a fresh conversation", () => {
    renderOpen();
    expect(screen.getByText("Try asking")).toBeTruthy();
    expect(screen.getByTestId("copilot-starter-check-this-page-for-obvious-problems")).toBeTruthy();
  });

  it("sends a starter prompt as a user message", async () => {
    vi.mocked(handleCopilotMessage).mockResolvedValue({
      kind: "ask",
      answer: "Here is a helpful answer.",
    });
    renderOpen();
    fireEvent.click(screen.getByTestId("copilot-starter-check-this-page-for-obvious-problems"));

    await waitFor(() => {
      expect(screen.getByTestId("copilot-msg-user").textContent).toContain(
        "Check this page for obvious problems",
      );
    });
    expect(vi.mocked(handleCopilotMessage)).toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByText("Here is a helpful answer.")).toBeTruthy();
    });
  });
});

describe("scope indicator", () => {
  it("defaults to the current page when nothing is selected (never a fake selection)", () => {
    renderOpen();
    // Beginner-friendly default: the active page.
    expect(screen.getByTestId("copilot-scope-badge").textContent).toContain("Homepage");
    expect(screen.getByTestId("copilot-scope-badge").textContent).not.toContain("selected text");
  });

  it("reflects the live section selection", () => {
    useEditorStore.getState().selectPage("page-1");
    useEditorStore.getState().selectSection("s-hero");
    renderOpen();
    expect(screen.getByTestId("copilot-scope-badge").textContent).toContain("Hero section");
  });

  it("exposes scope options in a listbox", () => {
    renderOpen();
    fireEvent.click(screen.getByTestId("copilot-scope-badge"));
    expect(screen.getByTestId("copilot-scope-options")).toBeTruthy();
    expect(screen.getByTestId("copilot-scope-option-project")).toBeTruthy();
    expect(screen.getByTestId("copilot-scope-option-page")).toBeTruthy();
  });
});

describe("planning → approval → apply → undo", () => {
  it("shows a thinking state while planning", async () => {
    let resolveMessage: (value: never) => void = () => {};
    vi.mocked(handleCopilotMessage).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveMessage = resolve as (value: never) => void;
        }),
    );
    renderOpen();
    await typeAndSend("Make this page more premium");
    expect(screen.getByTestId("copilot-thinking")).toBeTruthy();
    await act(async () => {
      resolveMessage({
        kind: "error",
        error: { code: "COPILOT_PLAN_FAILED", message: "x", retryable: false },
      } as never);
    });
  });

  it("reviews a plan, applies it as one atomic change, and undoes it", async () => {
    const plan = makePlan();
    vi.mocked(handleCopilotMessage).mockResolvedValue({
      kind: "plan-ready",
      planState: {
        plan,
        diffs: diffsForPlan(plan),
        selectedOperationIds: ["op-1"],
        warnings: [],
      },
      lastRequest: { instruction: "Hide the FAQ", scope: { type: "page", pageId: "page-1" } },
    });

    renderOpen();
    await typeAndSend("Hide the FAQ");

    // Plan preview appears with the operation.
    await waitFor(() => {
      expect(screen.getByTestId("copilot-plan-review")).toBeTruthy();
    });
    expect(screen.getByText("AI suggests 1 change")).toBeTruthy();
    expect(
      (screen.getByTestId("copilot-op-checkbox-op-1") as HTMLInputElement).checked,
    ).toBe(true);

    // Apply — real applyCopilotPlan → editor store (one history entry).
    fireEvent.click(screen.getByTestId("copilot-apply"));
    await waitFor(() => {
      expect(screen.getByTestId("copilot-change-summary")).toBeTruthy();
    });
    expect(screen.getByTestId("copilot-change-summary").textContent).toContain("Done — updated 1 thing");

    const store = useEditorStore.getState();
    const faq = store.project.pages[0].sections.find((s) => s.id === "s-faq")!;
    expect(faq.visible).toBe(false);
    expect(store.history.past.length).toBe(1);

    // Undo restores the previous state through the normal history.
    fireEvent.click(screen.getByTestId("copilot-undo"));
    await waitFor(() => {
      const after = useEditorStore.getState().project.pages[0].sections.find((s) => s.id === "s-faq")!;
      expect(after.visible).toBe(true);
    });
  });

  it("cancel discards the plan and starts fresh", async () => {
    const plan = makePlan();
    vi.mocked(handleCopilotMessage).mockResolvedValue({
      kind: "plan-ready",
      planState: {
        plan,
        diffs: diffsForPlan(plan),
        selectedOperationIds: ["op-1"],
        warnings: [],
      },
      lastRequest: { instruction: "Hide the FAQ", scope: { type: "page", pageId: "page-1" } },
    });

    renderOpen();
    await typeAndSend("Hide the FAQ");
    await waitFor(() => {
      expect(screen.getByTestId("copilot-plan-review")).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("copilot-cancel-plan"));
    expect(useCopilotStore.getState().planState).toBeNull();
    expect(useCopilotStore.getState().messages).toEqual([]);
  });
});

describe("error and retry", () => {
  it("shows a beginner-safe error and retries the last request", async () => {
    vi.mocked(handleCopilotMessage)
      .mockResolvedValueOnce({
        kind: "error",
        error: {
          code: "COPILOT_PROVIDER_FAILED",
          message: "I couldn't prepare that suggestion right now. Please try again.",
          retryable: true,
        },
      })
      .mockResolvedValueOnce({
        kind: "ask",
        answer: "Second attempt succeeded.",
      });

    renderOpen();
    await typeAndSend("Make it shorter");
    await waitFor(() => {
      expect(screen.getByTestId("copilot-error")).toBeTruthy();
    });
    expect(screen.getByTestId("copilot-error").textContent).toContain(
      "I couldn't prepare that suggestion",
    );

    fireEvent.click(screen.getByTestId("copilot-retry"));
    await waitFor(() => {
      expect(screen.getByText("Second attempt succeeded.")).toBeTruthy();
    });
    expect(vi.mocked(handleCopilotMessage)).toHaveBeenCalledTimes(2);
  });

  it("offers Start over from an error", async () => {
    vi.mocked(handleCopilotMessage).mockResolvedValue({
      kind: "error",
      error: {
        code: "COPILOT_PLAN_STALE",
        message: "Try again.",
        retryable: true,
      },
    });
    renderOpen();
    await typeAndSend("Hide the FAQ");
    await waitFor(() => {
      expect(screen.getByTestId("copilot-error")).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("copilot-error-dismiss"));
    expect(useCopilotStore.getState().messages).toEqual([]);
    expect(useCopilotStore.getState().error).toBeNull();
  });
});

describe("element quick actions", () => {
  it("does not offer element actions without a text selection", () => {
    renderOpen();
    expect(screen.queryByTestId("copilot-quick-rewrite")).toBeNull();
  });

  it("offers element actions when a text field is selected and applies a suggestion", async () => {
    useInlineEditingStore.setState({ selectedField: heroField() } as never);
    useEditorStore.getState().selectPage("page-1");
    useEditorStore.getState().selectSection("s-hero");

    const { requestElementSuggestion } = await import("../../services/copilot-service");
    vi.mocked(requestElementSuggestion).mockResolvedValue({
      ok: true,
      suggestion: {
        id: "sug-1",
        projectId: "proj-1",
        baseRevision: 3,
        pageId: "page-1",
        sectionId: "s-hero",
        sectionType: "hero",
        fieldPath: ["headline"],
        originalValue: "Build beautiful websites\nwith AI assistance",
        suggestedValue: "Ship faster with AI",
        instruction: "Rewrite this text with fresh, high-quality copy.",
        explanation: "Sharper and more action-oriented.",
        provider: "rule-based",
        createdAt: "2026-08-01T00:00:00.000Z",
      },
    });

    renderOpen();
    expect(screen.getByTestId("copilot-quick-rewrite")).toBeTruthy();

    fireEvent.click(screen.getByTestId("copilot-quick-rewrite"));
    await waitFor(() => {
      expect(screen.getByTestId("copilot-element-suggestion")).toBeTruthy();
    });
    expect(screen.getByTestId("copilot-element-suggestion").textContent).toContain(
      "Ship faster with AI",
    );

    // Apply uses the real applyElementSuggestion → editor store.
    fireEvent.click(screen.getByTestId("copilot-apply-suggestion"));
    await waitFor(() => {
      const hero = useEditorStore
        .getState()
        .project.pages[0].sections.find((s) => s.id === "s-hero")!;
      expect((hero.props as Record<string, unknown>).headline).toBe("Ship faster with AI");
    });
    expect(screen.getByTestId("copilot-change-summary")).toBeTruthy();
  });

  it("routes page quick actions through the normal message flow", async () => {
    vi.mocked(handleCopilotMessage).mockResolvedValue({
      kind: "plan-ready",
      planState: {
        plan: makePlan(),
        diffs: diffsForPlan(makePlan()),
        selectedOperationIds: ["op-1"],
        warnings: [],
      },
      lastRequest: { instruction: "Improve this page's copy", scope: { type: "page", pageId: "page-1" } },
    });
    renderOpen();
    // Page quick actions are available without a selection.
    fireEvent.click(screen.getByTestId("copilot-quick-improve-page"));
    await waitFor(() => {
      expect(screen.getByTestId("copilot-plan-review")).toBeTruthy();
    });
    expect(vi.mocked(handleCopilotMessage)).toHaveBeenCalledTimes(1);
  });
});

describe("project memory (Phase P11)", () => {
  it("shows the restored-conversation hint when memory was hydrated", () => {
    useCopilotStore.setState({
      memoryRestored: true,
      messages: [
        { id: "m1", role: "user", content: "Make it friendlier", createdAt: 1 },
        { id: "m2", role: "assistant", content: "Done.", createdAt: 2 },
      ],
      styleNotes: ["keep it friendly"],
    });
    renderOpen();
    expect(screen.getByTestId("copilot-memory-restored")).toBeTruthy();
    // The restored conversation is visible.
    expect(screen.getByText("Make it friendlier")).toBeTruthy();
  });

  it("does not show the hint on a fresh conversation", () => {
    renderOpen();
    expect(screen.queryByTestId("copilot-memory-restored")).toBeNull();
  });

  it("adds a style note from the panel and renders it as a chip", () => {
    renderOpen();
    const input = screen.getByTestId("style-note-input");
    fireEvent.change(input, { target: { value: "keep it friendly" } });
    fireEvent.click(screen.getByTestId("style-note-add"));
    expect(useCopilotStore.getState().styleNotes).toEqual(["keep it friendly"]);
    expect(screen.getByText("keep it friendly")).toBeTruthy();
  });

  it("removes a style note via the chip button", () => {
    useCopilotStore.setState({ styleNotes: ["keep it friendly", "short paragraphs"] });
    renderOpen();
    fireEvent.click(screen.getAllByTestId("style-note-remove")[0]);
    expect(useCopilotStore.getState().styleNotes).toEqual(["short paragraphs"]);
  });

  it("forgets all style notes", () => {
    useCopilotStore.setState({ styleNotes: ["a", "b"] });
    renderOpen();
    fireEvent.click(screen.getByTestId("style-note-clear-all"));
    expect(useCopilotStore.getState().styleNotes).toEqual([]);
  });
});
