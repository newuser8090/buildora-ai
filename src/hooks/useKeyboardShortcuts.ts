"use client";

import { useEffect, useRef } from "react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { saveNowViaController } from "@/features/persistence/services/project-controller";
import { notifyActionFeedback } from "@/features/feedback/action-feedback";
import { openCopilotPanel } from "@/features/ai-copilot/store/copilot-store";

// ---------------------------------------------------------------------------
// Elements where keyboard shortcuts should be suppressed
// ---------------------------------------------------------------------------

const TYPING_SELECTORS = "input, textarea, select, [contenteditable]";

function isTyping(event: KeyboardEvent): boolean {
  return (
    event.target instanceof HTMLElement &&
    (event.target.matches(TYPING_SELECTORS) ||
      event.target.closest(TYPING_SELECTORS) !== null)
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useKeyboardShortcuts() {
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const selectedSectionId = useEditorStore((s) => s.selectedSectionId);
  const deleteSection = useEditorStore((s) => s.deleteSection);
  const duplicateSection = useEditorStore((s) => s.duplicateSection);
  const project = useEditorStore((s) => s.project);
  const saveStatus = useEditorStore((s) => s.saveStatus);
  const isSavingRef = useRef(false);

  // Track isSaving across renders without re-creating the effect
  useEffect(() => {
    isSavingRef.current = saveStatus === "saving";
  }, [saveStatus]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      // Don't trigger shortcuts while typing in form controls
      if (isTyping(event)) return;

      const ctrl = event.ctrlKey || event.metaKey;

      // Ctrl+S / Cmd+S → Save
      if (ctrl && event.key === "s") {
        event.preventDefault();
        if (!isSavingRef.current) {
          saveNowViaController().catch(() => {});
        }
        return;
      }

      // Ctrl+Z → Undo
      if (ctrl && event.key === "z" && !event.shiftKey) {
        event.preventDefault();
        undo();
        notifyActionFeedback("Change undone", {
          actionLabel: "Redo",
          onAction: () => useEditorStore.getState().redo(),
        });
        return;
      }

      // Ctrl+Shift+Z → Redo
      if (ctrl && event.key === "z" && event.shiftKey) {
        event.preventDefault();
        redo();
        notifyActionFeedback("Change restored", {
          actionLabel: "Undo",
          onAction: () => useEditorStore.getState().undo(),
        });
        return;
      }

      // Ctrl+Y → Redo (Windows)
      if (ctrl && event.key === "y") {
        event.preventDefault();
        redo();
        notifyActionFeedback("Change restored", {
          actionLabel: "Undo",
          onAction: () => useEditorStore.getState().undo(),
        });
        return;
      }

      // Ctrl+Shift+A → Open the AI Copilot (Phase P10)
      if (ctrl && event.shiftKey && event.key.toLowerCase() === "a") {
        event.preventDefault();
        openCopilotPanel();
        return;
      }

      // Only proceed if a section is selected
      if (!selectedSectionId) return;

      // Ctrl+D → Duplicate
      if (ctrl && event.key === "d") {
        event.preventDefault();
        duplicateSection(selectedSectionId);
        return;
      }

      // Delete / Backspace → Delete section
      if (event.key === "Delete" || event.key === "Backspace") {
        // Verify the page has more than one section
        const page = project.pages.find((p) =>
          p.sections.some((s) => s.id === selectedSectionId),
        );
        if (page && page.sections.length > 1) {
          event.preventDefault();
          deleteSection(selectedSectionId);
        }
        return;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [undo, redo, selectedSectionId, deleteSection, duplicateSection, project]);
}
