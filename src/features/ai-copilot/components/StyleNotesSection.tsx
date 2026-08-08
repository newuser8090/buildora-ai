"use client";

// ---------------------------------------------------------------------------
// StyleNotesSection — Phase P11 on-device style memory
//
// A small, explicit, user-managed list of style preferences the Copilot
// remembers per project ("keep it friendly", "use British spelling").
// Local-only, bounded (see COPILOT_MEMORY_LIMITS), and clearable.
// ---------------------------------------------------------------------------

import { useCallback, useState } from "react";
import { Palette, Plus, X } from "lucide-react";
import { COPILOT_MEMORY_LIMITS } from "../constants";
import { cn } from "@/utils/cn";

interface StyleNotesSectionProps {
  notes: string[];
  onAdd: (note: string) => void;
  onRemove: (note: string) => void;
  onClearAll: () => void;
}

export function StyleNotesSection({
  notes,
  onAdd,
  onRemove,
  onClearAll,
}: StyleNotesSectionProps) {
  const [draft, setDraft] = useState("");
  const atCap = notes.length >= COPILOT_MEMORY_LIMITS.maxStyleNotes;

  const handleAdd = useCallback(() => {
    const text = draft.trim();
    if (!text || atCap) return;
    onAdd(text);
    setDraft("");
  }, [draft, atCap, onAdd]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleAdd();
      }
    },
    [handleAdd],
  );

  if (notes.length === 0 && !atCap) {
    return (
      <div className="border-t border-border px-4 py-3">
        <div className="flex items-start gap-2">
          <Palette className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-text-dim" />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium text-text-muted">
              Remember my style
            </p>
            <div className="mt-1.5 flex items-center gap-1.5">
              <input
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="e.g. keep it friendly"
                aria-label="Add a style note"
                data-testid="style-note-input"
                maxLength={COPILOT_MEMORY_LIMITS.maxStyleNoteLength}
                className="h-7 w-full min-w-0 flex-1 rounded-lg border border-border bg-base px-2.5 text-xs text-text-primary placeholder:text-text-dim/60 transition-all duration-200 focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/20"
              />
              <button
                type="button"
                onClick={handleAdd}
                disabled={!draft.trim()}
                aria-label="Add style note"
                data-testid="style-note-add"
                className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-accent text-white transition-all duration-200 hover:bg-accent-hover active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
            <p className="mt-1.5 text-[10px] leading-relaxed text-text-dim/70">
              The Copilot will follow these preferences for future changes on
              this project. Saved on your device only.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="border-t border-border px-4 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Palette className="h-3.5 w-3.5 text-text-dim" />
          <span className="text-[11px] font-medium text-text-muted">
            Style memory
          </span>
          <span className="rounded-full bg-card px-1.5 py-0.5 text-[9px] text-text-dim">
            {notes.length}/{COPILOT_MEMORY_LIMITS.maxStyleNotes}
          </span>
        </div>
        {notes.length > 0 && (
          <button
            type="button"
            onClick={onClearAll}
            data-testid="style-note-clear-all"
            className="text-[10px] font-medium text-text-dim underline decoration-text-dim/40 underline-offset-2 transition-colors hover:text-text-primary"
          >
            Forget all
          </button>
        )}
      </div>

      {notes.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {notes.map((note) => (
            <span
              key={note}
              data-testid="style-note-chip"
              className="flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] text-text-muted"
            >
              {note}
              <button
                type="button"
                onClick={() => onRemove(note)}
                aria-label={`Forget style note: ${note}`}
                data-testid="style-note-remove"
                className="flex h-3.5 w-3.5 items-center justify-center rounded-full text-text-dim transition-colors hover:bg-base hover:text-text-primary"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}

      {!atCap && (
        <div className={cn("mt-2 flex items-center gap-1.5")}>
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Add another preference…"
            aria-label="Add a style note"
            data-testid="style-note-input"
            maxLength={COPILOT_MEMORY_LIMITS.maxStyleNoteLength}
            className="h-7 w-full min-w-0 flex-1 rounded-lg border border-border bg-base px-2.5 text-xs text-text-primary placeholder:text-text-dim/60 transition-all duration-200 focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/20"
          />
          <button
            type="button"
            onClick={handleAdd}
            disabled={!draft.trim()}
            aria-label="Add style note"
            data-testid="style-note-add"
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-accent text-white transition-all duration-200 hover:bg-accent-hover active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <p className="mt-1.5 text-[10px] leading-relaxed text-text-dim/70">
        The Copilot will follow these preferences for future changes on this
        project. Saved on your device only.
      </p>
    </div>
  );
}
