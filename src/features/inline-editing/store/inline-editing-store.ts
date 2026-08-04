// ---------------------------------------------------------------------------
// Inline editing — transient state store (Phase M)
//
// Holds the selected field, mode, draft value, current suggestion, and a
// capped instruction history for conversational follow-ups. Deliberately NOT
// persisted in Project, NOT included in .buildora.json or website export.
// Reset on project/page switch and section delete (see useInlineEdit).
//
// Guarantees:
//   - no project persistence
//   - stale async responses ignored via a monotonic request token
//   - serial requests (no overlapping suggest/apply)
//   - unmount-safe (store is global; components must not update after unmount)
// ---------------------------------------------------------------------------

import { create } from "zustand";
import type {
  EditableFieldDescriptor,
  InlineAiError,
  InlineAiSuggestion,
} from "../types";

export type InlineEditMode =
  | "idle"
  | "editing"
  | "suggesting"
  | "reviewing"
  | "applying"
  | "error"
  | "stale";

/** Cap on the conversational instruction history (spec §15). */
export const MAX_INSTRUCTION_HISTORY = 6;

export interface InlineEditingState {
  selectedField: EditableFieldDescriptor | null;
  mode: InlineEditMode;
  draftValue: string;
  currentSuggestion: InlineAiSuggestion | null;
  instructionHistory: string[];
  error: InlineAiError | null;
  /** Monotonic token — bumped on reset so stale async responses are ignored. */
  requestToken: number;
  /** Anchor element for positioning the toolbar/popover (transient, never serialized). */
  anchorEl: HTMLElement | null;
  /** Whether the AI follow-up prompt input is open (transient UI state). */
  aiPromptOpen: boolean;

  // ---- Actions ----
  selectField: (field: EditableFieldDescriptor | null, anchor?: HTMLElement | null) => void;
  clearField: () => void;
  beginEditing: () => void;
  setDraftValue: (value: string) => void;
  cancelEditing: () => void;
  beginSuggesting: (instruction: string) => void;
  setSuggestion: (suggestion: InlineAiSuggestion) => void;
  setApplying: () => void;
  /**
   * Reset to idle after a successful apply. When `appliedValue` is provided,
   * the selected field's currentValue is refreshed so re-editing the field
   * starts from the applied text (never a stale pre-apply value).
   */
  applyComplete: (appliedValue?: string) => void;
  rejectSuggestion: () => void;
  setError: (error: InlineAiError) => void;
  setStale: () => void;
  setAnchor: (anchor: HTMLElement | null) => void;
  setAiPromptOpen: (open: boolean) => void;
  nextRequestToken: () => number;
  reset: () => void;
}

export const useInlineEditingStore = create<InlineEditingState>()((set, get) => ({
  selectedField: null,
  mode: "idle",
  draftValue: "",
  currentSuggestion: null,
  instructionHistory: [],
  error: null,
  requestToken: 0,
  anchorEl: null,
  aiPromptOpen: false,

  // Selecting a field resets the conversational context (spec §15: cleared
  // when field changes) and keeps a live anchor for the floating UI.
  selectField: (field, anchor) =>
    set({
      selectedField: field,
      mode: "idle",
      draftValue: field?.currentValue ?? "",
      currentSuggestion: null,
      instructionHistory: [],
      error: null,
      anchorEl: anchor ?? null,
      aiPromptOpen: false,
    }),

  clearField: () =>
    set({
      selectedField: null,
      mode: "idle",
      draftValue: "",
      currentSuggestion: null,
      instructionHistory: [],
      error: null,
      anchorEl: null,
      aiPromptOpen: false,
    }),

  beginEditing: () => {
    const field = get().selectedField;
    if (!field) return;
    set({ mode: "editing", draftValue: field.currentValue, error: null });
  },

  setDraftValue: (value) => set({ draftValue: value }),

  cancelEditing: () => {
    const field = get().selectedField;
    set({ mode: "idle", draftValue: field?.currentValue ?? "" });
  },

  beginSuggesting: (instruction) => {
    // Push to a capped history for follow-up context.
    const history = get().instructionHistory;
    const nextHistory =
      history[history.length - 1] === instruction
        ? history
        : [...history, instruction].slice(-MAX_INSTRUCTION_HISTORY);
    set({
      mode: "suggesting",
      currentSuggestion: null,
      error: null,
      instructionHistory: nextHistory,
    });
  },

  setSuggestion: (suggestion) =>
    set({ mode: "reviewing", currentSuggestion: suggestion, error: null }),

  setApplying: () => set({ mode: "applying", error: null }),

  applyComplete: (appliedValue) => {
    const field = get().selectedField;
    // Field stays selected; suggestion + errors cleared. When the applied
    // value is known, refresh the descriptor so a subsequent edit session
    // never starts from a stale pre-apply value.
    const nextField: EditableFieldDescriptor | null =
      field === null
        ? null
        : appliedValue
          ? { ...field, currentValue: appliedValue }
          : field;
    set({
      mode: "idle",
      currentSuggestion: null,
      error: null,
      draftValue: nextField?.currentValue ?? "",
      selectedField: nextField,
    });
  },

  rejectSuggestion: () =>
    set({ mode: "idle", currentSuggestion: null, error: null }),

  setError: (error) => set({ mode: "error", error }),

  setStale: () => set({ mode: "stale" }),

  setAnchor: (anchor) => set({ anchorEl: anchor }),

  setAiPromptOpen: (open) => set({ aiPromptOpen: open }),

  nextRequestToken: () => {
    const next = get().requestToken + 1;
    set({ requestToken: next });
    return next;
  },

  reset: () =>
    set((state) => ({
      selectedField: null,
      mode: "idle",
      draftValue: "",
      currentSuggestion: null,
      instructionHistory: [],
      error: null,
      anchorEl: null,
      aiPromptOpen: false,
      // Bump so an in-flight response that resolves after reset is ignored.
      requestToken: state.requestToken + 1,
    })),
}));
