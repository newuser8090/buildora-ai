"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  Check,
  X,
  RefreshCw,
  Copy,
  PencilLine,
  AlertTriangle,
  Sparkles,
  Loader2,
} from "lucide-react";
import { useInlineEdit } from "../hooks/useInlineEdit";

// ---------------------------------------------------------------------------
// InlineAiSuggestionPopover — preview + review of a single-field AI
// suggestion (spec §13). Never applies automatically; accept runs the stale
// policy then applies ONE validated field update.
//
//   - Accept / Reject / Regenerate / Edit suggestion / Copy suggestion
//   - repeated clicks blocked while applying
//   - Escape closes when idle (never while applying)
//   - basic focus trap + focus restoration on close
//   - provider badge; rule-based fallback indicated, never color-only
// ---------------------------------------------------------------------------

export function InlineAiSuggestionPopover() {
  const {
    selectedField,
    currentSuggestion,
    acceptSuggestion,
    rejectSuggestion,
    regenerate,
    isBusy,
    mode,
    anchorEl,
  } = useInlineEdit();

  const popoverRef = useRef<HTMLDivElement | null>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);
  const [editingSuggestion, setEditingSuggestion] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [copied, setCopied] = useState(false);
  const [ready, setReady] = useState(false);

  const suggestion = currentSuggestion;

  // Remember who had focus before we opened, for restoration on close.
  useEffect(() => {
    const prev = document.activeElement;
    if (prev && prev !== popoverRef.current) {
      lastFocusedRef.current = prev as HTMLElement;
    }
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => setReady(true), 30);
    return () => window.clearTimeout(t);
  }, []);

  // Focus trap — Tab cycles within the popover.
  useEffect(() => {
    if (mode !== "reviewing") return;
    const el = popoverRef.current;
    if (!el) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const focusables = el.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input, [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    el.addEventListener("keydown", handleKey);
    return () => el.removeEventListener("keydown", handleKey);
  }, [mode]);

  const closeAndRestore = useCallback(() => {
    rejectSuggestion();
    const target = anchorEl ?? lastFocusedRef.current;
    if (target && typeof target.focus === "function") {
      target.focus();
    }
  }, [rejectSuggestion, anchorEl]);

  // Escape closes when idle (not while applying/suggesting).
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && mode === "reviewing" && !isBusy) {
        e.preventDefault();
        e.stopPropagation();
        closeAndRestore();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [mode, isBusy, closeAndRestore]);

  const handleAccept = useCallback(async () => {
    await acceptSuggestion();
  }, [acceptSuggestion]);

  const handleCopy = useCallback(async () => {
    if (!suggestion) return;
    try {
      await navigator.clipboard.writeText(suggestion.suggestedValue);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable — no-op with feedback via title.
    }
  }, [suggestion]);

  if (!suggestion || !selectedField) return null;

  const isStale = mode === "stale";
  const provider = suggestion.provider;
  const hasExplanation = Boolean(suggestion.explanation?.trim());

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-label="AI suggestion"
      data-testid="inline-ai-popover"
      className="pointer-events-auto fixed z-50 w-[min(420px,calc(100vw-2rem))] rounded-xl border border-border bg-card shadow-xl transition-opacity duration-200"
      style={{
        opacity: ready ? 1 : 0,
        left: "50%",
        transform: "translateX(-50%)",
        bottom: "1.25rem",
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-border px-3.5 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-accent/10">
            <Sparkles className="h-3 w-3 text-accent" />
          </span>
          <span className="truncate text-xs font-semibold text-text-primary">
            Suggestion for {selectedField.label}
          </span>
          <span
            data-testid="inline-ai-provider-badge"
            className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${
              provider === "rule-based"
                ? "border border-amber-400/40 bg-amber-400/10 text-amber-300"
                : "bg-accent/10 text-accent"
            }`}
          >
            {provider === "rule-based" ? "Local fallback" : "Gemini"}
          </span>
        </div>
        <button
          type="button"
          onClick={closeAndRestore}
          disabled={isBusy}
          aria-label="Close suggestion"
          data-testid="inline-ai-close"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-dim transition-colors hover:bg-base hover:text-text-primary disabled:opacity-40"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Body */}
      <div className="space-y-2.5 px-3.5 py-3">
        {isStale ? (
          <div
            data-testid="inline-ai-stale"
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2.5 text-xs text-amber-200"
          >
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              This text changed since the suggestion was created, so it can&apos;t
              be applied. Regenerate the suggestion or discard it.
            </span>
          </div>
        ) : (
          <>
            {/* Original */}
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-text-dim">
                Original
              </p>
              <p
                data-testid="inline-ai-original"
                className="rounded-lg bg-base px-3 py-2 text-xs leading-relaxed text-text-muted line-through decoration-text-dim/40"
              >
                {suggestion.originalValue}
              </p>
            </div>

            {/* Suggested */}
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-accent">
                Suggested
              </p>
              {editingSuggestion ? (
                <textarea
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.preventDefault();
                      setEditingSuggestion(false);
                    }
                  }}
                  maxLength={selectedField.maxLength}
                  autoFocus
                  data-testid="inline-ai-edit-suggestion"
                  aria-label="Edit suggested text"
                  className="w-full resize-none rounded-lg border border-accent/40 bg-base px-3 py-2 text-xs leading-relaxed text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/10"
                  style={{ maxHeight: "140px" }}
                />
              ) : (
                <p
                  data-testid="inline-ai-suggested"
                  className="rounded-lg border border-accent/20 bg-accent/[0.04] px-3 py-2 text-sm leading-relaxed text-text-primary"
                >
                  {suggestion.suggestedValue}
                </p>
              )}
            </div>

            {/* Explanation */}
            {hasExplanation && !editingSuggestion && (
              <p
                data-testid="inline-ai-explanation"
                className="text-[11px] leading-relaxed text-text-dim"
              >
                {suggestion.explanation}
              </p>
            )}
          </>
        )}
      </div>

      {/* Actions */}
      {!isStale && (
        <div className="flex items-center justify-between gap-2 border-t border-border px-3.5 py-2.5">
          <div className="flex items-center gap-1">
            {editingSuggestion ? (
              <>
                <button
                  type="button"
                  onClick={() => setEditingSuggestion(false)}
                  data-testid="inline-ai-edit-cancel"
                  className="flex h-7 items-center gap-1 rounded-lg border border-border px-2 text-[11px] font-medium text-text-dim transition-colors hover:bg-base"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    // Accept the manually edited value — same one-field update.
                    if (editValue.trim() && editValue !== suggestion.originalValue) {
                      // Directly apply via the store through accept flow.
                      const { applyEditedSuggestion } = await import(
                        "./apply-edited-suggestion"
                      );
                      await applyEditedSuggestion(editValue);
                      setEditingSuggestion(false);
                    } else {
                      setEditingSuggestion(false);
                    }
                  }}
                  data-testid="inline-ai-edit-save"
                  className="flex h-7 items-center gap-1 rounded-lg bg-accent px-2 text-[11px] font-medium text-white transition-colors hover:bg-accent-hover"
                >
                  <Check className="h-3.5 w-3.5" />
                  Save
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setEditValue(suggestion.suggestedValue);
                    setEditingSuggestion(true);
                  }}
                  disabled={isBusy}
                  data-testid="inline-ai-edit"
                  title="Edit suggestion manually"
                  aria-label="Edit suggestion manually"
                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-border text-text-dim transition-colors hover:bg-base hover:text-text-primary disabled:opacity-40"
                >
                  <PencilLine className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={handleCopy}
                  disabled={isBusy}
                  data-testid="inline-ai-copy"
                  title="Copy suggestion"
                  aria-label="Copy suggestion"
                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-border text-text-dim transition-colors hover:bg-base hover:text-text-primary disabled:opacity-40"
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5 text-accent" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </button>
              </>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={closeAndRestore}
              disabled={isBusy}
              data-testid="inline-ai-reject"
              className="flex h-7 items-center gap-1 rounded-lg border border-border px-2.5 text-[11px] font-medium text-text-dim transition-colors hover:bg-base hover:text-text-primary disabled:opacity-40"
            >
              <X className="h-3.5 w-3.5" />
              Reject
            </button>
            <button
              type="button"
              onClick={() => void regenerate()}
              disabled={isBusy}
              data-testid="inline-ai-regenerate"
              className="flex h-7 items-center gap-1 rounded-lg border border-border px-2.5 text-[11px] font-medium text-text-muted transition-colors hover:bg-base hover:text-text-primary disabled:opacity-40"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Regenerate
            </button>
            <button
              type="button"
              onClick={handleAccept}
              disabled={isBusy}
              data-testid="inline-ai-accept"
              className="flex h-7 items-center gap-1 rounded-lg bg-accent px-2.5 text-[11px] font-medium text-white transition-all duration-200 hover:bg-accent-hover active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
              {isBusy ? "Applying…" : "Accept"}
            </button>
          </div>
        </div>
      )}

      {/* Stale-state actions */}
      {isStale && (
        <div className="flex items-center justify-end gap-1.5 border-t border-border px-3.5 py-2.5">
          <button
            type="button"
            onClick={closeAndRestore}
            data-testid="inline-ai-stale-discard"
            className="flex h-7 items-center gap-1 rounded-lg border border-border px-2.5 text-[11px] font-medium text-text-dim transition-colors hover:bg-base"
          >
            Discard
          </button>
          <button
            type="button"
            onClick={() => void regenerate()}
            disabled={isBusy}
            data-testid="inline-ai-stale-regenerate"
            className="flex h-7 items-center gap-1 rounded-lg bg-accent px-2.5 text-[11px] font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Regenerate
          </button>
        </div>
      )}
    </div>
  );
}
