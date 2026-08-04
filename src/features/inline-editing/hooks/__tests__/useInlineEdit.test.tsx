// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// useInlineEdit — Phase M inline editing hook tests (spec §29 subset)
//   - field selection also selects the section
//   - manual save: one history entry, no-op skips history
//   - AI suggest: suggestion stored, chat timeline updated
//   - accept: stale policy enforced before apply, one history entry
//   - reject: no history, no dirty state
//   - reset on project/page switch and section delete
//   - serial requests (no duplicate apply)
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useInlineEdit } from "../useInlineEdit";
import { useInlineEditingStore } from "../../store/inline-editing-store";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { useChatStore } from "@/features/chat/store/chat-store";
import { MOCK_PROJECT } from "@/features/editor/mock/mock-project";
import { buildDescriptorFromFieldId } from "../../registry/editable-field-registry";
import { runInlineSuggestion } from "../../services/inline-suggestion-service";
import type {
  EditableFieldDescriptor,
  InlineAiSuggestion,
} from "../../types";

vi.mock("../../services/inline-suggestion-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/inline-suggestion-service")>();
  return { ...actual, runInlineSuggestion: vi.fn() };
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const REVISION = 3;

function heroField(): EditableFieldDescriptor {
  const store = useEditorStore.getState();
  const section = store.project.pages[0].sections.find((s) => s.id === "s-hero")!;
  return buildDescriptorFromFieldId("page-1", section, "hero.headline")!;
}

function makeSuggestion(overrides: Partial<InlineAiSuggestion> = {}): InlineAiSuggestion {
  return {
    id: "sug-1",
    projectId: "proj-1",
    baseRevision: REVISION,
    pageId: "page-1",
    sectionId: "s-hero",
    sectionType: "hero",
    fieldPath: ["headline"],
    originalValue: "Build beautiful websites\nwith AI assistance",
    suggestedValue: "Ship stunning sites with AI",
    instruction: "Make this shorter",
    provider: "rule-based",
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function hydrate() {
  useEditorStore.getState().hydrateProject(
    JSON.parse(JSON.stringify(MOCK_PROJECT)),
    REVISION,
  );
}

function selectHeroField() {
  act(() => {
    useInlineEditingStore.getState().selectField(heroField(), null);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  useInlineEditingStore.getState().reset();
  useChatStore.getState().clearMessages();
  hydrate();
});

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

describe("useInlineEdit — selection", () => {
  it("selecting a field also selects its section", () => {
    const { result } = renderHook(() => useInlineEdit());
    act(() => {
      result.current.selectField(heroField(), null);
    });
    expect(useEditorStore.getState().selectedSectionId).toBe("s-hero");
    expect(useInlineEditingStore.getState().selectedField?.fieldPath).toEqual([
      "headline",
    ]);
  });

  it("clears the field selection", () => {
    const { result } = renderHook(() => useInlineEdit());
    selectHeroField();
    act(() => {
      result.current.clearField();
    });
    expect(useInlineEditingStore.getState().selectedField).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Manual editing
// ---------------------------------------------------------------------------

describe("useInlineEdit — manual editing", () => {
  it("saveDraft applies one history entry", async () => {
    const { result } = renderHook(() => useInlineEdit());
    selectHeroField();
    act(() => {
      result.current.beginEditing();
      result.current.setDraftValue("Brand new headline");
    });
    const pastBefore = useEditorStore.getState().history.past.length;
    await act(async () => {
      await result.current.saveDraft();
    });
    const store = useEditorStore.getState();
    expect(store.history.past.length).toBe(pastBefore + 1);
    const section = store.project.pages[0].sections.find((s) => s.id === "s-hero")!;
    expect(section.props.headline).toBe("Brand new headline");
    // Dirty flag is owned by the persistence controller (same as Phase K/L) —
    // the store action only advances the history stack.
  });

  it("saveDraft with an unchanged value is a no-op (no history)", async () => {
    const { result } = renderHook(() => useInlineEdit());
    selectHeroField();
    act(() => {
      result.current.beginEditing();
    });
    await act(async () => {
      await result.current.saveDraft();
    });
    const store = useEditorStore.getState();
    expect(store.history.past.length).toBe(0);
    expect(store.isDirty).toBe(false);
  });

  it("saveDraft surfaces a validation error without mutating", async () => {
    const { result } = renderHook(() => useInlineEdit());
    selectHeroField();
    act(() => {
      result.current.beginEditing();
      result.current.setDraftValue("   ");
    });
    const pastBefore = useEditorStore.getState().history.past.length;
    await act(async () => {
      await result.current.saveDraft();
    });
    expect(useInlineEditingStore.getState().mode).toBe("error");
    expect(useInlineEditingStore.getState().error?.code).toBe("INLINE_VALUE_INVALID");
    expect(useEditorStore.getState().history.past.length).toBe(pastBefore);
  });
});

// ---------------------------------------------------------------------------
// AI suggestions
// ---------------------------------------------------------------------------

describe("useInlineEdit — suggestions", () => {
  it("stores a suggestion and updates the chat timeline", async () => {
    vi.mocked(runInlineSuggestion).mockResolvedValue({
      source: "rule-based",
      suggestion: makeSuggestion(),
      warnings: [],
    });
    const { result } = renderHook(() => useInlineEdit());
    selectHeroField();

    await act(async () => {
      await result.current.suggest("Make this shorter");
    });

    const state = useInlineEditingStore.getState();
    expect(state.mode).toBe("reviewing");
    expect(state.currentSuggestion?.suggestedValue).toBe(
      "Ship stunning sites with AI",
    );
    const messages = useChatStore.getState().messages;
    expect(messages[0].role).toBe("user");
    expect(messages[1].content).toContain("Here's a suggested rewrite");
    expect(messages[1].status).toBe("complete");
  });

  it("ignores stale async responses after reset", async () => {
    let resolvePromise: (v: { source: "rule-based"; suggestion: InlineAiSuggestion; warnings: string[] }) => void = () => {};
    vi.mocked(runInlineSuggestion).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePromise = resolve;
        }),
    );
    const { result } = renderHook(() => useInlineEdit());
    selectHeroField();

    let pending: Promise<void>;
    act(() => {
      pending = result.current.suggest("shorter");
    });
    expect(useInlineEditingStore.getState().mode).toBe("suggesting");

    // Reset while in flight (project switch).
    act(() => {
      useInlineEditingStore.getState().reset();
    });

    await act(async () => {
      resolvePromise({ source: "rule-based", suggestion: makeSuggestion(), warnings: [] });
      await pending!;
    });

    expect(useInlineEditingStore.getState().currentSuggestion).toBeNull();
    expect(useInlineEditingStore.getState().mode).toBe("idle");
  });

  it("blocks overlapping requests (serial)", async () => {
    let resolvePromise: (v: { source: "rule-based"; suggestion: InlineAiSuggestion; warnings: string[] }) => void = () => {};
    vi.mocked(runInlineSuggestion).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePromise = resolve;
        }),
    );
    const { result } = renderHook(() => useInlineEdit());
    selectHeroField();

    act(() => {
      void result.current.suggest("shorter");
    });
    expect(vi.mocked(runInlineSuggestion)).toHaveBeenCalledTimes(1);
    act(() => {
      void result.current.suggest("friendlier");
    });
    expect(vi.mocked(runInlineSuggestion)).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolvePromise({ source: "rule-based", suggestion: makeSuggestion(), warnings: [] });
    });
  });
});

// ---------------------------------------------------------------------------
// Accept / reject / regenerate
// ---------------------------------------------------------------------------

describe("useInlineEdit — accept/reject", () => {
  async function prepareSuggestion() {
    vi.mocked(runInlineSuggestion).mockResolvedValue({
      source: "rule-based",
      suggestion: makeSuggestion(),
      warnings: [],
    });
    const { result } = renderHook(() => useInlineEdit());
    selectHeroField();
    await act(async () => {
      await result.current.suggest("Make this shorter");
    });
    return result;
  }

  it("accept applies one field update as one history entry", async () => {
    const result = await prepareSuggestion();
    const pastBefore = useEditorStore.getState().history.past.length;

    await act(async () => {
      await result.current.acceptSuggestion();
    });

    const store = useEditorStore.getState();
    expect(store.history.past.length).toBe(pastBefore + 1);
    const section = store.project.pages[0].sections.find((s) => s.id === "s-hero")!;
    expect(section.props.headline).toBe("Ship stunning sites with AI");
    expect(useInlineEditingStore.getState().mode).toBe("idle");
    expect(useInlineEditingStore.getState().selectedField).not.toBeNull();
    const messages = useChatStore.getState().messages;
    expect(messages[messages.length - 1].content).toContain("Applied the suggested change");
  });

  it("undo after accept restores the original value", async () => {
    const result = await prepareSuggestion();
    await act(async () => {
      await result.current.acceptSuggestion();
    });
    act(() => {
      useEditorStore.getState().undo();
    });
    const section = useEditorStore
      .getState()
      .project.pages[0].sections.find((s) => s.id === "s-hero")!;
    expect(section.props.headline).toBe(
      "Build beautiful websites\nwith AI assistance",
    );
  });

  it("re-editing after accept starts from the applied value (no stale draft)", async () => {
    const result = await prepareSuggestion();
    await act(async () => {
      await result.current.acceptSuggestion();
    });
    // Field stays selected; the descriptor must now hold the applied value.
    expect(useInlineEditingStore.getState().selectedField?.currentValue).toBe(
      "Ship stunning sites with AI",
    );
    act(() => {
      result.current.beginEditing();
    });
    expect(useInlineEditingStore.getState().draftValue).toBe(
      "Ship stunning sites with AI",
    );
  });

  it("re-editing after a manual saveDraft starts from the saved value", async () => {
    const { result } = renderHook(() => useInlineEdit());
    selectHeroField();
    act(() => {
      result.current.beginEditing();
      result.current.setDraftValue("Manually saved text");
    });
    await act(async () => {
      await result.current.saveDraft();
    });
    expect(useInlineEditingStore.getState().selectedField?.currentValue).toBe(
      "Manually saved text",
    );
    act(() => {
      result.current.beginEditing();
    });
    expect(useInlineEditingStore.getState().draftValue).toBe("Manually saved text");
  });

  it("reject creates no history and no dirty state", async () => {
    const result = await prepareSuggestion();
    const pastBefore = useEditorStore.getState().history.past.length;

    await act(async () => {
      result.current.rejectSuggestion();
    });

    const store = useEditorStore.getState();
    expect(store.history.past.length).toBe(pastBefore);
    expect(store.isDirty).toBe(false);
    expect(useInlineEditingStore.getState().currentSuggestion).toBeNull();
    const messages = useChatStore.getState().messages;
    expect(messages[messages.length - 1].content).toContain("No changes made");
  });

  it("does not apply a stale suggestion (revision mismatch) and marks stale", async () => {
    const result = await prepareSuggestion();
    act(() => {
      useEditorStore.getState().setRevision(REVISION + 1);
    });
    const pastBefore = useEditorStore.getState().history.past.length;

    await act(async () => {
      await result.current.acceptSuggestion();
    });

    const store = useEditorStore.getState();
    expect(store.history.past.length).toBe(pastBefore);
    const section = store.project.pages[0].sections.find((s) => s.id === "s-hero")!;
    expect(section.props.headline).toBe("Build beautiful websites\nwith AI assistance");
    expect(useInlineEditingStore.getState().mode).toBe("stale");
  });

  it("does not apply when the original value changed (INLINE_SUGGESTION_STALE)", async () => {
    const result = await prepareSuggestion();
    // Change the field value directly without bumping revision.
    act(() => {
      const store = useEditorStore.getState();
      const section = store.project.pages[0].sections.find((s) => s.id === "s-hero")!;
      store.updateSectionProps(section.id, { headline: "Someone else's edit" });
    });
    const pastBefore = useEditorStore.getState().history.past.length; // includes the manual edit entry

    await act(async () => {
      await result.current.acceptSuggestion();
    });

    // The stale suggestion must NOT add another history entry.
    expect(useEditorStore.getState().history.past.length).toBe(pastBefore);
    expect(useInlineEditingStore.getState().mode).toBe("stale");
    const section = useEditorStore
      .getState()
      .project.pages[0].sections.find((s) => s.id === "s-hero")!;
    expect(section.props.headline).toBe("Someone else's edit");
  });

  it("regenerate re-runs the last instruction", async () => {
    const result = await prepareSuggestion();
    expect(vi.mocked(runInlineSuggestion)).toHaveBeenCalledTimes(1);
    vi.mocked(runInlineSuggestion).mockResolvedValue({
      source: "rule-based",
      suggestion: makeSuggestion({ id: "sug-2", suggestedValue: "Another version" }),
      warnings: [],
    });
    await act(async () => {
      await result.current.regenerate();
    });
    expect(vi.mocked(runInlineSuggestion)).toHaveBeenCalledTimes(2);
    expect(useInlineEditingStore.getState().currentSuggestion?.suggestedValue).toBe(
      "Another version",
    );
  });
});

// ---------------------------------------------------------------------------
// Reset on project/page/section changes
// ---------------------------------------------------------------------------

describe("useInlineEdit — lifecycle resets", () => {
  it("clears the field when the page switches", () => {
    // Mount the hook so the editor-store subscription is active.
    renderHook(() => useInlineEdit());
    selectHeroField();
    expect(useInlineEditingStore.getState().selectedField).not.toBeNull();

    act(() => {
      useEditorStore.getState().addPage({ title: "About" });
    });
    expect(useInlineEditingStore.getState().selectedField).toBeNull();
  });

  it("clears the field when the selected section is deleted", () => {
    renderHook(() => useInlineEdit());
    selectHeroField();
    act(() => {
      useEditorStore.getState().deleteSection("s-hero");
    });
    expect(useInlineEditingStore.getState().selectedField).toBeNull();
  });

  it("resets everything when the project switches", () => {
    renderHook(() => useInlineEdit());
    selectHeroField();
    act(() => {
      useInlineEditingStore.getState().beginSuggesting("shorter");
    });
    const other = JSON.parse(JSON.stringify(MOCK_PROJECT)) as typeof MOCK_PROJECT;
    other.id = "proj-2";
    act(() => {
      useEditorStore.getState().hydrateProject(other, 1);
    });
    const state = useInlineEditingStore.getState();
    expect(state.selectedField).toBeNull();
    expect(state.mode).toBe("idle");
  });
});
