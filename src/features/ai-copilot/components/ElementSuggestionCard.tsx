"use client";

import { Check, Loader2, Type, X } from "lucide-react";
import type { EditableFieldDescriptor } from "@/features/inline-editing/types";
import type { InlineAiSuggestion } from "@/features/inline-editing/types";

interface ElementSuggestionCardProps {
  suggestion: InlineAiSuggestion;
  field: EditableFieldDescriptor;
  applying: boolean;
  onApply: () => void;
  onReject: () => void;
}

export function ElementSuggestionCard({
  suggestion,
  field,
  applying,
  onApply,
  onReject,
}: ElementSuggestionCardProps) {
  return (
    <div
      data-testid="copilot-element-suggestion"
      className="mb-3 rounded-2xl border border-accent/25 bg-accent/[0.04] p-3.5"
    >
      <div className="flex items-center gap-2">
        <Type className="h-4 w-4 shrink-0 text-accent" />
        <h3 className="flex-1 text-sm font-semibold text-text-primary">Rewrite “{field.label}”</h3>
        <span className="rounded bg-base px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-text-dim">
          {suggestion.provider === "rule-based" ? "local engine" : "AI"}
        </span>
      </div>

      <div className="mt-2.5 rounded-xl border border-border bg-base px-3 py-2">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-text-dim/70">
          Suggested text
        </div>
        <p className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-text-primary">
          “{suggestion.suggestedValue}”
        </p>
        {suggestion.explanation && (
          <p className="mt-1.5 border-t border-border/60 pt-1.5 text-[11px] leading-relaxed text-text-dim">
            {suggestion.explanation}
          </p>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          data-testid="copilot-apply-suggestion"
          onClick={onApply}
          disabled={applying}
          className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent text-[13px] font-medium text-white transition-all duration-200 hover:bg-accent-hover active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {applying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          {applying ? "Applying..." : "Apply text"}
        </button>
        <button
          type="button"
          data-testid="copilot-dismiss-suggestion"
          onClick={onReject}
          disabled={applying}
          className="flex h-9 items-center gap-1 rounded-lg border border-border px-3 text-xs font-medium text-text-muted transition-colors hover:bg-card hover:text-text-primary disabled:opacity-40"
        >
          <X className="h-3.5 w-3.5" />
          Dismiss
        </button>
      </div>
      <p className="mt-2 text-[10px] text-text-dim/70">
        Applying this changes only the selected text and can be undone with one step.
      </p>
    </div>
  );
}
