// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// Inline editing transient store tests (Phase M spec §29 subset)
//   - field selection
//   - manual update / AI accept state transitions
//   - reject
//   - page/project switch reset (via reset/clear)
//   - stale async guard via request token
//   - no duplicate apply (serial)
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { useInlineEditingStore } from "../inline-editing-store";
import type { EditableFieldDescriptor, InlineAiSuggestion } from "../../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FIELD: EditableFieldDescriptor = {
  pageId: "p1",
  sectionId: "s1",
  sectionType: "hero",
  fieldPath: ["headline"],
  kind: "heading",
  label: "Headline",
  currentValue: "Old",
  aiEditable: true,
};

function makeSuggestion(overrides: Partial<InlineAiSuggestion> = {}): InlineAiSuggestion {
  return {
    id: "sug-1",
    projectId: "proj-1",
    baseRevision: 1,
    pageId: "p1",
    sectionId: "s1",
    sectionType: "hero",
    fieldPath: ["headline"],
    originalValue: "Old",
    suggestedValue: "New and improved",
    instruction: "Make this shorter",
    provider: "rule-based",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  useInlineEditingStore.getState().reset();
});

describe("inline editing store — selection", () => {
  it("selects a field and seeds the draft with its current value", () => {
    const store = useInlineEditingStore.getState();
    store.selectField(FIELD, null);
    const state = useInlineEditingStore.getState();
    expect(state.selectedField).toEqual(FIELD);
    expect(state.mode).toBe("idle");
    expect(state.draftValue).toBe("Old");
    expect(state.instructionHistory).toEqual([]);
  });

  it("clearing a field resets suggestion + history", () => {
    const store = useInlineEditingStore.getState();
    store.selectField(FIELD, null);
    store.beginSuggesting("shorter");
    store.setSuggestion(makeSuggestion());
    store.clearField();
    const state = useInlineEditingStore.getState();
    expect(state.selectedField).toBeNull();
    expect(state.currentSuggestion).toBeNull();
    expect(state.instructionHistory).toEqual([]);
    expect(state.mode).toBe("idle");
  });

  it("selecting a different field clears conversational context", () => {
    const store = useInlineEditingStore.getState();
    store.selectField(FIELD, null);
    store.beginSuggesting("shorter");
    store.setSuggestion(makeSuggestion());
    store.selectField({ ...FIELD, fieldPath: ["subheadline"], currentValue: "Sub" }, null);
    const state = useInlineEditingStore.getState();
    expect(state.currentSuggestion).toBeNull();
    expect(state.instructionHistory).toEqual([]);
    expect(state.draftValue).toBe("Sub");
  });
});

describe("inline editing store — manual editing mode", () => {
  it("beginEditing enters editing mode with the current value", () => {
    const store = useInlineEditingStore.getState();
    store.selectField(FIELD, null);
    store.beginEditing();
    const state = useInlineEditingStore.getState();
    expect(state.mode).toBe("editing");
    expect(state.draftValue).toBe("Old");
  });

  it("setDraftValue updates the draft without a history entry", () => {
    const store = useInlineEditingStore.getState();
    store.selectField(FIELD, null);
    store.beginEditing();
    store.setDraftValue("Brand new");
    expect(useInlineEditingStore.getState().draftValue).toBe("Brand new");
  });

  it("cancelEditing returns to idle with the original value", () => {
    const store = useInlineEditingStore.getState();
    store.selectField(FIELD, null);
    store.beginEditing();
    store.setDraftValue("Changed");
    store.cancelEditing();
    const state = useInlineEditingStore.getState();
    expect(state.mode).toBe("idle");
    expect(state.draftValue).toBe("Old");
  });
});

describe("inline editing store — suggestion lifecycle", () => {
  it("beginSuggesting → suggesting mode, then setSuggestion → reviewing", () => {
    const store = useInlineEditingStore.getState();
    store.selectField(FIELD, null);
    store.beginSuggesting("shorter");
    expect(useInlineEditingStore.getState().mode).toBe("suggesting");
    store.setSuggestion(makeSuggestion());
    const state = useInlineEditingStore.getState();
    expect(state.mode).toBe("reviewing");
    expect(state.currentSuggestion?.suggestedValue).toBe("New and improved");
  });

  it("tracks a capped instruction history for follow-ups", () => {
    const store = useInlineEditingStore.getState();
    store.selectField(FIELD, null);
    for (let i = 0; i < 10; i += 1) {
      store.beginSuggesting(`instruction-${i}`);
    }
    const history = useInlineEditingStore.getState().instructionHistory;
    expect(history.length).toBeLessThanOrEqual(6);
    expect(history[history.length - 1]).toBe("instruction-9");
  });

  it("does not duplicate the same instruction consecutively", () => {
    const store = useInlineEditingStore.getState();
    store.selectField(FIELD, null);
    store.beginSuggesting("shorter");
    store.beginSuggesting("shorter");
    expect(useInlineEditingStore.getState().instructionHistory).toEqual(["shorter"]);
  });

  it("rejectSuggestion clears the suggestion and returns to idle", () => {
    const store = useInlineEditingStore.getState();
    store.selectField(FIELD, null);
    store.beginSuggesting("shorter");
    store.setSuggestion(makeSuggestion());
    store.rejectSuggestion();
    const state = useInlineEditingStore.getState();
    expect(state.mode).toBe("idle");
    expect(state.currentSuggestion).toBeNull();
  });

  it("applyComplete clears the suggestion and keeps the field selected", () => {
    const store = useInlineEditingStore.getState();
    store.selectField(FIELD, null);
    store.beginSuggesting("shorter");
    store.setSuggestion(makeSuggestion());
    store.setApplying();
    expect(useInlineEditingStore.getState().mode).toBe("applying");
    store.applyComplete();
    const state = useInlineEditingStore.getState();
    expect(state.mode).toBe("idle");
    expect(state.currentSuggestion).toBeNull();
    expect(state.selectedField).toEqual(FIELD);
  });

  it("applyComplete with an applied value refreshes the descriptor + draft", () => {
    const store = useInlineEditingStore.getState();
    store.selectField(FIELD, null);
    store.beginSuggesting("shorter");
    store.setSuggestion(makeSuggestion());
    store.setApplying();
    store.applyComplete("New and improved");
    const state = useInlineEditingStore.getState();
    expect(state.selectedField?.currentValue).toBe("New and improved");
    expect(state.draftValue).toBe("New and improved");
  });

  it("setError enters error mode with a structured error", () => {
    const store = useInlineEditingStore.getState();
    store.selectField(FIELD, null);
    store.setError({ code: "INLINE_SUGGESTION_FAILED", message: "boom" });
    const state = useInlineEditingStore.getState();
    expect(state.mode).toBe("error");
    expect(state.error?.code).toBe("INLINE_SUGGESTION_FAILED");
  });

  it("setStale enters stale mode", () => {
    const store = useInlineEditingStore.getState();
    store.selectField(FIELD, null);
    store.setStale();
    expect(useInlineEditingStore.getState().mode).toBe("stale");
  });
});

describe("inline editing store — resets + async guards", () => {
  it("reset clears everything and bumps the request token", () => {
    const store = useInlineEditingStore.getState();
    store.selectField(FIELD, null);
    store.beginSuggesting("shorter");
    const tokenBefore = useInlineEditingStore.getState().requestToken;
    store.reset();
    const state = useInlineEditingStore.getState();
    expect(state.selectedField).toBeNull();
    expect(state.mode).toBe("idle");
    expect(state.requestToken).toBe(tokenBefore + 1);
  });

  it("nextRequestToken increments monotonically (stale async guard)", () => {
    const store = useInlineEditingStore.getState();
    const a = store.nextRequestToken();
    const b = store.nextRequestToken();
    expect(b).toBe(a + 1);
  });

  it("stores and clears an anchor element", () => {
    const store = useInlineEditingStore.getState();
    const el = document.createElement("div");
    store.setAnchor(el);
    expect(useInlineEditingStore.getState().anchorEl).toBe(el);
    store.clearField();
    expect(useInlineEditingStore.getState().anchorEl).toBeNull();
  });

  it("aiPromptOpen toggles and resets on select/clear", () => {
    const store = useInlineEditingStore.getState();
    store.setAiPromptOpen(true);
    expect(useInlineEditingStore.getState().aiPromptOpen).toBe(true);
    store.selectField(FIELD, null);
    expect(useInlineEditingStore.getState().aiPromptOpen).toBe(false);
    store.setAiPromptOpen(true);
    store.clearField();
    expect(useInlineEditingStore.getState().aiPromptOpen).toBe(false);
  });
});
