// ---------------------------------------------------------------------------
// AI editing — transient plan state store
//
// Holds the current plan, selection, warnings, errors, and a request token.
// Deliberately NOT persisted in Project, NOT included in .buildora.json or
// website export. Cleared on project switch/delete (see useAiPlanEdit).
// ---------------------------------------------------------------------------

import { create } from "zustand";
import type {
  AiEditDiff,
  AiEditPlan,
  AiEditPlanError,
  AiEditScope,
} from "../plan-types";

export type AiPlanStatus =
  | "idle"
  | "planning"
  | "ready"
  | "applying"
  | "applied"
  | "error"
  | "stale";

export interface AiPlanLastRequest {
  instruction: string;
  scope: AiEditScope;
  selectedPageId?: string;
  selectedSectionId?: string;
}

export interface AiPlanState {
  status: AiPlanStatus;
  plan: AiEditPlan | null;
  /**
   * Ids the user has checked. Always an array once a plan is ready — the
   * default is every operation except high-risk ones. Passing `null` to
   * applyPlan means "Apply All".
   */
  selectedOperationIds: string[];
  diffs: AiEditDiff[];
  warnings: string[];
  error: AiEditPlanError | null;
  lastRequest: AiPlanLastRequest | null;
  /** Monotonic token — bumped on reset so stale async responses are ignored. */
  requestSeq: number;

  // ---- Actions ----
  beginPlanning: () => void;
  setReady: (args: {
    plan: AiEditPlan;
    selectedOperationIds: string[];
    diffs: AiEditDiff[];
    warnings: string[];
    lastRequest: AiPlanLastRequest;
  }) => void;
  setApplying: () => void;
  setApplied: () => void;
  setError: (error: AiEditPlanError) => void;
  setStale: () => void;
  setSelectedOperationIds: (ids: string[]) => void;
  /** Increment the request token and return the new value. */
  nextRequestSeq: () => number;
  reset: () => void;
}

export const useAiPlanStore = create<AiPlanState>()((set, get) => ({
  status: "idle",
  plan: null,
  selectedOperationIds: [],
  diffs: [],
  warnings: [],
  error: null,
  lastRequest: null,
  requestSeq: 0,

  beginPlanning: () =>
    set({ status: "planning", error: null, diffs: [], warnings: [] }),

  setReady: ({ plan, selectedOperationIds, diffs, warnings, lastRequest }) =>
    set({
      status: "ready",
      plan,
      selectedOperationIds,
      diffs,
      warnings,
      error: null,
      lastRequest,
    }),

  setApplying: () => set({ status: "applying", error: null }),

  setApplied: () => set({ status: "applied", error: null }),

  setError: (error) => set({ status: "error", error }),

  setStale: () => set({ status: "stale", error: null }),

  setSelectedOperationIds: (ids) => set({ selectedOperationIds: ids }),

  nextRequestSeq: () => {
    const next = get().requestSeq + 1;
    set({ requestSeq: next });
    return next;
  },

  reset: () =>
    set((state) => ({
      status: "idle",
      plan: null,
      selectedOperationIds: [],
      diffs: [],
      warnings: [],
      error: null,
      lastRequest: null,
      // Bump so an in-flight response that resolves after reset is ignored.
      requestSeq: state.requestSeq + 1,
    })),
}));
