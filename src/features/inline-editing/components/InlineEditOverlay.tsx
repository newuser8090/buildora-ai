"use client";

import { useEffect, useRef } from "react";
import { Check, X, Loader2 } from "lucide-react";
import { useInlineEdit } from "../hooks/useInlineEdit";

// ---------------------------------------------------------------------------
// InlineEditOverlay — the manual inline edit input shown when the user double
// clicks (or presses Enter on) an editable field.
//
//   - single-line fields: Enter saves, Escape cancels
//   - textarea fields: Ctrl/Cmd+Enter saves, Escape cancels
//   - unchanged value → no history entry (updateEditableFieldValue no-op)
//   - focus restored to the field anchor after close
// ---------------------------------------------------------------------------

export function InlineEditOverlay() {
  const {
    selectedField,
    draftValue,
    setDraftValue,
    saveDraft,
    cancelEditing,
    isBusy,
    error,
    anchorEl,
  } = useInlineEdit();

  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);

  const isTextarea =
    selectedField?.kind === "textarea" || selectedField?.kind === "description";

  // Mount-time focus + capture the previously focused element for restoration.
  // (The overlay only renders while mode === "editing", so this runs once per
  // open.)
  useEffect(() => {
    const prev = document.activeElement;
    if (prev && prev !== inputRef.current) {
      lastFocusedRef.current = prev as HTMLElement;
    }
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleKeyDown = async (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cancelEditing();
      restoreFocus();
      return;
    }
    const saveKeys =
      e.key === "Enter" &&
      (isTextarea ? e.ctrlKey || e.metaKey : !e.shiftKey);
    if (!saveKeys) return;
    e.preventDefault();
    e.stopPropagation();
    await saveDraft();
    restoreFocus();
  };

  const handleBlur = () => {
    // Blur policy: canceling on blur is risky (clicking "Save" blurs first).
    // We keep the value; the user can Escape or save explicitly.
    if (inputRef.current && document.activeElement !== inputRef.current) {
      // If focus moved to another part of the UI, keep editing state — the
      // toolbar/popover buttons stopPropagation and handle their own flow.
    }
  };

  const restoreFocus = () => {
    const target = anchorEl ?? lastFocusedRef.current;
    if (target && typeof target.focus === "function") {
      target.focus();
    }
  };

  const maxLength = selectedField?.maxLength;

  return (
    <div
      role="dialog"
      aria-label={`Edit ${selectedField?.label ?? "field"}`}
      data-testid="inline-edit-overlay"
      className="pointer-events-auto fixed z-50 w-[min(420px,calc(100vw-2rem))] rounded-xl border border-border bg-card p-3 shadow-xl"
      style={{
        left: "50%",
        transform: "translateX(-50%)",
        bottom: "1.5rem",
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-xs font-medium text-text-primary">
          {selectedField?.label}
          <span className="ml-1.5 text-text-dim">
            {selectedField?.sectionType}
          </span>
        </span>
        {maxLength !== undefined && (
          <span className="shrink-0 text-[10px] text-text-dim">
            {draftValue.length}/{maxLength}
          </span>
        )}
      </div>

      <textarea
        ref={inputRef}
        value={draftValue}
        onChange={(e) => setDraftValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        rows={isTextarea ? 4 : 2}
        maxLength={maxLength}
        data-testid="inline-edit-input"
        aria-label={`Edit ${selectedField?.label ?? "field"} text`}
        className="w-full resize-none rounded-lg border border-border bg-base px-3 py-2 text-sm text-text-primary placeholder:text-text-dim transition-all duration-200 focus:border-accent/40 focus:outline-none focus:ring-2 focus:ring-accent/10"
        style={{ maxHeight: "160px" }}
      />

      {error && (
        <p
          data-testid="inline-edit-error"
          role="alert"
          className="mt-2 text-xs text-red-400"
        >
          {error.message}
        </p>
      )}

      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-[10px] text-text-dim/70">
          {isTextarea ? "Ctrl/⌘ + Enter to save" : "Enter to save"} · Escape to
          cancel
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              cancelEditing();
              restoreFocus();
            }}
            data-testid="inline-edit-cancel"
            className="flex h-7 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium text-text-dim transition-all duration-200 hover:bg-base hover:text-text-primary active:scale-95"
          >
            <X className="h-3.5 w-3.5" />
            Cancel
          </button>
          <button
            type="button"
            onClick={async () => {
              await saveDraft();
              restoreFocus();
            }}
            disabled={isBusy}
            data-testid="inline-edit-save"
            className="flex h-7 items-center gap-1.5 rounded-lg bg-accent px-2.5 text-xs font-medium text-white transition-all duration-200 hover:bg-accent-hover active:scale-95 disabled:opacity-40"
          >
            {isBusy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
