// ---------------------------------------------------------------------------
// AI Copilot — transient store tests (spec §2, §5)
//   - panel open/close/toggle (closed ↔ idle states)
//   - status transitions (composing, planning, awaiting-approval, applying,
//     completed, failed)
//   - bounded conversation + clear conversation
//   - plan state / applied summary / error / last-request snapshots
//   - request sequencing (stale async results ignored after reset)
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { useCopilotStore, openCopilotPanel } from "../store/copilot-store";
import { COPILOT_LIMITS } from "../constants";
import { makePlan } from "./helpers";

function hydrate() {
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
  });
}

beforeEach(() => {
  hydrate();
});

describe("panel lifecycle", () => {
  it("opens and closes", () => {
    useCopilotStore.getState().openPanel();
    expect(useCopilotStore.getState().open).toBe(true);
    useCopilotStore.getState().closePanel();
    expect(useCopilotStore.getState().open).toBe(false);
  });

  it("toggles", () => {
    expect(useCopilotStore.getState().open).toBe(false);
    useCopilotStore.getState().togglePanel();
    expect(useCopilotStore.getState().open).toBe(true);
    useCopilotStore.getState().togglePanel();
    expect(useCopilotStore.getState().open).toBe(false);
  });

  it("openCopilotPanel opens the panel (shared entry point)", () => {
    openCopilotPanel();
    expect(useCopilotStore.getState().open).toBe(true);
  });
});

describe("status transitions", () => {
  it("composing toggles only between idle and composing", () => {
    const store = useCopilotStore.getState();
    store.setComposing(true);
    expect(useCopilotStore.getState().status).toBe("composing");
    store.setComposing(false);
    expect(useCopilotStore.getState().status).toBe("idle");
  });

  it("a ready plan moves to awaiting-approval and clears errors", () => {
    const store = useCopilotStore.getState();
    store.setError({ code: "COPILOT_PROVIDER_FAILED", message: "x", retryable: true });
    store.setPlanReady({
      plan: makePlan(),
      diffs: [],
      selectedOperationIds: ["op-1"],
      warnings: [],
    });
    const state = useCopilotStore.getState();
    expect(state.status).toBe("awaiting-approval");
    expect(state.planState?.plan.id).toBe("plan-1");
    expect(state.error).toBeNull();
  });

  it("applying then applied produces a completed status and change summary", () => {
    const store = useCopilotStore.getState();
    store.setPlanReady({ plan: makePlan(), diffs: [], selectedOperationIds: ["op-1"], warnings: [] });
    store.setApplying();
    expect(useCopilotStore.getState().status).toBe("applying");
    store.setApplied({ opLabels: ["Hide FAQ"], applied: 1, skipped: 0 });
    const state = useCopilotStore.getState();
    expect(state.status).toBe("completed");
    expect(state.appliedSummary?.opLabels).toEqual(["Hide FAQ"]);
    // Plan preview is cleared after a successful apply.
    expect(state.planState).toBeNull();
  });

  it("a failure keeps the panel usable with a retryable error", () => {
    useCopilotStore.getState().setError({
      code: "COPILOT_PLAN_STALE",
      message: "Try again.",
      retryable: true,
    });
    const state = useCopilotStore.getState();
    expect(state.status).toBe("failed");
    expect(state.error?.retryable).toBe(true);
  });
});

describe("conversation bounding", () => {
  it("trims the oldest user/assistant pairs when over the bound", () => {
    const store = useCopilotStore.getState();
    for (let i = 0; i < COPILOT_LIMITS.maxMessages + 4; i += 1) {
      store.addUserMessage(`u${i}`);
      store.addAssistantMessage(`a${i}`);
    }
    const messages = useCopilotStore.getState().messages;
    expect(messages.length).toBeLessThanOrEqual(COPILOT_LIMITS.maxMessages);
    // Oldest message is gone.
    expect(messages.some((m) => m.content === "u0")).toBe(false);
  });

  it("clearConversation resets messages, plan, error and bumps the sequence", () => {
    useCopilotStore.getState().openPanel();
    const store = useCopilotStore.getState();
    store.addUserMessage("hi");
    store.setPlanReady({ plan: makePlan(), diffs: [], selectedOperationIds: ["op-1"], warnings: [] });
    const seqBefore = useCopilotStore.getState().requestSeq;

    store.clearConversation();
    const state = useCopilotStore.getState();
    expect(state.messages).toEqual([]);
    expect(state.planState).toBeNull();
    expect(state.error).toBeNull();
    expect(state.status).toBe("idle");
    expect(state.requestSeq).toBe(seqBefore + 1);
    // Panel stays open — clearing is not closing.
    expect(state.open).toBe(true);
  });
});

describe("scope + last request", () => {
  it("stores the scope choice and last request for Retry/Regenerate", () => {
    const store = useCopilotStore.getState();
    store.setScopeChoice({ type: "section", pageId: "page-1", sectionId: "s-hero" });
    store.setLastRequest({ instruction: "shorter", scope: { type: "section", pageId: "page-1", sectionId: "s-hero" } });
    const state = useCopilotStore.getState();
    expect(state.scopeChoice).not.toBe("auto");
    if (state.scopeChoice !== "auto") {
      expect(state.scopeChoice.type).toBe("section");
    }
    expect(state.lastRequest?.instruction).toBe("shorter");
  });
});

describe("request sequencing", () => {
  it("nextRequestSeq is monotonic and reset bumps it again", () => {
    const seq = useCopilotStore.getState().nextRequestSeq();
    expect(seq).toBe(1);
    useCopilotStore.getState().reset();
    expect(useCopilotStore.getState().requestSeq).toBe(2);
  });
});

describe("message metadata", () => {
  it("records plan metadata on assistant messages for follow-up resolution", () => {
    const store = useCopilotStore.getState();
    store.addAssistantMessage("Plan ready", {
      kind: "edit-plan",
      metadata: { scope: { type: "section", pageId: "page-1", sectionId: "s-hero" }, opLabels: ["Hero"] },
    });
    const msg = useCopilotStore.getState().messages[0];
    expect(msg.kind).toBe("edit-plan");
    expect(msg.metadata?.scope).toEqual({ type: "section", pageId: "page-1", sectionId: "s-hero" });
  });
});
