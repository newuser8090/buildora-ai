// ---------------------------------------------------------------------------
// Action Feedback (Phase P9) — transient toast store
//
// Lightweight, non-spamming feedback for discrete structural actions
// (undo / redo). Only meaningful labels are produced — there is no toast per
// keystroke. The toast is transient and never persisted.
// ---------------------------------------------------------------------------

import { create } from "zustand";

export interface ActionFeedbackState {
  message: string | null;
  /** Optional action offered on the toast, e.g. "Undo". */
  actionLabel?: string | null;
  onAction?: (() => void) | null;
  notify: (message: string, actionLabel?: string | null, onAction?: (() => void) | null) => void;
  clear: () => void;
}

export const useActionFeedbackStore = create<ActionFeedbackState>((set) => ({
  message: null,
  actionLabel: null,
  onAction: null,
  notify: (message, actionLabel = null, onAction = null) =>
    set({ message, actionLabel, onAction }),
  clear: () => set({ message: null, actionLabel: null, onAction: null }),
}));

let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

/** Show a toast for a fixed duration, then clear it. */
export function notifyActionFeedback(
  message: string,
  options?: { actionLabel?: string; onAction?: () => void; durationMs?: number },
): void {
  if (timeoutHandle) clearTimeout(timeoutHandle);
  useActionFeedbackStore
    .getState()
    .notify(message, options?.actionLabel ?? null, options?.onAction ?? null);
  timeoutHandle = setTimeout(() => {
    useActionFeedbackStore.getState().clear();
    timeoutHandle = null;
  }, options?.durationMs ?? 2600);
}
