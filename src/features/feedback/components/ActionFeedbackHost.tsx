// ---------------------------------------------------------------------------
// Action Feedback (Phase P9) — host
//
// Renders the transient undo/redo toast. Mounted once in the editor shell.
// Offers a real action (e.g. "Undo") that reverses the change.
// ---------------------------------------------------------------------------

"use client";

import { useActionFeedbackStore } from "../action-feedback";

export function ActionFeedbackHost() {
  const message = useActionFeedbackStore((s) => s.message);
  const actionLabel = useActionFeedbackStore((s) => s.actionLabel);
  const onAction = useActionFeedbackStore((s) => s.onAction);
  const clear = useActionFeedbackStore((s) => s.clear);

  if (!message) return null;

  return (
    <div
      role="status"
      data-testid="action-feedback-toast"
      className="fixed bottom-16 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-3 rounded-lg border border-border bg-card px-4 py-2.5 shadow-elevated"
    >
      <span className="text-xs font-medium text-text-primary">{message}</span>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={() => {
            onAction();
            clear();
          }}
          className="text-xs font-semibold text-accent transition-colors hover:text-accent-hover"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
