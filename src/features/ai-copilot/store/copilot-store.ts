// ---------------------------------------------------------------------------
// AI Copilot — transient UI store (Phase P10)
//
// Owns panel open/close, status, scope choice, the bounded session
// conversation, the plan-preview state awaiting approval, errors, and the
// last-request snapshot for Retry/Regenerate.
//
// Deliberately NOT persisted: never in Project, never in IndexedDB, never in
// .buildora.json or website export. Cleared on project switch (useCopilot).
//
// This store is SEPARATE from ai-editing's useAiPlanStore: the pre-existing
// LeftSidebar AI Assistant keeps its own transient plan state, and the
// Copilot keeps its own, so two surfaces never write each other's UI. Both
// share the same services and the same editor-store application path.
// ---------------------------------------------------------------------------

import { create } from "zustand";
import type { EditableFieldDescriptor } from "@/features/inline-editing/types";
import type { InlineAiSuggestion } from "@/features/inline-editing/types";
import { markPerf } from "@/features/perf/perf-instrumentation";
import { COPILOT_LIMITS, COPILOT_PERF } from "../constants";
import type {
  CopilotAppliedSummary,
  CopilotError,
  CopilotMessage,
  CopilotPlanState,
  CopilotScope,
  CopilotScopeChoice,
  CopilotStatus,
} from "../types";

export interface CopilotStoreState {
  open: boolean;
  status: CopilotStatus;
  scopeChoice: CopilotScopeChoice;
  messages: CopilotMessage[];
  planState: CopilotPlanState | null;
  /** Single-field suggestion awaiting approval (element quick actions). */
  elementSuggestion: { suggestion: InlineAiSuggestion; field: EditableFieldDescriptor } | null;
  error: CopilotError | null;
  appliedSummary: CopilotAppliedSummary | null;
  lastRequest: { instruction: string; scope: CopilotScope } | null;
  /** Monotonic token — bumped on reset/clear so stale async results are ignored. */
  requestSeq: number;

  // ---- Actions ----
  openPanel: () => void;
  closePanel: () => void;
  togglePanel: () => void;
  setStatus: (status: CopilotStatus) => void;
  setComposing: (composing: boolean) => void;
  setScopeChoice: (choice: CopilotScopeChoice) => void;
  setLastRequest: (request: { instruction: string; scope: CopilotScope }) => void;

  addUserMessage: (content: string) => void;
  addAssistantMessage: (
    content: string,
    options?: {
      kind?: CopilotMessage["kind"];
      metadata?: CopilotMessage["metadata"];
      status?: CopilotMessage["status"];
    },
  ) => void;

  setPlanReady: (state: CopilotPlanState) => void;
  setSelectedOperationIds: (ids: string[]) => void;
  setElementSuggestion: (
    suggestion: InlineAiSuggestion,
    field: EditableFieldDescriptor,
  ) => void;
  clearElementSuggestion: () => void;
  setApplying: () => void;
  setApplied: (summary: CopilotAppliedSummary) => void;
  setError: (error: CopilotError) => void;
  setCompleted: () => void;
  clearPlan: () => void;

  /** New conversation: wipes messages, plan, error; stays open; bumps token. */
  clearConversation: () => void;
  nextRequestSeq: () => number;
  reset: () => void;
}

let messageCounter = 0;

function nextMessageId(): string {
  messageCounter += 1;
  return `copilot-msg-${Date.now().toString(36)}-${messageCounter}`;
}

/** Trim the oldest full user/assistant pair when over the bound. */
function trimMessages(messages: CopilotMessage[]): CopilotMessage[] {
  while (messages.length > COPILOT_LIMITS.maxMessages) {
    // Drop the oldest message and, if it was a user message, its immediate
    // following assistant message as well (keeps pairs intact).
    const [first] = messages;
    const dropCount = first?.role === "user" ? 2 : 1;
    messages = messages.slice(Math.min(dropCount, messages.length));
  }
  return messages;
}

export const useCopilotStore = create<CopilotStoreState>()((set, get) => ({
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

  openPanel: () => set({ open: true }),
  closePanel: () => set({ open: false }),
  togglePanel: () => set((state) => ({ open: !state.open })),

  setStatus: (status) => set({ status }),

  setComposing: (composing) =>
    set((state) => {
      if (composing && state.status === "idle") return { status: "composing" as CopilotStatus };
      if (!composing && state.status === "composing") return { status: "idle" as CopilotStatus };
      return {};
    }),

  setScopeChoice: (choice) => set({ scopeChoice: choice }),
  setLastRequest: (request) => set({ lastRequest: request }),

  addUserMessage: (content) =>
    set((state) => ({
      messages: trimMessages([
        ...state.messages,
        {
          id: nextMessageId(),
          role: "user",
          content,
          createdAt: Date.now(),
          status: "complete",
        },
      ]),
    })),

  addAssistantMessage: (content, options) =>
    set((state) => ({
      messages: trimMessages([
        ...state.messages,
        {
          id: nextMessageId(),
          role: "assistant",
          content,
          createdAt: Date.now(),
          status: options?.status ?? "complete",
          kind: options?.kind,
          metadata: options?.metadata,
        },
      ]),
    })),

  setPlanReady: (planState) =>
    set({ planState, elementSuggestion: null, status: "awaiting-approval", error: null }),

  setSelectedOperationIds: (ids) =>
    set((state) =>
      state.planState
        ? { planState: { ...state.planState, selectedOperationIds: ids } }
        : {},
    ),

  // Starting a NEW single-field suggestion replaces any pending plan — two
  // approval surfaces must never render at once.
  setElementSuggestion: (suggestion, field) =>
    set({
      elementSuggestion: { suggestion, field },
      planState: null,
      status: "awaiting-approval",
      error: null,
    }),

  clearElementSuggestion: () => set({ elementSuggestion: null }),

  setApplying: () => set({ status: "applying", error: null }),

  setApplied: (summary) =>
    set({
      status: "completed",
      appliedSummary: summary,
      planState: null,
      elementSuggestion: null,
      error: null,
    }),

  setError: (error) => set({ status: "failed", error }),

  setCompleted: () => set({ status: "completed" }),

  clearPlan: () => set({ planState: null, elementSuggestion: null, error: null }),

  clearConversation: () =>
    set((state) => ({
      messages: [],
      planState: null,
      elementSuggestion: null,
      error: null,
      appliedSummary: null,
      lastRequest: null,
      status: "idle",
      requestSeq: state.requestSeq + 1,
    })),

  nextRequestSeq: () => {
    const next = get().requestSeq + 1;
    set({ requestSeq: next });
    return next;
  },

  reset: () =>
    set((state) => ({
      open: false,
      status: "idle",
      scopeChoice: "auto",
      messages: [],
      planState: null,
      elementSuggestion: null,
      error: null,
      appliedSummary: null,
      lastRequest: null,
      requestSeq: state.requestSeq + 1,
    })),
}));

// ---------------------------------------------------------------------------
// Shared open helper — used by TopNav, CommandPalette, and the keyboard hook
// so every entry point records the same perf mark.
// ---------------------------------------------------------------------------

export function openCopilotPanel(): void {
  useCopilotStore.getState().openPanel();
  markPerf(COPILOT_PERF.open);
}

/** Plan fields as a plain type usable by pure helpers. */
export interface PlanSummarySnapshot {
  id: string;
  pageId?: string;
  sectionId?: string;
  scopeType: "project" | "page" | "section";
}
