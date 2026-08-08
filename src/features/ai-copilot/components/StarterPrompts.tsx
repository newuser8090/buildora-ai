"use client";

import { Sparkles } from "lucide-react";
import { STARTER_PROMPTS } from "../constants";

interface StarterPromptsProps {
  busy: boolean;
  onSelect: (prompt: string) => void;
}

export function StarterPrompts({ busy, onSelect }: StarterPromptsProps) {
  return (
    <div className="px-1">
      <p className="mb-2 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-text-dim/70">
        <Sparkles className="h-3 w-3" />
        Try asking
      </p>
      <div className="flex flex-col gap-1.5">
        {STARTER_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            type="button"
            data-testid={`copilot-starter-${prompt
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-|-$/g, "")}`}
            onClick={() => onSelect(prompt)}
            disabled={busy}
            className="w-full rounded-xl border border-border/60 bg-card/40 px-3.5 py-2.5 text-left text-xs text-text-dim transition-all duration-200 hover:border-accent/25 hover:bg-accent/[0.03] hover:text-text-primary active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}
