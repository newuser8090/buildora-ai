// ---------------------------------------------------------------------------
// AI Copilot — project memory store tests (Phase P11)
//   - style note add/remove/clear bounds + dedupe
//   - hydrateMemory restores ONLY messages + style notes (never plan state)
//   - clearConversation clears style notes and memory flags
//   - reset clears memory flags
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { useCopilotStore } from "../store/copilot-store";
import { COPILOT_MEMORY_LIMITS } from "../constants";
import { makePlan } from "./helpers";

function resetStore() {
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
}

beforeEach(() => {
  resetStore();
});

describe("style notes (Phase P11)", () => {
  it("adds and removes notes", () => {
    const store = useCopilotStore.getState();
    store.addStyleNote("keep it friendly");
    store.addStyleNote("use British spelling");
    expect(useCopilotStore.getState().styleNotes).toEqual([
      "keep it friendly",
      "use British spelling",
    ]);

    store.removeStyleNote("keep it friendly");
    expect(useCopilotStore.getState().styleNotes).toEqual([
      "use British spelling",
    ]);
  });

  it("dedupes and trims notes", () => {
    const store = useCopilotStore.getState();
    store.addStyleNote("  keep it friendly  ");
    store.addStyleNote("keep it friendly");
    expect(useCopilotStore.getState().styleNotes).toEqual(["keep it friendly"]);
  });

  it("caps the note count at the limit", () => {
    const store = useCopilotStore.getState();
    for (let i = 0; i < COPILOT_MEMORY_LIMITS.maxStyleNotes + 5; i += 1) {
      store.addStyleNote(`note ${i}`);
    }
    const notes = useCopilotStore.getState().styleNotes;
    expect(notes.length).toBe(COPILOT_MEMORY_LIMITS.maxStyleNotes);
  });

  it("caps a single note length", () => {
    const long = "x".repeat(COPILOT_MEMORY_LIMITS.maxStyleNoteLength + 50);
    useCopilotStore.getState().addStyleNote(long);
    const notes = useCopilotStore.getState().styleNotes;
    expect(notes[0].length).toBe(COPILOT_MEMORY_LIMITS.maxStyleNoteLength);
  });

  it("clears all notes", () => {
    const store = useCopilotStore.getState();
    store.addStyleNote("a");
    store.addStyleNote("b");
    store.clearStyleNotes();
    expect(useCopilotStore.getState().styleNotes).toEqual([]);
  });

  it("drops prototype-pollution keys at entry", () => {
    const store = useCopilotStore.getState();
    store.addStyleNote("__proto__");
    store.addStyleNote("prototype");
    store.addStyleNote("constructor");
    store.addStyleNote("keep it friendly");
    expect(useCopilotStore.getState().styleNotes).toEqual(["keep it friendly"]);
  });
});

describe("hydrateMemory (Phase P11)", () => {
  it("restores messages and style notes and sets the restore flag", () => {
    const store = useCopilotStore.getState();
    store.hydrateMemory({
      messages: [
        { id: "m1", role: "user", content: "Make it friendlier", createdAt: 1 },
        { id: "m2", role: "assistant", content: "Done.", createdAt: 2 },
      ],
      styleNotes: ["keep it friendly"],
    });
    const state = useCopilotStore.getState();
    expect(state.messages).toHaveLength(2);
    expect(state.styleNotes).toEqual(["keep it friendly"]);
    expect(state.memoryRestored).toBe(true);
    expect(state.status).toBe("idle");
  });

  it("never restores plan state from memory", () => {
    const store = useCopilotStore.getState();
    store.setPlanReady({
      plan: makePlan(),
      diffs: [],
      selectedOperationIds: ["op-1"],
      warnings: [],
    });
    // Simulate a reload restoring only the conversation.
    store.hydrateMemory({ messages: [], styleNotes: [] });
    const state = useCopilotStore.getState();
    expect(state.planState).toBeNull();
    expect(state.elementSuggestion).toBeNull();
    expect(state.error).toBeNull();
    expect(state.appliedSummary).toBeNull();
  });

  it("trims over-bound restored messages to the session cap", () => {
    const store = useCopilotStore.getState();
    const messages = Array.from({ length: 40 }, (_, i) => ({
      id: `m${i}`,
      role: "user" as const,
      content: `msg ${i}`,
      createdAt: i,
    }));
    store.hydrateMemory({ messages, styleNotes: [] });
    expect(useCopilotStore.getState().messages.length).toBeLessThanOrEqual(24);
  });

  it("does not set the restore flag for an empty restore", () => {
    useCopilotStore.getState().hydrateMemory({ messages: [], styleNotes: [] });
    expect(useCopilotStore.getState().memoryRestored).toBe(false);
  });
});

describe("clearConversation with memory (Phase P11)", () => {
  it("clears messages, style notes, and the restore flag", () => {
    const store = useCopilotStore.getState();
    store.addUserMessage("hi");
    store.addStyleNote("keep it friendly");
    store.hydrateMemory({ messages: store.messages, styleNotes: store.styleNotes });

    store.clearConversation();
    const state = useCopilotStore.getState();
    expect(state.messages).toEqual([]);
    expect(state.styleNotes).toEqual([]);
    expect(state.memoryRestored).toBe(false);
  });

  it("reset clears style notes and memory flags on project switch", () => {
    const store = useCopilotStore.getState();
    store.addStyleNote("friendly");
    store.hydrateMemory({ messages: [{ id: "m", role: "user", content: "x", createdAt: 1 }], styleNotes: store.styleNotes });
    store.reset();
    const state = useCopilotStore.getState();
    expect(state.styleNotes).toEqual([]);
    expect(state.memoryRestored).toBe(false);
    expect(state.messages).toEqual([]);
  });
});
