"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  Type,
  Scissors,
  Smile,
  Gem,
  RefreshCw,
  MoreHorizontal,
  X,
  Loader2,
} from "lucide-react";
import { useInlineEdit } from "../hooks/useInlineEdit";

// ---------------------------------------------------------------------------
// InlineEditToolbar — compact floating toolbar anchored to the selected
// field (spec §14). Actions:
//   - Edit text        (manual inline editing)
//   - Shorter          (quick AI intent)
//   - Friendlier       (quick AI intent)
//   - Premium          (quick AI intent)
//   - Regenerate       (repeat the last instruction)
//   - More             (opens the AI follow-up prompt input)
//
// Anchored just above the field; the anchor is re-measured on scroll so the
// toolbar follows the canvas content. Only the panel is interactive.
// ---------------------------------------------------------------------------

interface ToolbarProps {
  anchor: HTMLElement;
  onOpenAiPrompt: () => void;
  aiPromptOpen: boolean;
}

export function InlineEditToolbar({ anchor, onOpenAiPrompt, aiPromptOpen }: ToolbarProps) {
  const { selectedField, beginEditing, suggest, regenerate, isBusy } =
    useInlineEdit();
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const [rect, setRect] = useState<{ top: number; left: number } | null>(null);
  const [ready, setReady] = useState(false);

  // Measure the anchor position, re-measuring on scroll/resize.
  useEffect(() => {
    const measure = () => {
      const r = anchor.getBoundingClientRect();
      setRect({ top: r.top, left: r.left });
    };
    measure();
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    const t = window.setTimeout(measure, 0);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
      window.clearTimeout(t);
    };
  }, [anchor]);

  // Visible once mounted (avoids a flash while measuring).
  useEffect(() => {
    const t = window.setTimeout(() => setReady(true), 30);
    return () => window.clearTimeout(t);
  }, []);

  const runQuickIntent = useCallback(
    (instruction: string) => {
      void suggest(instruction);
    },
    [suggest],
  );

  if (!selectedField) return null;

  const buttonBase =
    "pointer-events-auto flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium transition-all duration-150 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div
      ref={toolbarRef}
      data-testid="inline-toolbar"
      role="toolbar"
      aria-label="Inline editing toolbar"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      className="pointer-events-auto fixed z-50 flex items-center gap-0.5 rounded-xl border border-border bg-card px-1.5 py-1 shadow-lg transition-opacity duration-200"
      style={{
        opacity: ready ? 1 : 0,
        // Float above the field's top-left corner.
        left: rect ? Math.max(8, rect.left) : -9999,
        top: rect ? rect.top - 8 : -9999,
        transform: "translateY(-100%)",
      }}
    >
      <button
        type="button"
        onClick={beginEditing}
        disabled={isBusy}
        data-testid="inline-toolbar-edit"
        title="Edit text (double-click the field)"
        className={`${buttonBase} text-text-primary hover:bg-base`}
      >
        <Type className="h-3.5 w-3.5" />
        Edit text
      </button>

      <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />

      <button
        type="button"
        onClick={() => runQuickIntent("Make this shorter")}
        disabled={isBusy}
        data-testid="inline-toolbar-shorter"
        title="Make this shorter"
        className={`${buttonBase} text-text-muted hover:bg-base hover:text-text-primary`}
      >
        <Scissors className="h-3.5 w-3.5" />
        Shorter
      </button>

      <button
        type="button"
        onClick={() => runQuickIntent("Use a friendlier tone")}
        disabled={isBusy}
        data-testid="inline-toolbar-friendlier"
        title="Use a friendlier tone"
        className={`${buttonBase} text-text-muted hover:bg-base hover:text-text-primary`}
      >
        <Smile className="h-3.5 w-3.5" />
        Friendlier
      </button>

      <button
        type="button"
        onClick={() => runQuickIntent("Make this more premium")}
        disabled={isBusy}
        data-testid="inline-toolbar-premium"
        title="Make this more premium"
        className={`${buttonBase} text-text-muted hover:bg-base hover:text-text-primary`}
      >
        <Gem className="h-3.5 w-3.5" />
        Premium
      </button>

      <button
        type="button"
        onClick={() => void regenerate()}
        disabled={isBusy}
        data-testid="inline-toolbar-regenerate"
        title="Try another version"
        className={`${buttonBase} text-text-muted hover:bg-base hover:text-text-primary`}
      >
        <RefreshCw className="h-3.5 w-3.5" />
        Regenerate
      </button>

      <button
        type="button"
        onClick={onOpenAiPrompt}
        disabled={isBusy}
        data-testid="inline-toolbar-more"
        title="More options — ask for anything"
        aria-expanded={aiPromptOpen}
        className={`${buttonBase} ${
          aiPromptOpen
            ? "bg-accent/10 text-accent"
            : "text-text-muted hover:bg-base hover:text-text-primary"
        }`}
      >
        {isBusy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : aiPromptOpen ? (
          <X className="h-3.5 w-3.5" />
        ) : (
          <MoreHorizontal className="h-3.5 w-3.5" />
        )}
        {aiPromptOpen ? "Close" : "More"}
      </button>
    </div>
  );
}
