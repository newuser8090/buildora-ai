"use client";

import { useEffect, useRef, useState } from "react";
import { Send, Loader2 } from "lucide-react";
import { useInlineEdit } from "../hooks/useInlineEdit";

// ---------------------------------------------------------------------------
// InlineAiPromptInput — free-form instruction input for AI follow-ups on the
// selected field (spec §15 conversational follow-ups). Quick chips are shown
// while idle; Enter submits. Dismissed via Escape.
// ---------------------------------------------------------------------------

const QUICK_PROMPTS = ["Shorter", "More premium", "Friendlier"];

export function InlineAiPromptInput({
  onDismiss,
}: {
  onDismiss: () => void;
}) {
  const { selectedField, suggest, regenerate, isBusy } = useInlineEdit();
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isBusy) return;
    setValue("");
    void suggest(trimmed);
  };

  if (!selectedField) return null;

  return (
    <div
      data-testid="inline-ai-prompt"
      className="pointer-events-auto w-[min(380px,calc(100vw-2rem))] rounded-xl border border-border bg-card p-3 shadow-xl"
      role="dialog"
      aria-label={`Ask AI to improve ${selectedField.label}`}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="mb-2 flex flex-wrap gap-1.5">
        {QUICK_PROMPTS.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => submit(q)}
            disabled={isBusy}
            data-testid={`inline-ai-quick-${q.toLowerCase()}`}
            className="rounded-full border border-border bg-base px-2.5 py-0.5 text-[11px] font-medium text-text-muted transition-all duration-150 hover:border-accent/30 hover:text-accent active:scale-95 disabled:opacity-40"
          >
            {q}
          </button>
        ))}
        <button
          type="button"
          onClick={() => void regenerate()}
          disabled={isBusy}
          data-testid="inline-ai-quick-regenerate"
          className="rounded-full border border-border bg-base px-2.5 py-0.5 text-[11px] font-medium text-text-muted transition-all duration-150 hover:border-accent/30 hover:text-accent active:scale-95 disabled:opacity-40"
        >
          Regenerate
        </button>
      </div>

      <div className="flex items-center gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit(value);
            } else if (e.key === "Escape") {
              e.preventDefault();
              onDismiss();
            }
          }}
          placeholder={`Ask AI to improve this ${selectedField.label.toLowerCase()}…`}
          aria-label={`Ask AI to improve this ${selectedField.label.toLowerCase()}`}
          data-testid="inline-ai-input"
          className="min-w-0 flex-1 rounded-lg border border-border bg-base px-3 py-2 text-sm text-text-primary placeholder:text-text-dim transition-all duration-200 focus:border-accent/40 focus:outline-none focus:ring-2 focus:ring-accent/10"
        />
        <button
          type="button"
          onClick={() => submit(value)}
          disabled={isBusy || !value.trim()}
          aria-label="Send instruction"
          data-testid="inline-ai-submit"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-white transition-all duration-200 hover:bg-accent-hover active:scale-95 disabled:opacity-40"
        >
          {isBusy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </button>
      </div>
    </div>
  );
}
