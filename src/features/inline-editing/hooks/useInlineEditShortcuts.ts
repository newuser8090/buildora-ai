"use client";

import { useEffect } from "react";
import { useInlineEditingStore } from "../store/inline-editing-store";

// ---------------------------------------------------------------------------
// useInlineEditShortcuts — global shortcuts for inline editing (spec §14):
//
//   - Ctrl/Cmd+Shift+I → open the "Improve with AI" prompt
//   - Ctrl/Cmd+Enter   → accept the current suggestion when the popover is open
//
// All are no-ops while typing in a form control, and none conflict with the
// existing editor shortcuts (undo/redo/save/duplicate/delete).
// ---------------------------------------------------------------------------

const TYPING_SELECTORS = "input, textarea, select, [contenteditable]";

function isTyping(event: KeyboardEvent): boolean {
  return (
    event.target instanceof HTMLElement &&
    (event.target.matches(TYPING_SELECTORS) ||
      event.target.closest(TYPING_SELECTORS) !== null)
  );
}

export function useInlineEditShortcuts() {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (isTyping(event)) return;
      const ctrl = event.ctrlKey || event.metaKey;
      const state = useInlineEditingStore.getState();

      // Ctrl/Cmd+Shift+I → Improve with AI
      if (ctrl && event.shiftKey && (event.key === "i" || event.key === "I")) {
        if (!state.selectedField || state.mode !== "idle") return;
        event.preventDefault();
        useInlineEditingStore.getState().setAiPromptOpen(!state.aiPromptOpen);
        return;
      }

      // Ctrl/Cmd+Enter → accept the current suggestion
      if (ctrl && event.key === "Enter") {
        if (!state.currentSuggestion || state.mode !== "reviewing") return;
        event.preventDefault();
        const acceptBtn = document.querySelector<HTMLElement>(
          '[data-testid="inline-ai-accept"]',
        );
        acceptBtn?.click();
        return;
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}
